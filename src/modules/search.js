/* Search inside files (⇧⌘F): a phrase search over the text of every open file,
   with results grouped per file and line, and the hit revealed in the document
   when one is picked. Everything happens in memory — nothing is indexed to disk
   and nothing touches the network. Texts come from corpus.js once per opening
   of the dialog, so keystrokes only scan strings. */

import { state } from "./state.js";
import { $, app, reading, readingScroll } from "./dom.js";
import { escapeHtml, debounce } from "./util.js";
import { openDoc } from "./document.js";
import { selectRange } from "./editor.js";
import { allTexts } from "./corpus.js";

const MAX_HITS_PER_FILE = 50; // counted; only the first few are listed
const SHOWN_PER_FILE = 5;
const MAX_ROWS = 300;

const dlg = () => $("#searchDlg");
const input = () => $("#fsInput");

let corpus = []; // [{ file, text, lower }]
let rows = []; // flat list of result rows, for keyboard navigation
let active = -1;

async function gather() {
  $("#fsStat").textContent = `Reading ${state.files.length} files…`;
  corpus = (await allTexts()).map((d) => ({ ...d, lower: d.text.toLowerCase() }));
}

/* ---------------- matching ---------------- */

function find(q) {
  const ql = q.toLowerCase();
  const results = [];
  for (const doc of corpus) {
    const hits = [];
    let i = doc.lower.indexOf(ql);
    while (i !== -1 && hits.length < MAX_HITS_PER_FILE) {
      hits.push(i);
      i = doc.lower.indexOf(ql, i + ql.length);
    }
    const nameHit = doc.file.path.toLowerCase().includes(ql);
    if (hits.length || nameHit) results.push({ doc, hits, nameHit });
  }
  // Name matches first, then the files that mention it most.
  return results.sort((a, b) => b.nameHit - a.nameHit || b.hits.length - a.hits.length || a.doc.file.path.localeCompare(b.doc.file.path));
}

// The hit's line, trimmed to a window around the match, with the match marked.
function snippet(text, at, len) {
  const ls = text.lastIndexOf("\n", at - 1) + 1;
  let le = text.indexOf("\n", at);
  if (le === -1) le = text.length;
  const from = Math.max(ls, at - 60);
  const to = Math.min(le, at + len + 80);
  const pre = (from > ls ? "…" : "") + text.slice(from, at).trimStart();
  const post = text.slice(at + len, to) + (to < le ? "…" : "");
  return `${escapeHtml(pre)}<mark>${escapeHtml(text.slice(at, at + len))}</mark>${escapeHtml(post)}`;
}

const lineOf = (text, at) => text.slice(0, at).split("\n").length;

/* ---------------- rendering ---------------- */

function render() {
  const q = input().value.trim();
  const list = $("#fsList");
  const stat = $("#fsStat");
  list.innerHTML = "";
  rows = [];
  active = -1;
  if (!q) {
    stat.textContent = `${corpus.length} file${corpus.length === 1 ? "" : "s"}`;
    return;
  }

  const results = find(q);
  const total = results.reduce((n, r) => n + r.hits.length, 0);
  stat.textContent = results.length
    ? `${total}${total >= MAX_HITS_PER_FILE ? "+" : ""} match${total === 1 ? "" : "es"} in ${results.length} file${results.length === 1 ? "" : "s"}`
    : "No matches";

  for (const { doc, hits } of results) {
    if (rows.length >= MAX_ROWS) break;
    const { file, text } = doc;
    const group = document.createElement("section");
    group.className = "fsearch__file";

    const dir = file.path.includes("/") ? file.path.split("/").slice(0, -1).join("/") : "";
    group.appendChild(row("fsearch__head", `<span class="fsearch__name">${escapeHtml(file.name.replace(/\.\w+$/, ""))}</span>${dir ? `<span class="fsearch__dir">${escapeHtml(dir)}</span>` : ""}<span class="fsearch__n">${hits.length || ""}</span>`, { file, q, nth: 0, at: hits[0] }));

    hits.slice(0, SHOWN_PER_FILE).forEach((at, nth) => {
      group.appendChild(row("fsearch__hit", `<span class="fsearch__ln">${lineOf(text, at)}</span><span class="fsearch__text">${snippet(text, at, q.length)}</span>`, { file, q, nth, at }));
    });
    if (hits.length > SHOWN_PER_FILE) {
      const more = document.createElement("p");
      more.className = "fsearch__more";
      more.textContent = `${hits.length - SHOWN_PER_FILE}${hits.length >= MAX_HITS_PER_FILE ? "+" : ""} more in this file`;
      group.appendChild(more);
    }
    list.appendChild(group);
  }
  setActive(0);
}

