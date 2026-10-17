import { describe, it, expect } from "vitest";
import { resolvePath, localImageRefs, isLocalSrc } from "../src/modules/refs.js";

describe("resolvePath", () => {
  it("resolves against the document's folder", () => {
    expect(resolvePath("docs/guide.md", "img/a.png")).toBe("docs/img/a.png");
    expect(resolvePath("docs/guide.md", "./img/a.png")).toBe("docs/img/a.png");
    expect(resolvePath("guide.md", "a.png")).toBe("a.png");
  });

  it("climbs with .. but never out of the folder", () => {
    expect(resolvePath("docs/deep/guide.md", "../../shared/b.png")).toBe("shared/b.png");
    expect(resolvePath("docs/guide.md", "../../escape.png")).toBeNull();
  });

  it("treats a leading / as the folder root, and drops query/hash", () => {
    expect(resolvePath("docs/guide.md", "/assets/c.png?v=2#x")).toBe("assets/c.png");
  });

  it("decodes percent-encoding", () => {
    expect(resolvePath("docs/guide.md", "img/red%20dot.png")).toBe("docs/img/red dot.png");
  });
});

describe("localImageRefs", () => {
  it("finds markdown images and raw <img> tags, skipping remote ones", () => {
    const md = [
      "![a](img/a.png)",
      '![b](<img/with space.png> "title")',
      "![remote](https://example.com/r.png)",
      '<img src="raw/c.png" width="40">',
      "<img src='raw/d.png'>",
      "![data](data:image/png;base64,AAAA)",
      "![a again](img/a.png)",
      "`![not an image](code.png)`",
    ].join("\n\n");
    expect(localImageRefs(md).sort()).toEqual(["img/a.png", "img/with space.png", "raw/c.png", "raw/d.png"].sort());
  });

  it("isLocalSrc", () => {
    expect(isLocalSrc("a.png")).toBe(true);
    for (const s of ["https://x/a.png", "//cdn/a.png", "data:x", "blob:x", "#frag", ""]) expect(isLocalSrc(s)).toBe(false);
  });
});
