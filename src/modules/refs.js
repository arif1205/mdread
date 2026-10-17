/* References between files in markdown — local images, [[wiki links]] and
   relative .md links: finding them, and resolving them against the document's
   own path. Pure — no DOM, no state — so it is shared by assets.js, links.js
   and share.js, and testable in Node. */

import { marked } from "marked";

// Anything with a scheme (https:, data:, blob:), protocol-relative, or a bare
// fragment is not a file beside the document.
export const isLocalSrc = (src) => !!src && !/^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(src);

/* `src` relative to the document at `docPath`, as a folder-relative path, or null
   when it climbs out of the folder. A leading "/" means the folder root. */
export function resolvePath(docPath, src) {
  let clean = src.replace(/[?#].*$/, "");
  try {
    clean = decodeURI(clean);
  } catch {}
  const parts = clean.startsWith("/") ? [] : docPath.split("/").slice(0, -1);
  for (const seg of clean.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else parts.push(seg);
  }
  return parts.join("/");
}

const IMG_TAG = /<img\b[^>]*?\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;

// Every local image src in `md` — markdown images and raw <img> tags — as written.
export function localImageRefs(md) {
  const found = new Set();
  marked.walkTokens(marked.lexer(md), (t) => {
    if (t.type === "image") found.add(t.href);
    else if (t.type === "wikilink" && t.embed && IMG_EXT.test(t.target)) found.add(t.target);
    else if (t.type === "html") for (const m of t.text.matchAll(IMG_TAG)) found.add(m[1] ?? m[2] ?? m[3]);
  });
  return [...found].filter(isLocalSrc);
}

/* ---------------- links between documents ---------------- */

const DOC_EXT = /\.(md|markdown|mdown|mkdn?|mdwn|mdx|txt)$/i;
const IMG_EXT = /\.(png|jpe?g|gif|webp|avif|svg|bmp|ico)$/i;
const stripExt = (p) => p.replace(DOC_EXT, "");
const dirOf = (p) => p.split("/").slice(0, -1).join("/");
const baseOf = (p) => p.split("/").pop();
const escAttr = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// `Note#Heading` → ["Note", "Heading"]; `#Heading` → ["", "Heading"].
export function splitHeading(target) {
  const i = target.indexOf("#");
  return i === -1 ? [target.trim(), ""] : [target.slice(0, i).trim(), target.slice(i + 1).trim()];
}

/* A [[wiki link]] name → the path of the file it names, or null. Obsidian's
   rules, roughly: a bare name matches a file of that name anywhere, nearest
   first (same folder, then the shallowest); a name with a "/" is a path, tried
   relative to the linking document, then from the folder root, then as the tail
   of a longer path. Case-insensitive, extension optional. */
export function resolveWiki(name, fromPath, paths) {
  const t = stripExt(name.trim()).toLowerCase();
  if (!t) return null;
  const key = (p) => stripExt(p).toLowerCase();
  if (t.includes("/")) {
    const tries = [resolvePath(fromPath.toLowerCase(), t), t.replace(/^\/+/, "")];
    for (const want of tries) {
      const hit = want != null && paths.find((p) => key(p) === want);
      if (hit) return hit;
    }
    const tail = paths.filter((p) => key(p).endsWith("/" + t)).sort((a, b) => a.length - b.length);
    return tail[0] || null;
  }
  const here = dirOf(fromPath).toLowerCase();
  const depth = (p) => p.split("/").length;
  return (
    paths
      .filter((p) => baseOf(key(p)) === t)
      .sort((a, b) => (dirOf(b).toLowerCase() === here) - (dirOf(a).toLowerCase() === here) || depth(a) - depth(b) || a.localeCompare(b))[0] || null
  );
}

// A relative markdown link (`../notes/b.md#x`) → the path it points to, or null.
export function resolveDocLink(href, fromPath, paths) {
  const want = resolvePath(fromPath, href);
  if (want == null) return null;
  const lower = want.toLowerCase();
  return paths.find((p) => p === want) || paths.find((p) => p.toLowerCase() === lower) || paths.find((p) => stripExt(p).toLowerCase() === lower) || null;
}

// Does this href point at another document (rather than a site, a file, or an anchor)?
export const isDocHref = (href) => isLocalSrc(href) && DOC_EXT.test(href.replace(/[?#].*$/, ""));

const WIKI_RE = /(!?)\[\[([^[\]\n|]*?)(?:\|([^[\]\n]*))?\]\]/g;
const MDLINK_RE = /\[[^\]\n]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;

/* Every document `md` links to, as [{ path, at }] with `at` the link's offset —
   what backlinks are built from. A plain scan of the source, so a link written
   inside a code block counts too; cheap, and close enough for "linked from". */
export function linkTargets(md, fromPath, paths) {
  const out = [];
  for (const m of md.matchAll(WIKI_RE)) {
    if (m[1]) continue; // ![[embed]] shows a file, it doesn't link to it
    const [name] = splitHeading(m[2]);
    const path = name && resolveWiki(name, fromPath, paths);
    if (path) out.push({ path, at: m.index });
  }
  for (const m of md.matchAll(MDLINK_RE)) {
    if (md[m.index - 1] === "!" || !isDocHref(m[1])) continue;
    const path = resolveDocLink(m[1], fromPath, paths);
    if (path) out.push({ path, at: m.index });
  }
  return out.sort((a, b) => a.at - b.at);
}

/* `[[wiki links]]` for marked. Registered here, on the shared marked instance,
   so every parse — the reading view, share bundles, tests — reads the same
   syntax. Links render as a.wikilink[data-wiki]; links.js resolves and opens
   them. `![[pic.png]]` embeds an image the same way `![](pic.png)` would. */
marked.use({
  extensions: [
    {
      name: "wikilink",
      level: "inline",
      start(src) {
        const i = src.indexOf("[[");
        return i > 0 && src[i - 1] === "!" ? i - 1 : i === -1 ? undefined : i;
      },
      tokenizer(src) {
        const m = /^(!?)\[\[([^[\]\n|]+?)(?:\|([^[\]\n]+?))?\]\]/.exec(src);
        if (m) return { type: "wikilink", raw: m[0], embed: !!m[1], target: m[2].trim(), label: (m[3] || "").trim() };
      },
      renderer(t) {
        if (t.embed && IMG_EXT.test(t.target)) return `<img src="${escAttr(t.target)}" alt="${escAttr(t.label || baseOf(t.target))}">`;
        const [name, heading] = splitHeading(t.target);
        const shown = t.label || [name && baseOf(stripExt(name)), heading].filter(Boolean).join(" › ");
        return `<a class="wikilink" href="#" data-wiki="${escAttr(t.target)}">${escAttr(shown)}</a>`;
      },
    },
  ],
});
