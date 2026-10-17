/* CodeMirror 6, configured for markdown. Only editor.js imports this, and only
   by dynamic import the first time an editing view opens — CodeMirror is ~100 KB
   gzipped, and a reader who never edits shouldn't wait on it at startup.

   CodeMirror edits the text exactly as written. That matters because saves go
   straight back to files on disk (often under git): opening a file and saving it
   must never reformat it. */

import { EditorState, EditorSelection, Compartment, Transaction, Prec } from "@codemirror/state";
import { EditorView, keymap, placeholder, drawSelection } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { syntaxHighlighting, indentUnit } from "@codemirror/language";
import { markdownLanguage, markdownKeymap, pasteURLAsLink } from "@codemirror/lang-markdown";
import { classHighlighter } from "@lezer/highlight";

/* ---------------- formatting commands ---------------- */

const format = (view, spec) => {
  view.dispatch(view.state.update(spec, { userEvent: "input.format", scrollIntoView: true }));
  return true;
};

// Wrap every selection in pre/post, keeping the original text selected (or the
// caret between the markers when nothing was selected).
const wrapSel = (pre, post) => (view) =>
  format(
    view,
    view.state.changeByRange((r) => ({
      changes: [
        { from: r.from, insert: pre },
        { from: r.to, insert: post },
      ],
      range: EditorSelection.range(r.from + pre.length, r.to + pre.length),
    })),
  );

// [selection](url), with "url" selected so the next paste or keystroke fills it.
const linkSel = (view) =>
  format(
    view,
    view.state.changeByRange((r) => {
      const text = view.state.sliceDoc(r.from, r.to) || "text";
      const url = r.from + text.length + 3;
      return {
        changes: { from: r.from, to: r.to, insert: `[${text}](url)` },
        range: EditorSelection.range(url, url + 3),
      };
    }),
  );

/* ---------------- the view ---------------- */

/* Mount an editor into `parent` and return the handful of operations editor.js
   exposes. `onEdit` fires for edits a person made: every CodeMirror command tags
   its transaction with a userEvent ("input", "delete", "undo", …), while
   setText/replaceText dispatch untagged, as does y-codemirror for a peer's edit —
   collab.js renders and marks those itself. */
export function mountEditor(parent, text, onEdit) {
  /* Undo history lives in a compartment because co-editing replaces it: in a
     room, undo goes through Yjs's UndoManager so it only ever undoes your own
     edits, never a peer's. `collabExt` is remembered so setText(), which builds
     a fresh EditorState, keeps whichever one is active. */
  const historySlot = new Compartment();
  const localHistory = [history(), keymap.of(historyKeymap)];
  let collabExt = null;

  const extensions = () => [
    // Mod-i must outrank defaultKeymap, which binds it to selectParentSyntax.
    keymap.of([
      { key: "Mod-b", run: wrapSel("**", "**") },
      { key: "Mod-i", run: wrapSel("*", "*") },
      { key: "Mod-k", run: linkSel },
    ]),
    /* GFM, assembled from lang-markdown's parts rather than its markdown() helper,
       which statically imports the HTML, CSS and JavaScript parsers (~40 KB gz)
       to highlight inline HTML. Enter continues lists, task items and quotes;
       Backspace removes their markup; pasting a URL over a selection links it. */
    markdownLanguage,
    Prec.high(keymap.of(markdownKeymap)),
    pasteURLAsLink,
    syntaxHighlighting(classHighlighter),
    historySlot.of(collabExt ?? localHistory),
    keymap.of([indentWithTab, ...defaultKeymap]),
    indentUnit.of("  "),
    EditorState.tabSize.of(2),
    EditorView.lineWrapping,
    drawSelection(),
    placeholder("# Start writing…"),
    EditorView.contentAttributes.of({ spellcheck: "false", "aria-label": "Markdown source" }),
    EditorView.updateListener.of((u) => {
      if (u.transactions.some((tr) => tr.docChanged && tr.annotation(Transaction.userEvent) != null)) onEdit();
    }),
  ];

  const newState = (doc) => EditorState.create({ doc, extensions: extensions() });
  const view = new EditorView({ state: newState(text), parent });
  const getText = () => view.state.doc.toString();

  return {
    getText,

    // Load a document: fresh undo history, caret at the start, scrolled to the top.
    setText(doc) {
      view.setState(newState(doc));
    },

    /* Bring the buffer in line with `doc` without disturbing the editing session.
       Only the differing middle is replaced, so the caret, the scroll offset and
       the undo history all survive (CodeMirror maps them across the change). */
    replaceText(doc) {
      const cur = getText();
      if (cur === doc) return;
      let s = 0;
      const max = Math.min(cur.length, doc.length);
      while (s < max && cur.charCodeAt(s) === doc.charCodeAt(s)) s++;
      let ec = cur.length;
      let en = doc.length;
      while (ec > s && en > s && cur.charCodeAt(ec - 1) === doc.charCodeAt(en - 1)) {
        ec--;
        en--;
      }
      view.dispatch({ changes: { from: s, to: ec, insert: doc.slice(s, en) } });
    },

    focus(end) {
      view.focus();
      if (end) view.dispatch({ selection: { anchor: view.state.doc.length }, scrollIntoView: true });
    },

    setCollab(ext) {
      collabExt = ext;
      view.dispatch({ effects: historySlot.reconfigure(ext ?? localHistory) });
    },
  };
}
