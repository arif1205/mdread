/* Images that live next to the document — `![](./diagram.png)` — read from the
   open folder and shown through blob: URLs.

   A relative src must never reach the network: the browser would resolve it
   against our origin and ask the server for `/docs/diagram.png`, leaking the
   user's file names. So markdown.js parks every local src in data-src while the
   HTML is still an inert <template>, and loadImages() fills in a blob: URL once
   the file is found.

   Two sources, by how the folder was opened (see files.js):
   - a File System Access directory handle (state.rootHandle) — walked on demand;
   - read-only drops and <input> folders — their image Files are collected into
     state.assets while walking, keyed by the same path scheme as state.files. */

import { state } from "./state.js";

const IMG_RE = /\.(png|jpe?g|gif|webp|avif|svg|bmp|ico)$/i;
export const isImage = (name) => IMG_RE.test(name);

// resolved path → Promise<object URL | null>
const urls = new Map();

// Forget cached URLs and collected Files — the folder they came from is gone.
export function resetAssets() {
  for (const p of urls.values()) p.then((u) => u && URL.revokeObjectURL(u));
  urls.clear();
  state.assets = new Map();
}

// Anything with a scheme (https:, data:, blob:), protocol-relative, or a bare
// fragment is left alone.
const isLocal = (src) => !!src && !/^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(src);

/* `src` relative to the document at `docPath`, as a folder-relative path, or null
   when it climbs out of the folder. A leading "/" means the folder root. */
function resolvePath(docPath, src) {
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

async function fileAt(path) {
  const collected = state.assets?.get(path);
  if (collected) return collected;
  if (!state.rootHandle) return null;
  const segs = path.split("/");
  let dir = state.rootHandle;
  for (const seg of segs.slice(0, -1)) dir = await dir.getDirectoryHandle(seg);
  return (await dir.getFileHandle(segs.at(-1))).getFile();
}

function urlFor(path) {
  if (!urls.has(path)) {
    urls.set(
      path,
      fileAt(path)
        .then((f) => (f && isImage(f.name) ? URL.createObjectURL(f) : null))
        .catch(() => null),
    );
  }
  return urls.get(path);
}

// Called on parsed, not-yet-mounted HTML: park local srcs so nothing is fetched.
export function deferImages(root) {
  for (const img of root.querySelectorAll("img[src]")) {
    const src = img.getAttribute("src");
    if (!isLocal(src)) continue;
    img.dataset.src = src;
    img.removeAttribute("src");
  }
}

// Called on mounted blocks: swap each parked src for the file's blob: URL.
export function loadImages(el) {
  const base = state.current?.path || "";
  const imgs = el.matches("img[data-src]") ? [el] : el.querySelectorAll("img[data-src]");
  for (const img of imgs) {
    const path = resolvePath(base, img.dataset.src);
    const found = path && urlFor(path);
    if (!found) continue;
    found.then((url) => {
      if (url) img.src = url;
      else img.title ||= `Not found next to this document: ${img.dataset.src}`;
    });
  }
}
