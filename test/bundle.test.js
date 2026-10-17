import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { sealBundle, openBundle, packInline, unpackInline, encodeAsset, decodeAsset, BUNDLE_V } from "../src/modules/bundle.js";
import { fromB64url, importKeyRW, seal } from "../src/modules/crypto.js";

const fixture = JSON.parse(fs.readFileSync(new URL("./fixtures/v1-bundle.json", import.meta.url), "utf8"));

describe("links made by earlier versions keep opening", () => {
  it("opens the v1 stored-link fixture", async () => {
    expect(await openBundle(fromB64url(fixture.stored), fixture.keyStr)).toEqual(fixture.bundle);
  });

  it("opens the v1 self-contained (#d=) fixture", async () => {
    const { payload, keyStr } = unpackInline(fixture.inline);
    expect(keyStr).toBe(fixture.keyStr);
    expect(await openBundle(payload, keyStr)).toEqual(fixture.bundle);
  });
});

describe("bundle round-trip", () => {
  const bundle = {
    v: BUNDLE_V,
    kind: "file",
    name: "Doc",
    files: [{ path: "docs/a.md", name: "a.md", content: "![x](img/x.png)" }],
    assets: [encodeAsset("docs/img/x.png", "image/png", Uint8Array.from([137, 80, 78, 71, 0, 255]))],
  };

  it("stored links round-trip, assets included", async () => {
    const { payload, keyStr } = await sealBundle(bundle);
    const back = await openBundle(payload, keyStr);
    expect(back).toEqual(bundle);
    expect(decodeAsset(back.assets[0]).bytes).toEqual(Uint8Array.from([137, 80, 78, 71, 0, 255]));
  });

  it("self-contained links round-trip", async () => {
    const { payload, keyStr } = await sealBundle(bundle);
    const out = unpackInline(packInline(payload, keyStr));
    expect(await openBundle(out.payload, out.keyStr)).toEqual(bundle);
  });

  it("rejects a bundle from a newer version", async () => {
    const keyStr = fixture.keyStr;
    const payload = await seal(await importKeyRW(keyStr), JSON.stringify({ ...bundle, v: 2 }));
    await expect(openBundle(payload, keyStr)).rejects.toThrow(/newer version/);
  });

  it("rejects a truncated self-contained link", () => {
    expect(() => unpackInline("AAAA")).toThrow(/truncated/);
  });
});
