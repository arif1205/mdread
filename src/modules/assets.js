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
import { toast } from "./ui.js";

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

/* ---------------- pasted and dropped images ---------------- */

const EXT = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/avif": "avif", "image/svg+xml": "svg" };

// A screenshot pastes as "image.png"; give it a dated name instead. Real file
// names are kept, reduced to characters that need no escaping in a link.
function imageName(file) {
  const ext = EXT[file.type] || file.name.split(".").pop() || "png";
  const named = file.name && !/^image\.\w+$/i.test(file.name);
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const base = named ? file.name.replace(/\.\w+$/, "") : `pasted-${stamp}`;
  return `${base.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") || "image"}.${ext}`;
}

async function freeName(dir, name) {
  const [, base, ext] = /^(.*?)(\.\w+)$/.exec(name);
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? name : `${base}-${n}${ext}`;
    try {
      await dir.getFileHandle(candidate);
    } catch {
      return candidate; // NotFoundError — it's free
    }
  }
}

/* Write images into an `assets/` folder beside the current document and return
   the markdown that shows them — or null, with a toast saying why, when there is
   nowhere to write (a single file, a read-only folder, a draft or a share). */
export async function saveImages(files) {
  const root = state.rootHandle;
  const f = state.current;
  const where = root && f?.handle ? await root.resolve(f.handle).catch(() => null) : null;
  if (!where) {
    toast("To paste images, open the document's folder with the Folder button");
    return null;
  }
  try {
    if ((await root.queryPermission({ mode: "readwrite" })) !== "granted" && (await root.requestPermission({ mode: "readwrite" })) !== "granted") {
      toast("Images need write access to the folder");
      return null;
    }
    let dir = root;
    for (const seg of where.slice(0, -1)) dir = await dir.getDirectoryHandle(seg);
    const assets = await dir.getDirectoryHandle("assets", { create: true });
    const out = [];
    for (const file of files) {
      const name = await freeName(assets, imageName(file));
      const w = await (await assets.getFileHandle(name, { create: true })).createWritable();
      await w.write(file);
      await w.close();
      out.push(`![${name.replace(/\.\w+$/, "")}](assets/${name})`);
    }
    return out.join("\n\n");
  } catch (e) {
    console.warn("saveImages", e);
    toast(`Couldn't save the image (${e.name || "error"})`);
    return null;
  }
}
