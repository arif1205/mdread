/* The file tree in the sidebar: nested folders, the active/dirty markers, the
   "current folder" chip, and closing the library back to the welcome screen. */

import { state } from "./state.js";
import { $$, tree, curFolder, curFolderName, searchInput, app, reading, tocList, docName, docSub, MD_RE } from "./dom.js";
import { escapeHtml } from "./util.js";
import { idbSet } from "./idb.js";
import { openDoc } from "./document.js";
import { rememberFiles } from "./files.js";
import { setText } from "./editor.js";
import { openSearch } from "./search.js";
import { renderBacklinks } from "./links.js";
import { resetAssets } from "./assets.js";
import { renderRecents } from "./recents.js";
import { setMode, setSidebar } from "./view.js";
import { savePos } from "./scroll.js";

export function updateCurrentFolder() {
  const has = state.files.length > 0 || state.current != null;
  curFolder.hidden = !has;
  if (!has) return;
  curFolderName.textContent =
    state.rootName ||
    (state.files.length
      ? `${state.files.length} file${state.files.length > 1 ? "s" : ""}`
      : state.current
      ? state.current.name.replace(MD_RE, "")
      : "Document");
}

// Clear the current library/document and return to the welcome screen.
export function closeLibrary() {
  if (state.files.some((f) => f.dirty) && !confirm("You have unsaved changes. Discard them and start fresh?")) return;
  if (state.current) savePos(state.current);
  state.files = [];
  state.current = null;
  state.rootHandle = null;
  state.rootName = "";
  resetAssets();
  state.filter = "";
  searchInput.value = "";
  idbSet("lastDoc", "").catch(() => {});
  rememberFiles();
  app.dataset.hasDoc = "false";
  reading.innerHTML = "";
  setText("");
  tocList.innerHTML = "";
  docName.textContent = "No document";
  docSub.textContent = "";
  setMode("read");
  renderTree();
  renderRecents();
  renderBacklinks();
}

export function renderTree() {
  updateCurrentFolder();
  tree.innerHTML = "";
  const q = state.filter.toLowerCase();
  const files = q ? state.files.filter((f) => f.path.toLowerCase().includes(q)) : state.files;

  if (!files.length) {
    if (state.files.length) {
      tree.innerHTML = `<p class="tree-empty">No file names match.</p><button class="tree-empty__search" type="button">Search inside files for “${escapeHtml(state.filter)}”</button>`;
      tree.querySelector("button").addEventListener("click", () => openSearch(state.filter));
    }
    return;
  }

  // build nested structure
  const root = { dirs: new Map(), files: [] };
  for (const f of files) {
    const parts = f.path.split("/");
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const d = parts[i];
      if (!node.dirs.has(d)) node.dirs.set(d, { dirs: new Map(), files: [] });
      node = node.dirs.get(d);
    }
    node.files.push(f);
  }
  tree.appendChild(renderNode(root, true, !!q));
}

function renderNode(node, isRoot, expand) {
  const frag = document.createDocumentFragment();
  for (const [name, child] of [...node.dirs.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const details = document.createElement("details");
    details.open = expand || true;
    const summary = document.createElement("summary");
    summary.innerHTML = `<span class="caret"><svg viewBox="0 0 24 24" width="12" height="12"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span><span>${escapeHtml(name)}</span>`;
    details.appendChild(summary);
    const kids = document.createElement("div");
    kids.className = "kids";
    kids.appendChild(renderNode(child, false, expand));
    details.appendChild(kids);
    frag.appendChild(details);
  }
  for (const f of node.files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))) {
    const btn = document.createElement("button");
    btn.className = "file";
    if (f === state.current) btn.classList.add("is-active");
    if (f.dirty) btn.classList.add("is-dirty");
    btn.dataset.path = f.path;
    btn.innerHTML = `<span class="dot">●</span><span class="file__name">${escapeHtml(f.name.replace(MD_RE, ""))}</span>`;
    btn.addEventListener("click", () => {
      openDoc(f);
      if (innerWidth <= 820) setSidebar(false);
    });
    frag.appendChild(btn);
  }
  return frag;
}

export function refreshTreeState() {
  for (const btn of $$(".file", tree)) {
    const f = state.files.find((x) => x.path === btn.dataset.path);
    btn.classList.toggle("is-active", f === state.current);
    btn.classList.toggle("is-dirty", !!f?.dirty);
  }
}
