import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A fake Kore upload server behind a mocked `fetch`, following
 * api/internal/httpapi/uploads.go: POST /api/uploads, HEAD/PATCH/DELETE
 * /api/uploads/{id}, POST /api/uploads/{id}/complete.
 */
type Sess = { id: string; name: string; size: number; chunk: number; data: Uint8Array; received: number };
type Call = { method: string; path: string; offset?: number; bytes?: number };
/** Return a Response to short-circuit, "network" to throw like a dropped connection,
 *  or "after" to let the server process the request and then drop the response. */
type Fault = (call: Call, n: number) => Response | "network" | "after" | undefined;

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

function fakeServer() {
  const sessions = new Map<string, Sess>();
  const calls: Call[] = [];
  const nodes: { id: string; name: string; data: Uint8Array }[] = [];
  let fault: Fault | undefined;
  let seq = 0;

  async function handle(path: string, method: string, init: RequestInit): Promise<Response> {
    if (path === "/api/uploads" && method === "POST") {
      const b = JSON.parse(String(init.body)) as { name: string; size: number; chunk_size: number };
      const id = `up-${++seq}`;
      sessions.set(id, { id, name: b.name, size: b.size, chunk: b.chunk_size, data: new Uint8Array(b.size), received: 0 });
      return json(201, { id, received_bytes: 0, size: b.size, chunk_size: b.chunk_size });
    }
    const m = /^\/api\/uploads\/([^/]+)(\/complete)?$/.exec(path);
    const s = m ? sessions.get(decodeURIComponent(m[1])) : undefined;
    if (!m || !s) return method === "HEAD" ? new Response(null, { status: 404 }) : json(404, { error: "not_found" });
    if (m[2] && method === "POST") {
      if (s.received !== s.size) return json(409, { error: "incomplete" });
      sessions.delete(s.id);
      const node = { id: `node-${s.id}`, name: s.name, data: s.data };
      nodes.push(node);
      return json(201, { id: node.id, name: s.name, is_dir: false, size: s.size });
    }
    switch (method) {
      case "HEAD":
        return new Response(null, {
          status: 200,
          headers: { "Upload-Offset": String(s.received), "Upload-Length": String(s.size), "Upload-Chunk-Size": String(s.chunk) },
        });
      case "DELETE":
        sessions.delete(s.id);
        return new Response(null, { status: 204 });
      case "PATCH": {
        const off = Number(new Headers(init.headers).get("Upload-Offset"));
        const body = new Uint8Array(await (init.body as Blob).arrayBuffer());
        if (body.length > s.chunk) return json(413, { error: "chunk_too_large" });
        if (off !== s.received) return json(409, { error: "offset_mismatch" }, { "Upload-Offset": String(s.received) });
        s.data.set(body, off);
        s.received = off + body.length;
        return new Response(null, { status: 204, headers: { "Upload-Offset": String(s.received) } });
      }
    }
    return json(405, { error: "method_not_allowed" });
  }

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const path = String(input);
    const method = init.method ?? "GET";
    if (init.signal?.aborted) throw new DOMException("aborted", "AbortError");
    const call: Call = { method, path };
    if (method === "PATCH") {
      call.offset = Number(new Headers(init.headers).get("Upload-Offset"));
      call.bytes = (init.body as Blob).size;
    }
    calls.push(call);
    const f = fault?.(call, calls.filter((c) => c.method === method).length);
    if (f === "network") throw new TypeError("Failed to fetch");
    if (f instanceof Response) return f;
    const res = await handle(path, method, init);
    if (f === "after") throw new TypeError("Failed to fetch");
    return res;
  });

  return {
    sessions,
    calls,
    nodes,
    fetchMock,
    setFault: (f: Fault | undefined) => (fault = f),
    patches: () => calls.filter((c) => c.method === "PATCH"),
    count: (method: string, suffix = "") => calls.filter((c) => c.method === method && c.path.endsWith(suffix)).length,
  };
}

class MemoryStorage {
  private m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  clear() {
    this.m.clear();
  }
}

function bytes(n: number): Uint8Array<ArrayBuffer> {
  const a = new Uint8Array(n);
  for (let i = 0; i < n; i++) a[i] = (i * 31 + 7) & 0xff;
  return a;
}

const target = { space: "personal" as const, parent: null };
const KB4 = 4096;

async function load() {
  return import("../upload");
}

