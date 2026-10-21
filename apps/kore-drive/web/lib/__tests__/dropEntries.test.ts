import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../api";
import { collectDataTransfer, collectInputFiles, FolderMaker, isJunk, planUploads, type FolderApi } from "../dropEntries";

type FakeEntry = {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file?: (ok: (f: File) => void) => void;
  createReader?: () => { readEntries: (ok: (es: FakeEntry[]) => void) => void };
};

const fileEntry = (name: string): FakeEntry => ({
  isFile: true,
  isDirectory: false,
  name,
  file: (ok) => ok(new File([name], name)),
});

/** A directory whose reader hands out children in batches of 2, like browsers do in batches of 100. */
const dirEntry = (name: string, children: FakeEntry[]): FakeEntry => ({
  isFile: false,
  isDirectory: true,
  name,
  createReader: () => {
    let i = 0;
    return {
      readEntries: (ok) => {
        ok(children.slice(i, i + 2));
        i += 2;
      },
    };
  },
});

function dataTransfer(entries: (FakeEntry | File)[]): DataTransfer {
  const items = entries.map((e) => ({
    kind: "file",
    webkitGetAsEntry: () => (e instanceof File ? null : e),
    getAsFile: () => (e instanceof File ? e : null),
  }));
  return { items, files: [] } as unknown as DataTransfer;
}

describe("dropEntries", () => {
  it("skips only OS junk files", () => {
    expect(isJunk(".DS_Store")).toBe(true);
    expect(isJunk("Thumbs.db")).toBe(true);
    expect(isJunk("desktop.ini")).toBe(true);
    expect(isJunk(".env")).toBe(false);
    expect(isJunk(".gitignore")).toBe(false);
  });

  it("walks dropped directory trees", async () => {
    const tree = dirEntry("photos", [
      fileEntry("a.jpg"),
      fileEntry(".DS_Store"),
      fileEntry(".hidden"),
      dirEntry("2024", [fileEntry("b.jpg")]),
      dirEntry("empty", []),
    ]);
    const set = await collectDataTransfer(dataTransfer([tree, new File(["x"], "loose.txt")]));
    expect(set.files.map((f) => [...f.dirs, f.file.name].join("/")).sort()).toEqual(
      ["loose.txt", "photos/.hidden", "photos/2024/b.jpg", "photos/a.jpg"].sort(),
    );
    expect(set.dirs.map((d) => d.join("/")).sort()).toEqual(["photos", "photos/2024", "photos/empty"]);
  });

  it("reads folder input paths", () => {
    const mk = (path: string) => {
      const f = new File(["x"], path.split("/").pop()!);
      Object.defineProperty(f, "webkitRelativePath", { value: path });
      return f;
    };
    const set = collectInputFiles([mk("root/a.txt"), mk("root/sub/b.txt"), mk("root/sub/Thumbs.db")]);
    expect(set.dirs).toEqual([["root"], ["root", "sub"]]);
    expect(set.files.map((f) => f.dirs.join("/") + ":" + f.file.name)).toEqual(["root:a.txt", "root/sub:b.txt"]);
  });

  it("creates each folder once and reuses existing ones on 409", async () => {
    let n = 0;
    const api: FolderApi = {
      create: vi.fn(async (parent, name) => {
        await new Promise((r) => setTimeout(r, 1));
        if (name === "exists") throw new ApiError(409, "name_taken");
        return `${parent.parent ?? "root"}/${name}#${++n}`;
      }),
      list: vi.fn(async () => [
        { id: "file-id", name: "exists", is_dir: false },
        { id: "existing-id", name: "exists", is_dir: true },
      ]),
    };
    const maker = new FolderMaker({ space: "personal", parent: null }, api);
    const ids = await Promise.all([maker.ensure(["a", "b"]), maker.ensure(["a", "b"]), maker.ensure(["a"]), maker.ensure(["exists"])]);
    expect(ids[0]).toBe(ids[1]);
    expect(ids[0]).toMatch(/^root\/a#\d\/b#\d$/);
    expect(ids[3]).toBe("existing-id");
    expect(api.create).toHaveBeenCalledTimes(3);
  });

  it("plans uploads into the recreated folders and reports failures", async () => {
    const api: FolderApi = {
      create: async (parent, name) => {
        if (name === "bad") throw new ApiError(400, "invalid_name");
        return `id-${name}`;
      },
      list: async () => [],
    };
    const f = (name: string) => new File(["x"], name);
    const plan = await planUploads(
      {
        dirs: [["top"], ["top", "bad"], ["top", "bad", "deeper"]],
        files: [
          { file: f("1"), dirs: [] },
          { file: f("2"), dirs: ["top"] },
          { file: f("3"), dirs: ["top", "bad", "deeper"] },
        ],
      },
      { space: "shared", parent: "p" },
      api,
    );
    expect(plan.files.map((x) => [x.file.name, x.target])).toEqual([
      ["1", { space: "shared", parent: "p" }],
      ["2", { space: "shared", parent: "id-top" }],
    ]);
    expect(plan.failedFolders).toEqual(["top/bad"]);
  });
});
