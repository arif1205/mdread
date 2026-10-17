/* The current text of every open file, for features that read across the
   folder (search.js, backlinks in links.js). The current document is read from
   the editor, unsaved edits from the file object, and everything else from
   disk — re-read only when its mtime has moved, through a cache kept apart from
   file.content so reading here never changes what openDoc() sees. */

import { state } from "./state.js";
import { getText } from "./editor.js";

// file → { lm, text }
const diskCache = new WeakMap();

export async function textOf(f) {
  if (f === state.current) return getText();
  if (f.dirty || (!f.handle && f.content != null)) return f.content || "";
  const blob = f.handle ? await f.handle.getFile() : f.file;
  if (!blob) return f.content || "";
  const hit = diskCache.get(f);
  if (hit && hit.lm === blob.lastModified) return hit.text;
  const text = await blob.text();
  diskCache.set(f, { lm: blob.lastModified, text });
  return text;
}

// [{ file, text }] for every open file that can still be read.
export async function allTexts() {
  const out = await Promise.all(
    state.files.map(async (file) => {
      try {
        return { file, text: await textOf(file) };
      } catch {
        return null; // moved, deleted, or permission lapsed
      }
    }),
  );
  return out.filter(Boolean);
}
