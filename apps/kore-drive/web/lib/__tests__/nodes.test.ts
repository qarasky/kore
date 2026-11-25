import { describe, expect, it } from "vitest";
import { downloadHref, fileKind, folderHref } from "../nodes";

describe("folderHref", () => {
  it("maps spaces to section roots", () => {
    expect(folderHref("personal")).toBe("/files");
    expect(folderHref("shared", null)).toBe("/shared");
    expect(folderHref("shared", "abc")).toBe("/shared/abc");
    expect(folderHref("personal", "a/b")).toBe("/files/a%2Fb");
  });

  it("encodes download ids", () => {
    expect(downloadHref("x y")).toBe("/api/nodes/x%20y/download");
  });
});

describe("fileKind", () => {
  const f = (name: string, mime = "") => fileKind({ is_dir: false, name, mime });
  it("classifies by extension, then MIME", () => {
    expect(fileKind({ is_dir: true, name: "photo.jpg", mime: "" })).toBe("folder");
    expect(f("Photo.JPG")).toBe("image");
    expect(f("demo.mp4")).toBe("video");
    expect(f("report.pdf")).toBe("pdf");
    expect(f("backup.tar")).toBe("archive");
    expect(f("main.go")).toBe("code");
    expect(f("notes.md")).toBe("text");
    expect(f("noext", "image/png")).toBe("image");
    expect(f("noext", "text/plain")).toBe("text");
    expect(f(".bashrc")).toBe("file");
    expect(f("blob.bin", "application/octet-stream")).toBe("file");
  });
});
