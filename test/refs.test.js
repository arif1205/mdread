import { describe, it, expect } from "vitest";
import { marked } from "marked";
import { resolvePath, localImageRefs, isLocalSrc, resolveWiki, resolveDocLink, linkTargets, isDocHref, splitHeading } from "../src/modules/refs.js";

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

const PATHS = ["index.md", "notes/Ideas.md", "notes/todo.md", "archive/todo.md", "archive/2024/Ideas.md", "projects/web/plan.markdown"];

describe("resolveWiki", () => {
  it("matches a bare name anywhere, case- and extension-insensitively", () => {
    expect(resolveWiki("plan", "index.md", PATHS)).toBe("projects/web/plan.markdown");
    expect(resolveWiki("IDEAS.md", "index.md", PATHS)).toBe("notes/Ideas.md");
  });

  it("prefers the linking document's own folder, then the shallowest", () => {
    expect(resolveWiki("todo", "archive/old.md", PATHS)).toBe("archive/todo.md");
    expect(resolveWiki("todo", "index.md", PATHS)).toBe("archive/todo.md"); // same depth → alphabetical
    expect(resolveWiki("Ideas", "index.md", PATHS)).toBe("notes/Ideas.md"); // shallower wins
  });

  it("treats a name with / as a path: relative, then root, then tail", () => {
    expect(resolveWiki("2024/Ideas", "archive/todo.md", PATHS)).toBe("archive/2024/Ideas.md");
    expect(resolveWiki("archive/todo", "notes/todo.md", PATHS)).toBe("archive/todo.md");
    expect(resolveWiki("web/plan", "index.md", PATHS)).toBe("projects/web/plan.markdown");
  });

  it("returns null when nothing matches", () => {
    expect(resolveWiki("nope", "index.md", PATHS)).toBeNull();
    expect(resolveWiki("", "index.md", PATHS)).toBeNull();
  });
});

describe("relative .md links", () => {
  it("resolves against the linking document", () => {
    expect(resolveDocLink("../archive/todo.md#later", "notes/Ideas.md", PATHS)).toBe("archive/todo.md");
    expect(resolveDocLink("todo.md", "notes/Ideas.md", PATHS)).toBe("notes/todo.md");
    expect(resolveDocLink("missing.md", "notes/Ideas.md", PATHS)).toBeNull();
  });

  it("isDocHref only claims links to documents", () => {
    for (const h of ["b.md", "../x/y.markdown#h", "notes.txt?x"]) expect(isDocHref(h)).toBe(true);
    for (const h of ["https://x.com/a.md", "#heading", "img.png", "mailto:a@b.c"]) expect(isDocHref(h)).toBe(false);
  });
});

describe("linkTargets (what backlinks are built from)", () => {
  it("finds wiki and markdown links, skipping embeds and dead links", () => {
    const md = "See [[Ideas]] and [[todo#Later|the list]].\n\n![[Ideas]] is an embed.\n\n[plan](../projects/web/plan.markdown) · [gone](gone.md) · [site](https://x.com/a.md)\n\n[[nope]]";
    expect(linkTargets(md, "notes/x.md", PATHS).map((t) => t.path)).toEqual(["notes/Ideas.md", "notes/todo.md", "projects/web/plan.markdown"]);
  });
});

describe("[[wiki link]] syntax in marked", () => {
  it("renders links, aliases, headings and image embeds", () => {
    const html = marked.parse("[[Ideas]] [[todo|my list]] [[plan#Phase 2]] [[#Local]] ![[pics/a b.png]]");
    expect(html).toContain('<a class="wikilink" href="#" data-wiki="Ideas">Ideas</a>');
    expect(html).toContain('data-wiki="todo">my list</a>');
    expect(html).toContain('data-wiki="plan#Phase 2">plan › Phase 2</a>');
    expect(html).toContain('data-wiki="#Local">Local</a>');
    expect(html).toContain('<img src="pics/a b.png" alt="a b.png">');
  });

  it("escapes what it puts in attributes", () => {
    expect(marked.parse('[[a"><script>x</script>]]')).not.toContain("<script>");
  });

  it("leaves code alone and lists embedded images as references", () => {
    expect(marked.parse("`[[Ideas]]`")).not.toContain("wikilink");
    expect(localImageRefs("![[pics/a.png]] ![[Ideas]]")).toEqual(["pics/a.png"]);
    expect(splitHeading("Note#Head")).toEqual(["Note", "Head"]);
  });
});