function row(cls, html, target) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = cls;
  b.innerHTML = html;
  b.addEventListener("click", () => pick(target));
  b.addEventListener("mousemove", () => setActive(rows.indexOf(b), false));
  rows.push(b);
  b.__target = target;
  return b;
}

function setActive(i, scroll = true) {
  rows[active]?.classList.remove("is-on");
  active = Math.max(-1, Math.min(i, rows.length - 1));
  const el = rows[active];
  if (!el) return;
  el.classList.add("is-on");
  if (scroll) el.scrollIntoView({ block: "nearest" });
}

/* ---------------- revealing a hit ---------------- */

async function pick({ file, q, nth, at }) {
  dlg().close();
  if (file !== state.current) await openDoc(file);
  if (state.current !== file) return; // couldn't be opened
  requestAnimationFrame(() => {
    if (app.dataset.mode !== "edit") revealInReading(q, nth);
    if (app.dataset.mode !== "read" && at != null) selectRange(at, at + q.length);
  });
}

/* Highlight every rendered occurrence and scroll to the nth. The rendered text
   differs from the source (markup, link targets), so nth is clamped to what's
   there. The CSS Custom Highlight API paints without touching the DOM, which
   patchMarkdown() relies on being exactly what it rendered. */
function revealInReading(q, nth) {
  const ql = q.toLowerCase();
  const ranges = [];
  const walk = document.createTreeWalker(reading, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const lower = n.data.toLowerCase();
    for (let i = lower.indexOf(ql); i !== -1; i = lower.indexOf(ql, i + ql.length)) {
      const r = new Range();
      r.setStart(n, i);
      r.setEnd(n, i + q.length);
      ranges.push(r);
    }
  }
  const target = ranges[Math.min(nth, ranges.length - 1)];
  if (!target) return;
  if (globalThis.CSS?.highlights) {
    CSS.highlights.set("search", new Highlight(...ranges));
    CSS.highlights.set("search-current", new Highlight(target));
  }
  const box = target.getBoundingClientRect();
  const pane = readingScroll.getBoundingClientRect();
  readingScroll.scrollTo({ top: readingScroll.scrollTop + box.top - pane.top - pane.height / 3, behavior: "smooth" });
}

export function clearSearchHighlight() {
  globalThis.CSS?.highlights?.delete("search");
  globalThis.CSS?.highlights?.delete("search-current");
}

/* ---------------- wiring ---------------- */

export async function openSearch(q) {
  if (!state.files.length) return;
  const d = dlg();
  if (!d.open) d.showModal();
  if (q != null) input().value = q;
  input().select();
  await gather();
  render();
}

export function wireSearch() {
  const d = dlg();
  input().addEventListener("input", debounce(render, 90));
  input().addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setActive(active + (e.key === "ArrowDown" ? 1 : -1));
    } else if (e.key === "Enter" && rows[active]) {
      e.preventDefault();
      pick(rows[active].__target);
    } else if (e.key === "Escape") {
      // A type=search field would spend the first Escape clearing itself.
      e.preventDefault();
      d.close();
    }
  });
  $("#fsClose").addEventListener("click", () => d.close());
  d.addEventListener("click", (e) => e.target === d && d.close());
  d.addEventListener("close", () => (corpus = []));
  // Any click back in the document dismisses the highlight.
  reading.addEventListener("pointerdown", clearSearchHighlight);
}
