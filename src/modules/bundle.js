/* The share bundle format — pure, so it can be tested in Node and so its shape
   is pinned in one place. share.js builds bundles from app state and mounts
   them; everything about bytes on the wire lives here.

   A bundle is JSON, gzipped and sealed by crypto.js:
     { v: 1, kind, name, files: [{ path, name, content }], assets?: [...] }

   `assets` (optional, added after v1 shipped) carries the images the documents
   reference: [{ path, type, data }] with `data` as base64url. It is additive,
   so v stays 1 — an older client opens a newer link and simply shows the
   images as missing, and a newer client opens old links unchanged.

   Never change what an existing field means: links already sent must keep
   opening. test/fixtures/v1-bundle.json holds one sealed by the first version. */

import { newKey, exportKey, importKey, seal, open, toB64url, fromB64url } from "./crypto.js";

export const BUNDLE_V = 1;
const KEY_BYTES = 32; // raw AES-256 key, appended to self-contained payloads

export async function sealBundle(bundle) {
  const key = await newKey();
  return { payload: await seal(key, JSON.stringify(bundle)), keyStr: await exportKey(key) };
}

export async function openBundle(payload, keyStr) {
  const bundle = JSON.parse(await open(await importKey(keyStr), payload));
  if (bundle.v !== BUNDLE_V) throw new Error("This link was made by a newer version of mdread");
  return bundle;
}

/* A self-contained (#d=) link has no `#k=` to carry the key separately, so it
   rides at the tail of the payload. Still never sent anywhere: the whole thing
   lives in the fragment. */
export function packInline(payload, keyStr) {
  const raw = fromB64url(keyStr);
  const all = new Uint8Array(payload.length + raw.length);
  all.set(payload, 0);
  all.set(raw, payload.length);
  return toB64url(all);
}

export function unpackInline(data) {
  const all = fromB64url(data);
  if (all.length <= KEY_BYTES) throw new Error("This link looks truncated");
  const split = all.length - KEY_BYTES;
  return { payload: all.subarray(0, split), keyStr: toB64url(all.subarray(split)) };
}

// Image bytes ⇄ the JSON-safe form stored in `assets`.
export const encodeAsset = (path, type, bytes) => ({ path, type, data: toB64url(bytes) });
export const decodeAsset = (a) => ({ path: a.path, type: a.type, bytes: fromB64url(a.data) });
