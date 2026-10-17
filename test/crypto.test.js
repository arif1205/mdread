import { describe, it, expect } from "vitest";
import {
  toB64url, fromB64url, newKey, exportKey, importKey, importKeyRW,
  seal, open, sealBytes, openBytes, deriveVaultKey, normalizeEmail,
} from "../src/modules/crypto.js";

const bytes = (n, f = (i) => i % 256) => Uint8Array.from({ length: n }, (_, i) => f(i));

describe("base64url", () => {
  it("round-trips every byte value and odd lengths", () => {
    for (const n of [0, 1, 2, 3, 4, 255, 256, 1000]) {
      const b = bytes(n);
      expect(fromB64url(toB64url(b))).toEqual(b);
    }
  });

  it("is URL-safe and unpadded", () => {
    const s = toB64url(bytes(256));
    expect(s).not.toMatch(/[+/=]/);
  });

  it("explains a damaged link instead of throwing atob's error", () => {
    expect(() => fromB64url("not*valid")).toThrow(/damaged/);
  });
});

describe("seal / open", () => {
  it("round-trips unicode text", async () => {
    const key = await newKey();
    const text = "# Café ☕ — naïve façade 日本語 🎉\n".repeat(50);
    expect(await open(key, await seal(key, text))).toBe(text);
  });

  it("uses a fresh IV every time", async () => {
    const key = await newKey();
    const a = await seal(key, "same");
    const b = await seal(key, "same");
    expect(toB64url(a)).not.toBe(toB64url(b));
  });

  it("gzips text (flag byte set) and shrinks repetitive input", async () => {
    const key = await newKey();
    const text = "lorem ipsum ".repeat(2000);
    const payload = await seal(key, text);
    expect(payload[0]).toBe(1); // format
    expect(payload[1] & 1).toBe(1); // gzip flag
    expect(payload.length).toBeLessThan(text.length / 10);
  });

  it("rejects the wrong key with a readable message", async () => {
    const payload = await seal(await newKey(), "secret");
    await expect(open(await newKey(), payload)).rejects.toThrow(/key is wrong or incomplete/);
  });

  it("rejects tampered ciphertext (GCM auth tag)", async () => {
    const key = await newKey();
    const payload = await seal(key, "secret");
    payload[payload.length - 1] ^= 1;
    await expect(open(key, payload)).rejects.toThrow(/Could not decrypt/);
  });

  it("rejects truncated payloads and unknown formats", async () => {
    const key = await newKey();
    await expect(open(key, bytes(10))).rejects.toThrow(/truncated/);
    const payload = await seal(key, "x");
    payload[0] = 9;
    await expect(open(key, payload)).rejects.toThrow(/Unsupported share format \(v9\)/);
  });
});

describe("keys", () => {
  it("export → import round-trips", async () => {
    const key = await newKey();
    const str = await exportKey(key);
    expect(fromB64url(str)).toHaveLength(32);
    expect(await open(await importKey(str), await seal(key, "hi"))).toBe("hi");
  });

  it("explains a truncated key", () => {
    expect(() => importKey(toB64url(bytes(20)))).toThrow(/key is incomplete/);
  });

  it("a share-link key can decrypt but never encrypt", async () => {
    const str = await exportKey(await newKey());
    const readOnly = await importKey(str);
    await expect(seal(readOnly, "x")).rejects.toThrow();
    const rw = await importKeyRW(str);
    expect(await open(readOnly, await seal(rw, "x"))).toBe("x");
  });
});

describe("sealBytes (co-editing frames)", () => {
  it("skips gzip below 512 bytes and uses it above", async () => {
    const key = await newKey();
    const small = await sealBytes(key, bytes(100));
    const large = await sealBytes(key, bytes(4000, () => 7));
    expect(small[1] & 1).toBe(0);
    expect(large[1] & 1).toBe(1);
    expect(await openBytes(key, small)).toEqual(bytes(100));
    expect(await openBytes(key, large)).toEqual(bytes(4000, () => 7));
  });
});

describe("vault key", () => {
  it("is deterministic per normalised email + password, and non-extractable", async () => {
    const a = await deriveVaultKey("  Someone@Example.com ", "correct horse");
    const b = await deriveVaultKey("someone@example.com", "correct horse");
    const other = await deriveVaultKey("someone@example.com", "wrong horse");
    const payload = await seal(a, "vault");
    expect(await open(b, payload)).toBe("vault");
    await expect(open(other, payload)).rejects.toThrow();
    // CLAUDE.md: the derived key must never be extractable.
    await expect(exportKey(a)).rejects.toThrow();
    expect(normalizeEmail(" A@B.C ")).toBe("a@b.c");
  }, 20000);
});
