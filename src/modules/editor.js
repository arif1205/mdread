/* The markdown editor's facade: live preview and dirty tracking, plus the text
   operations the rest of the app uses — getText / setText / replaceText /
   focusEditor, and setCollab for collab.js. Nothing else touches CodeMirror.

   CodeMirror itself (cm.js) is loaded the first time an editing view opens.
   Until then the text is held in `pending`, so opening, reading and saving
   documents never wait on the editor. */

import { state } from "./state.js";
import { app, editor } from "./dom.js";
import { debounce } from "./util.js";
import { renderMarkdown } from "./markdown.js";
import { deriveDraftTitle, updateSub } from "./document.js";
import { refreshTreeState } from "./tree.js";
import { saveImages } from "./assets.js";

let cm = null; // the mounted editor, once loaded
let pending = ""; // the buffer's text until then
let loading = null;

const liveRender = debounce(() => {
  if (!state.current) return;
  const text = getText();
  state.current.content = text;
  if (app.dataset.mode === "split") renderMarkdown(text);
  deriveDraftTitle(state.current);
  markDirty();
}, 140);

function markDirty() {
  const f = state.current;
  if (!f) return;
  f.dirty = true;
  updateSub();
  refreshTreeState();
}

// Load and mount CodeMirror (once), seeded with whatever text is pending.
export function loadEditor() {
  loading ??= import("./cm.js").then(({ mountEditor }) => {
    cm = mountEditor(editor, pending, { onEdit: liveRender, onImages: insertImages });
    return cm;
  });
  return loading;
}

export function getText() {
  return cm ? cm.getText() : pending;
}

// Load a document: fresh undo history, caret at the start.
export function setText(text = "") {
  if (cm) cm.setText(text);
  else pending = text;
}

// Bring the buffer in line with `text`, keeping caret, scroll and undo history.
export function replaceText(text) {
  if (cm) cm.replaceText(text);
  else pending = text;
}

/* Save pasted or dropped images beside the document and link them at the caret.
   Returns false when the editor isn't showing, so a drop can fall through to
   opening files instead. */
export async function insertImages(files) {
  if (!cm || app.dataset.mode === "read" || !state.current) return false;
  const md = await saveImages(files);
  if (md) cm.insertBlock(md);
  return true;
}

export async function focusEditor({ end = false } = {}) {
  (await loadEditor()).focus(end);
}

/* collab.js hands in y-codemirror's extension when joining a room, and null to
   go back to local undo. Only valid once loadEditor() has resolved. */
export function setCollab(ext) {
  cm?.setCollab(ext);
}
