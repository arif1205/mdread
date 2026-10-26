/* Opening a document, the topbar subtitle (word count / status), and creating
   blank drafts whose title tracks the first H1 as you type. */

import { state, positions } from "./state.js";
import { app, docName, docSub, readingScroll, MD_RE } from "./dom.js";
import { getText, setText, replaceText, focusEditor } from "./editor.js";
import { ensureMd } from "./util.js";
import { idbSet } from "./idb.js";
import { renderMarkdown, patchMarkdown } from "./markdown.js";
import { renderTree, refreshTreeState, updateCurrentFolder } from "./tree.js";
import { savePos, updateProgress } from "./scroll.js";
import { setMode } from "./view.js";
import { toast } from "./ui.js";
import { renderVaultBox } from "./vault.js";
import { renderBacklinks } from "./links.js";

/* collab.js marks the app while a room is mounted. Reading that, rather than
   importing inRoom() from collab.js, keeps Yjs out of the startup bundle: a
   static import would pull the whole lazy collab chunk in for every reader. */
const inRoom = () => app.dataset.collab === "on";

/* A document's text is read once and cached on the file object, so an edit made
   in another app stays invisible until we look again. Only handle-backed files
   can be looked at again: a picked/dropped File is a snapshot that Chrome refuses
   to read once the file underneath changes. `lastModified` is the disk mtime of
   the version we hold; save.js refreshes it after writing so our own saves don't
   come back as "changed on disk". */
export async function readHandle(file) {
  const blob = await file.handle.getFile();
  file.lastModified = blob.lastModified;
  return blob.text();
}

// Take the on-disk version if it's newer. Returns true when file.content changed.
// Unsaved edits are only discarded if the user agrees; either way we ask once
// per change on disk, not on every focus.
async function pullFromDisk(file) {
  if (!file.handle || file.lastModified == null) return false;
  let blob;
  try {
    blob = await file.handle.getFile();
  } catch {
    return false; // moved/deleted, or permission lapsed — keep what we have
  }
  if (blob.lastModified === file.lastModified) return false;
  file.lastModified = blob.lastModified;
  const text = await blob.text();
  if (text === file.content) return false;
  if (file.dirty && !confirm(`"${file.name}" changed on disk. Reload it and discard your unsaved edits?`)) return false;
  file.content = text;
  file.dirty = false;
  return true;
}

// Re-check the open document, e.g. when the tab regains focus. Returning to the
// tab fires both focus and visibilitychange; `syncing` keeps that to one check
// (and one confirm).
let syncing = false;
export async function syncCurrentFromDisk() {
  const f = state.current;
  if (!f?.handle || inRoom() || syncing) return; // in a room the shared text is the truth
  syncing = true;
  try {
    if (!(await pullFromDisk(f)) || f !== state.current) return;
  } finally {
    syncing = false;
  }
  replaceText(f.content); // keeps the caret, scroll offset and undo history
  patchMarkdown(f.content); // repaints only changed blocks, keeps the reading position
  updateSub();
  refreshTreeState();
  toast("Reloaded — file changed on disk");
}

export function wireDiskSync() {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") syncCurrentFromDisk();
  });
  window.addEventListener("focus", syncCurrentFromDisk);
}

export async function openDoc(file) {
  if (!file) return;
  // persist current scroll position before leaving
  if (state.current) savePos(state.current);

  if (file.content == null) {
    try {
      // A handle restored from IndexedDB may need its grant renewed; the tree click is the user gesture.
      if (file.handle && (await file.handle.queryPermission()) !== "granted") await file.handle.requestPermission();
      if (file.handle) file.content = await readHandle(file);
      else if (file.file) file.content = await file.file.text();
      else file.content = "";
    } catch (e) {
      console.warn("openDoc", file.path, e);
      toast(`Could not read file (${e.name || "error"})`);
      return;
    }
  } else if (!inRoom()) {
    await pullFromDisk(file); // cached from an earlier visit — may be stale
  }

  state.current = file;
  app.dataset.hasDoc = "true";
  idbSet("lastDoc", file.path).catch(() => {});

  docName.textContent = file.name.replace(MD_RE, "");
  updateSub();
  renderMarkdown(file.content);
  setText(file.content);
  refreshTreeState();
  updateCurrentFolder();
  renderVaultBox(); // the "+" reflects whether *this* document is stored
  renderBacklinks();

  // restore reading position
  requestAnimationFrame(() => {
    const ratio = positions[file.path] || 0;
    readingScroll.scrollTop = ratio * (readingScroll.scrollHeight - readingScroll.clientHeight);
    updateProgress();
  });
}

export function updateSub() {
  const f = state.current;
  if (!f) return;
  const words = (f.content.match(/\S+/g) || []).length;
  const mins = Math.max(1, Math.round(words / 220));
  const status = f.handle ? "" : f.draft ? " · draft" : " · read-only";
  const dir = f.path.includes("/") ? f.path.split("/").slice(0, -1).join("/") + "  ·  " : "";
  docSub.textContent = `${dir}${words.toLocaleString()} words · ${mins} min${status}${f.dirty ? " · unsaved" : ""}`;
}

function uniqueDraftPath() {
  let n = 1,
    p;
  do {
    p = n === 1 ? "Untitled.md" : `Untitled ${n}.md`;
    n++;
  } while (state.files.some((f) => f.path === p));
  return p;
}

// Start a blank document (or one pre-filled with pasted text) in edit mode.
export function newDoc(content = "") {
  if (state.current) savePos(state.current);
  const f = { name: "Untitled.md", path: uniqueDraftPath(), content, handle: null, file: null, dirty: false, draft: true };
  state.files.push(f);
  renderTree();
  state.current = f;
  app.dataset.hasDoc = "true";
  docName.textContent = "Untitled";
  setText(content);
  renderMarkdown(content);
  updateSub();
  refreshTreeState();
  renderVaultBox();
  renderBacklinks();
  setMode("split");
  focusEditor({ end: true });
}

// Derive a draft's name/title from its first H1 as you type.
// A room's document keeps the host's file name, so both sides agree on it.
export function deriveDraftTitle(f) {
  if (!f.draft || f.fromRoom) return;
  const m = getText().match(/^\s{0,3}#\s+(.+?)\s*#*\s*$/m);
  const title = (m && m[1].trim()) || "Untitled";
  const name = ensureMd(title);
  if (f.name !== name) {
    f.name = name;
    docName.textContent = title;
    renderTree();
    refreshTreeState();
  }
}
