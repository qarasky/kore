import { describe, expect, it } from "vitest";
import { defaultLineNumbers, isMarkdown, isPreviewable, previewable, safeLinkHref, splitLines } from "../preview";

describe("isPreviewable (mirrors api/internal/httpapi/preview.go)", () => {
  it.each(["a.txt", "A.TXT", "notes.md", "x.markdown", "main.go", "app.tsx", "data.json", "Dockerfile", "Makefile",
    "README", "LICENSE", ".gitignore", ".env", "build.dockerfile", "page.html"])("%s is previewable", (n) => {
    expect(isPreviewable(n)).toBe(true);
  });

  it.each(["photo.jpg", "doc.pdf", "a.zip", "noext", "readme", "file.", "report.docx", "a.txt.exe", ""])(
    "%s is not",
    (n) => {
      expect(isPreviewable(n)).toBe(false);
    },
  );

  it("keeps the same extension list as the Go server", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile(new URL("../../../api/internal/httpapi/preview.go", import.meta.url), "utf8");
    const exts = /strings\.Fields\(`([^`]*)`\)/.exec(src)?.[1].split(/\s+/).filter(Boolean) ?? [];
    const names = [...(/\[\]string\{([^}]*)\}/.exec(src)?.[1].matchAll(/"([^"]+)"/g) ?? [])].map((m) => m[1]);
    expect(exts.length).toBeGreaterThan(10);
    expect(names.length).toBeGreaterThan(3);
    for (const e of exts) expect(isPreviewable(`f.${e}`), e).toBe(true);
    for (const n of names) expect(isPreviewable(n), n).toBe(true);
  });
});

describe("isMarkdown / defaultLineNumbers", () => {
  it("detects markdown", () => {
    expect(isMarkdown("a.md")).toBe(true);
    expect(isMarkdown("A.Markdown")).toBe(true);
    expect(isMarkdown("a.mdx")).toBe(false);
  });

  it("numbers lines for code, not prose", () => {
    expect(defaultLineNumbers("main.go")).toBe(true);
    expect(defaultLineNumbers("conf.yaml")).toBe(true);
    expect(defaultLineNumbers("notes.txt")).toBe(false);
    expect(defaultLineNumbers("README")).toBe(false);
  });
});

describe("splitLines", () => {
  it("handles all newline styles and a trailing newline", () => {
    expect(splitLines("a\nb\r\nc\rd")).toEqual(["a", "b", "c", "d"]);
    expect(splitLines("a\nb\n")).toEqual(["a", "b"]);
    expect(splitLines("")).toEqual([""]);
    expect(splitLines("\n")).toEqual([""]);
    expect(splitLines("a\n\n")).toEqual(["a", ""]);
  });
});

describe("previewable", () => {
  it("keeps text files in order and drops folders", () => {
    const nodes = [
      { id: "1", is_dir: true, name: "docs.md" },
      { id: "2", is_dir: false, name: "b.txt" },
      { id: "3", is_dir: false, name: "c.png" },
      { id: "4", is_dir: false, name: "a.md" },
    ];
    expect(previewable(nodes).map((n) => n.id)).toEqual(["2", "4"]);
  });
});

describe("safeLinkHref (markdown links)", () => {
  it.each([
    ["https://example.com/a?b=1#c", "https://example.com/a?b=1#c"],
    ["http://example.com", "http://example.com/"],
    ["  HTTPS://Example.com/x ", "https://example.com/x"],
    ["mailto:someone@example.com", "mailto:someone@example.com"],
  ])("keeps %s as an external link", (raw, href) => {
    expect(safeLinkHref(raw)).toEqual({ href, external: true });
  });

  it("keeps in-document fragments as internal links", () => {
    expect(safeLinkHref("#user-content-fn-1")).toEqual({ href: "#user-content-fn-1", external: false });
  });

  it.each([
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    " javascript:alert(1)",
    "java\tscript:alert(1)",
    "java\nscript:alert(1)",
    "\u0001javascript:alert(1)",
    "jav&#x09;ascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "DATA:text/html;base64,PHNjcmlwdD4=",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
    "ftp://example.com",
    "//evil.example.com/x",
    "/api/nodes/x/download",
    "relative/page.md",
    "",
    "   ",
  ])("drops %j", (raw) => {
    expect(safeLinkHref(raw)).toBeNull();
  });

  it("drops non-strings", () => {
    expect(safeLinkHref(undefined)).toBeNull();
    expect(safeLinkHref(null)).toBeNull();
  });
});
