/* Local image references in markdown: finding them, and resolving them against
   the document's own path. Pure — no DOM, no state — so it is shared by
   assets.js (showing images) and bundle.js (sharing them), and testable in Node. */

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
    else if (t.type === "html") for (const m of t.text.matchAll(IMG_TAG)) found.add(m[1] ?? m[2] ?? m[3]);
  });
  return [...found].filter(isLocalSrc);
}
