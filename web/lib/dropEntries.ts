/**
 * Turns dropped or picked files (including whole directory trees) into
 * upload jobs: walks `DataTransferItem.webkitGetAsEntry()` trees (or the
 * `webkitRelativePath` of a folder `<input>`), recreates the folders with
 * `POST /api/nodes` (reusing same-named folders that already exist), and
 * returns each file with the folder it belongs in.
 */
import { api, isApiError } from "./api";
import type { ApiNode } from "./nodes";
import type { UploadTarget } from "./upload";

/** OS metadata files that are never uploaded. Everything else is, dotfiles included. */
const JUNK = new Set([".ds_store", "thumbs.db", "desktop.ini"]);

export function isJunk(name: string): boolean {
  return JUNK.has(name.toLowerCase());
}

/** A file and the folder path it sits in, relative to the drop target. */
export type DroppedFile = { file: File; dirs: string[] };
/** Files plus every directory seen (so empty folders are recreated too). */
export type DropSet = { files: DroppedFile[]; dirs: string[][] };

/** The subset of the File and Directory Entries API used here. */
type Entry = {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file?: (ok: (f: File) => void, err: (e: unknown) => void) => void;
  createReader?: () => { readEntries: (ok: (es: Entry[]) => void, err: (e: unknown) => void) => void };
};

async function walk(entry: Entry, prefix: string[], out: DropSet): Promise<void> {
  if (entry.isFile && entry.file) {
    if (isJunk(entry.name)) return;
    const file = await new Promise<File>((ok, err) => entry.file!(ok, err));
    out.files.push({ file, dirs: prefix });
    return;
  }
  if (entry.isDirectory && entry.createReader) {
    const path = [...prefix, entry.name];
    out.dirs.push(path);
    const reader = entry.createReader();
    // readEntries returns at most ~100 entries per call; read until empty.
    for (;;) {
      const batch = await new Promise<Entry[]>((ok, err) => reader.readEntries(ok, err));
      if (batch.length === 0) break;
      for (const child of batch) await walk(child, path, out);
    }
  }
}

/**
 * Everything dropped in `dt`. Must be called synchronously from the `drop`
 * handler: the item list is only readable during the event, so entries are
 * captured first and walked afterwards.
 */
export function collectDataTransfer(dt: DataTransfer): Promise<DropSet> {
  const entries: Entry[] = [];
  const plain: File[] = [];
  const items = dt.items ? [...dt.items] : [];
  if (items.length > 0) {
    for (const item of items) {
      if (item.kind !== "file") continue;
      const entry = (item.webkitGetAsEntry?.() ?? null) as Entry | null;
      if (entry) entries.push(entry);
      else {
        const f = item.getAsFile();
        if (f) plain.push(f);
      }
    }
  } else {
    plain.push(...dt.files);
  }
  return (async () => {
    const out: DropSet = { files: [], dirs: [] };
    for (const f of plain) if (!isJunk(f.name)) out.files.push({ file: f, dirs: [] });
    for (const e of entries) await walk(e, [], out);
    return out;
  })();
}

/** Files from an `<input type=file>` (with `webkitdirectory`, paths come from `webkitRelativePath`). */
export function collectInputFiles(files: Iterable<File>): DropSet {
  const out: DropSet = { files: [], dirs: [] };
  const seen = new Set<string>();
  for (const file of files) {
    const parts = (file.webkitRelativePath || file.name).split("/").filter(Boolean);
    const dirs = parts.slice(0, -1);
    for (let i = 1; i <= dirs.length; i++) {
      const key = JSON.stringify(dirs.slice(0, i));
      if (!seen.has(key)) {
        seen.add(key);
        out.dirs.push(dirs.slice(0, i));
      }
    }
    if (!isJunk(file.name)) out.files.push({ file, dirs });
  }
  return out;
}

export type FolderApi = {
  /** Creates folder `name` in `parent`; returns its id. */
  create(parent: UploadTarget, name: string): Promise<string>;
  /** The children of `parent`. */
  list(parent: UploadTarget): Promise<Pick<ApiNode, "id" | "name" | "is_dir">[]>;
};

export const httpFolderApi: FolderApi = {
  async create(parent, name) {
    const n = await api<ApiNode>("/api/nodes", {
      method: "POST",
      body: JSON.stringify({ space: parent.space, parent_id: parent.parent, name }),
    });
    return n.id;
  },
  async list(parent) {
    const q = new URLSearchParams({ space: parent.space });
    if (parent.parent) q.set("parent", parent.parent);
    return api<ApiNode[]>(`/api/nodes?${q}`);
  },
};

/** Runs at most `n` tasks at a time. */
function limiter(n: number) {
  let running = 0;
  const waiting: (() => void)[] = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (running >= n) await new Promise<void>((ok) => waiting.push(ok));
    running++;
    try {
      return await task();
    } finally {
      running--;
      waiting.shift()?.();
    }
  };
}

/**
 * Finds or creates folders below `root`. Each path is created at most once,
 * even when many files ask for it concurrently; a folder that already exists
 * (409 `name_taken`) is looked up in its parent and reused.
 */
export class FolderMaker {
  private readonly cache = new Map<string, Promise<string | null>>();
  private readonly limit = limiter(4);

  constructor(
    private readonly root: UploadTarget,
    private readonly folders: FolderApi = httpFolderApi,
  ) {}

  /** The folder id for `path` (`[]` is the root's parent). */
  ensure(path: string[]): Promise<string | null> {
    if (path.length === 0) return Promise.resolve(this.root.parent);
    const key = JSON.stringify(path);
    let p = this.cache.get(key);
    if (!p) {
      p = this.ensure(path.slice(0, -1)).then((parent) =>
        this.limit(() => this.createOrReuse({ space: this.root.space, parent }, path[path.length - 1])),
      );
      this.cache.set(key, p);
    }
    return p;
  }

  private async createOrReuse(parent: UploadTarget, name: string): Promise<string> {
    try {
      return await this.folders.create(parent, name);
    } catch (e) {
      if (!isApiError(e, 409)) throw e;
      const want = name.normalize("NFC");
      const existing = (await this.folders.list(parent)).find((n) => n.is_dir && n.name.normalize("NFC") === want);
      if (!existing) throw e; // a file holds the name
      return existing.id;
    }
  }
}

export type UploadPlan = {
  files: { file: File; target: UploadTarget }[];
  /** Folder paths ("a/b") that could not be created; their files are skipped. */
  failedFolders: string[];
};

/** Recreates the folders of `set` under `root` and pairs every file with its destination. */
export async function planUploads(set: DropSet, root: UploadTarget, folders: FolderApi = httpFolderApi): Promise<UploadPlan> {
  const maker = new FolderMaker(root, folders);
  const failedFolders: string[] = [];
  const results = await Promise.allSettled(set.dirs.map((d) => maker.ensure(d)));
  results.forEach((r, i) => {
    if (r.status === "rejected") failedFolders.push(set.dirs[i].join("/"));
  });
  const files: UploadPlan["files"] = [];
  for (const { file, dirs } of set.files) {
    try {
      files.push({ file, target: { space: root.space, parent: await maker.ensure(dirs) } });
    } catch {
      // Reported through failedFolders.
    }
  }
  // Only report the topmost failure of a branch.
  const top = failedFolders.filter((f) => !failedFolders.some((g) => g !== f && f.startsWith(`${g}/`)));
  return { files, failedFolders: top };
}