describe("uploadFile", () => {
  let srv: ReturnType<typeof fakeServer>;
  let store: MemoryStorage;

  beforeEach(() => {
    vi.resetModules();
    srv = fakeServer();
    store = new MemoryStorage();
    vi.stubGlobal("fetch", srv.fetchMock);
    vi.stubGlobal("localStorage", store);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uploads in chunks of chunkBytes", async () => {
    const { uploadFile } = await load();
    const data = bytes(10_000);
    const progress: number[] = [];
    const res = await uploadFile(new File([data], "a.bin", { lastModified: 1 }), target, {
      chunkBytes: KB4,
      onProgress: (n) => progress.push(n),
    });

    expect(srv.patches().map((p) => [p.offset, p.bytes])).toEqual([
      [0, 4096],
      [4096, 4096],
      [8192, 1808],
    ]);
    expect(progress).toEqual([0, 4096, 8192, 10_000]);
    expect(srv.count("POST", "/complete")).toBe(1);
    expect(res.nodeId).toBe(srv.nodes[0].id);
    expect(srv.nodes[0].data).toEqual(data);
    expect(store.length).toBe(0); // resume key removed on completion
  });

  it("defaults to 8 MiB chunks", async () => {
    const { uploadFile, DEFAULT_CHUNK_BYTES } = await load();
    expect(DEFAULT_CHUNK_BYTES).toBe(8 * 1024 * 1024);
    await uploadFile(new File([bytes(100)], "s.bin"), target, { onProgress: () => {} });
    const create = srv.fetchMock.mock.calls.find(([path]) => String(path) === "/api/uploads");
    expect(JSON.parse(String(create?.[1]?.body)).chunk_size).toBe(8 * 1024 * 1024);
  });

  it("resumes from server offset after a failed chunk", async () => {
    const { uploadFile } = await load();
    const data = bytes(10_000);
    // The second chunk reaches the server but its response is lost.
    srv.setFault((c, n) => (c.method === "PATCH" && n === 2 ? "after" : undefined));
    await uploadFile(new File([data], "a.bin"), target, { chunkBytes: KB4, onProgress: () => {}, retryDelayMs: 0 });

    expect(srv.count("HEAD")).toBe(1);
    // Chunk 2 is not re-sent: the HEAD offset says the server already has it.
    expect(srv.patches().map((p) => p.offset)).toEqual([0, 4096, 8192]);
    expect(srv.nodes[0].data).toEqual(data);
  });

  it("re-sends a chunk the server did not get", async () => {
    const { uploadFile } = await load();
    const data = bytes(10_000);
    srv.setFault((c, n) => (c.method === "PATCH" && n === 2 ? "network" : undefined));
    await uploadFile(new File([data], "a.bin"), target, { chunkBytes: KB4, onProgress: () => {}, retryDelayMs: 0 });
    expect(srv.patches().map((p) => p.offset)).toEqual([0, 4096, 4096, 8192]);
    expect(srv.nodes[0].data).toEqual(data);
  });

  it("reuses stored upload id after reload", async () => {
    const data = bytes(10_000);
    const file = () => new File([data], "movie.mp4", { lastModified: 1234 });
    let mod = await load();
    // First page: chunk 1 lands, then the network goes away for good.
    srv.setFault((c, n) => (c.method === "PATCH" && n > 1 ? "network" : undefined));
    await expect(
      mod.uploadFile(file(), target, { chunkBytes: KB4, onProgress: () => {}, retryDelayMs: 0 }),
    ).rejects.toMatchObject({ status: 503 });
    expect(store.getItem(mod.resumeKey(file(), target))).toContain("up-1");
    expect(srv.count("DELETE")).toBe(0); // the session is kept for resuming

    // "Reload": fresh module state, same localStorage, network back.
    vi.resetModules();
    srv.setFault(undefined);
    srv.calls.length = 0;
    mod = await load();
    const progress: number[] = [];
    await mod.uploadFile(file(), target, { chunkBytes: KB4, onProgress: (n) => progress.push(n), retryDelayMs: 0 });

    expect(srv.count("POST", "/api/uploads")).toBe(0); // no new session
    expect(srv.count("HEAD")).toBe(1);
    expect(srv.patches().map((p) => p.offset)).toEqual([4096, 8192]);
    expect(progress[0]).toBe(4096);
    expect(srv.nodes).toHaveLength(1);
    expect(srv.nodes[0].data).toEqual(data);
    expect(store.length).toBe(0);
  });

  it("starts fresh when the stored upload id no longer exists", async () => {
    const { uploadFile, resumeKey } = await load();
    const file = new File([bytes(5000)], "x.bin", { lastModified: 5 });
    store.setItem(resumeKey(file, target), JSON.stringify({ id: "gone" }));
    await uploadFile(file, target, { chunkBytes: KB4, onProgress: () => {} });
    expect(srv.calls[0]).toMatchObject({ method: "HEAD", path: "/api/uploads/gone" });
    expect(srv.count("POST", "/api/uploads")).toBe(1);
    expect(srv.nodes).toHaveLength(1);
  });

  it("does not share a stored id with a different target folder", async () => {
    const { resumeKey } = await load();
    const file = new File([bytes(10)], "x.bin", { lastModified: 5 });
    expect(resumeKey(file, target)).not.toBe(resumeKey(file, { space: "personal", parent: "f1" }));
    expect(resumeKey(file, target)).not.toBe(resumeKey(file, { space: "shared", parent: null }));
  });

  it.each([
    [413, "file_too_large"],
    [507, "quota_exceeded"],
  ])("does not retry %i at create", async (status, code) => {
    const { uploadFile } = await load();
    srv.setFault((c) => (c.method === "POST" && c.path === "/api/uploads" ? json(status, { error: code }) : undefined));
    await expect(
      uploadFile(new File([bytes(10)], "a.bin"), target, { onProgress: () => {}, retryDelayMs: 0 }),
    ).rejects.toMatchObject({ status, code });
    expect(srv.count("POST")).toBe(1);
    expect(store.length).toBe(0);
  });

  it("does not retry a 413 chunk and drops the session", async () => {
    const { uploadFile } = await load();
    srv.setFault((c) => (c.method === "PATCH" ? json(413, { error: "chunk_too_large" }) : undefined));
    await expect(
      uploadFile(new File([bytes(5000)], "a.bin"), target, { chunkBytes: KB4, onProgress: () => {}, retryDelayMs: 0 }),
    ).rejects.toMatchObject({ status: 413, code: "chunk_too_large" });
    expect(srv.patches()).toHaveLength(1);
    expect(srv.count("DELETE")).toBe(1);
    expect(srv.sessions.size).toBe(0);
    expect(store.length).toBe(0);
  });

  it("retries a failed chunk 3 times then fails", async () => {
    const { uploadFile } = await load();
    srv.setFault((c) => (c.method === "PATCH" ? json(503, { error: "unavailable" }) : undefined));
    await expect(
      uploadFile(new File([bytes(5000)], "a.bin"), target, { chunkBytes: KB4, onProgress: () => {}, retryDelayMs: 0 }),
    ).rejects.toMatchObject({ status: 503 });
    expect(srv.patches()).toHaveLength(4); // 1 try + 3 retries
    expect(srv.patches().every((p) => p.offset === 0)).toBe(true);
  });

  it("waits with exponential backoff between retries", async () => {
    vi.useFakeTimers();
    try {
      const { uploadFile } = await load();
      srv.setFault((c, n) => (c.method === "PATCH" && n <= 2 ? "network" : undefined));
      const p = uploadFile(new File([bytes(100)], "a.bin"), target, { onProgress: () => {}, retryDelayMs: 100 });
      await vi.advanceTimersByTimeAsync(99);
      expect(srv.patches()).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(srv.patches()).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(199);
      expect(srv.patches()).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(1);
      await p;
      expect(srv.patches()).toHaveLength(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries 423 upload_busy", async () => {
    const { uploadFile } = await load();
    srv.setFault((c, n) => (c.method === "PATCH" && n === 1 ? json(423, { error: "upload_busy" }) : undefined));
    await uploadFile(new File([bytes(100)], "a.bin"), target, { onProgress: () => {}, retryDelayMs: 0 });
    expect(srv.patches()).toHaveLength(2);
    expect(srv.nodes).toHaveLength(1);
  });

  it("re-syncs the offset from a 409", async () => {
    const { uploadFile } = await load();
    const data = bytes(10_000);
    // Another tab already sent the first chunk of this session.
    srv.setFault((c, n) => {
      if (c.method === "PATCH" && n === 1) {
        const s = [...srv.sessions.values()][0];
        s.data.set(data.subarray(0, KB4), 0);
        s.received = KB4;
      }
      return undefined;
    });
    await uploadFile(new File([data], "a.bin"), target, { chunkBytes: KB4, onProgress: () => {}, retryDelayMs: 0 });
    expect(srv.patches().map((p) => p.offset)).toEqual([0, 4096, 8192]);
    expect(srv.count("HEAD")).toBe(0); // the 409's Upload-Offset was enough
    expect(srv.nodes[0].data).toEqual(data);
  });

  it("abort deletes the upload", async () => {
    const { uploadFile, resumeKey } = await load();
    const ctl = new AbortController();
    const file = new File([bytes(10_000)], "a.bin");
    const p = uploadFile(file, target, {
      chunkBytes: KB4,
      signal: ctl.signal,
      onProgress: (n) => {
        if (n === KB4) ctl.abort();
      },
    });
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
    expect(srv.count("DELETE")).toBe(1);
    expect(srv.sessions.size).toBe(0);
    expect(srv.count("POST", "/complete")).toBe(0);
    expect(store.getItem(resumeKey(file, target))).toBeNull();
  });

  it("uploads a zero-byte file", async () => {
    const { uploadFile } = await load();
    const progress: number[] = [];
    const res = await uploadFile(new File([], "empty.txt"), target, { onProgress: (n) => progress.push(n) });
    expect(srv.patches()).toHaveLength(0);
    expect(srv.count("POST", "/complete")).toBe(1);
    expect(res.nodeId).toBe(srv.nodes[0].id);
    expect(progress).toEqual([0]);
  });

  it("clamps the localStorage chunk override", async () => {
    const { chunkBytesOverride } = await load();
    expect(chunkBytesOverride()).toBeUndefined();
    store.setItem("koreChunkBytes", "1048576");
    expect(chunkBytesOverride()).toBe(1 << 20);
    store.setItem("koreChunkBytes", "10");
    expect(chunkBytesOverride()).toBe(256 << 10);
    store.setItem("koreChunkBytes", String(1 << 30));
    expect(chunkBytesOverride()).toBe(64 << 20);
    store.setItem("koreChunkBytes", "nope");
    expect(chunkBytesOverride()).toBeUndefined();
  });
});
