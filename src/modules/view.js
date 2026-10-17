/* View concerns: Read/Split/Edit mode, preference application, sidebar, focus.
   All of these work by setting data-* attributes / CSS custom properties that
   the stylesheet reacts to — JS never toggles layout classes directly. */

import { state, prefs } from "./state.js";
import { $, $$, app, docName } from "./dom.js";
import { getText, replaceText, focusEditor } from "./editor.js";
import { renderMarkdown } from "./markdown.js";

export function setMode(mode) {
  // commit edits when switching away from an editor view into read
  if (state.current && app.dataset.mode !== "read" && mode === "read") {
    state.current.content = getText();
    renderMarkdown(state.current.content);
  }
  if (state.current && app.dataset.mode === "read" && mode !== "read") {
    replaceText(state.current.content);
  }
  if (mode === "split") renderMarkdown(getText() || state.current?.content || "");
  app.dataset.mode = mode;
  $$(".seg [data-mode-val]").forEach((b) => b.classList.toggle("is-on", b.dataset.modeVal === mode));
  if (mode !== "read") focusEditor();
}

export function applyPrefs() {
  document.documentElement.dataset.theme = prefs.theme;
  document.documentElement.dataset.dropcap = prefs.dropcap ? "on" : "off";
  document.documentElement.style.setProperty("--body", prefs.font === "sans" ? "var(--sans)" : "var(--serif)");
  document.documentElement.style.setProperty("--reading-scale", (prefs.size / 100).toFixed(2));
  document.documentElement.style.setProperty("--measure", prefs.width + "rem");
  app.dataset.toc = prefs.toc ? "on" : "off";

  $$("[data-theme-val]").forEach((b) => b.classList.toggle("is-on", b.dataset.themeVal === prefs.theme));
  $$("[data-font-val]").forEach((b) => b.classList.toggle("is-on", b.dataset.fontVal === prefs.font));
  $("#sizeRange").value = prefs.size;
  $("#widthRange").value = prefs.width;
  $("#dropcapToggle").setAttribute("aria-checked", String(prefs.dropcap));
  $("#tocBtn").classList.toggle("is-on", prefs.toc);
  // theme-color is handled by <meta> media queries; nothing else needed here
}

export function setSidebar(show) {
  app.dataset.sidebar = show ? "shown" : "hidden";
  $("#expandBtn").hidden = show;
  $("#scrim").classList.toggle("on", show && innerWidth <= 820);
}

export function toggleSidebar() {
  setSidebar(app.dataset.sidebar === "hidden");
}

export function toggleFocus() {
  const on = app.dataset.focus !== "on";
  app.dataset.focus = on ? "on" : "off";
  $("#focusBtn").classList.toggle("is-on", on);
}

/* Print / Save as PDF (styles in _print.scss). Edit mode has no rendered preview
   on screen, so render the latest text first; and title the page after the
   document, since browsers use the title as the PDF's default filename. */
export function wirePrint() {
  let title = "";
  addEventListener("beforeprint", () => {
    if (!state.current) return;
    if (app.dataset.mode === "edit") renderMarkdown(getText());
    title = document.title;
    document.title = docName.textContent;
  });
  addEventListener("afterprint", () => {
    if (title) document.title = title;
    title = "";
  });
}
