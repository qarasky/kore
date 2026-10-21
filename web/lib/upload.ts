/**
 * Chunked, resumable upload of one file over the Go API's upload protocol
 * (`api/internal/httpapi/uploads.go`):
 *
 *   POST   /api/uploads            {space, parent, name, size, chunk_size} -> {id, received_bytes}
 *   HEAD   /api/uploads/{id}       -> Upload-Offset / Upload-Length / Upload-Chunk-Size headers
 *   PATCH  /api/uploads/{id}       Upload-Offset header, body <= chunk_size -> 204 + new Upload-Offset
 *   POST   /api/uploads/{id}/complete -> the new node
 *   DELETE /api/uploads/{id}       cancels and releases the quota reservation
 *
 * Chunks are `file.slice()`s sent with `fetch`, so the file is never read into
 * memory as a whole. Progress is reported per chunk, as the bytes the server
 * has confirmed (fetch has no upload progress events; with 8 MiB chunks that
 * is a step every few seconds even on slow links, and it never overstates
 * what is durable). Browser-only (uses same-origin `/api` paths).
 */
import { ApiError } from "./api";
import type { Space } from "./nodes";

export const DEFAULT_CHUNK_BYTES = 8 << 20; // well under Cloudflare's 100 MB body limit
/** Server bounds for chunk_size (uploads.MinChunkSize / MaxChunkSize). */
const SERVER_MIN_CHUNK = 1 << 10;
const SERVER_MAX_CHUNK = 64 << 20;
/** Retries of one failed request before giving up. */
export const MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 500;
const STORAGE_PREFIX = "kore.upload:";

/** `localStorage.koreChunkBytes` (tests and diagnostics) is clamped to this range. */
export const CHUNK_OVERRIDE_MIN = 256 << 10;
export const CHUNK_OVERRIDE_MAX = 64 << 20;

export type UploadTarget = { space: Space; parent: string | null };

export type UploadOptions = {
  chunkBytes?: number;
  /** Bytes confirmed by the server so far. */
  onProgress(n: number): void;
  signal?: AbortSignal;
  /** Base backoff delay; doubles per retry (tests pass 0). */
  retryDelayMs?: number;
};

/** An API error that also carries the response's Upload-Offset header (set on 409). */
class UploadHttpError extends ApiError {
  readonly offset: number | null;
  constructor(status: number, code: string, offset: number | null) {
    super(status, code);
    this.offset = offset;
  }
}

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // access denied (privacy settings)
  }
}

/**
 * The chunk size set in `localStorage.koreChunkBytes`, clamped to
 * [256 KiB, 64 MiB], or undefined when unset/invalid. Safe in production:
 * any value in range is a valid chunk size for the server.
 */
export function chunkBytesOverride(): number | undefined {
  let raw: string | null = null;
  try {
    raw = storage()?.getItem("koreChunkBytes") ?? null;
  } catch {
    return undefined;
  }
  const n = raw === null ? NaN : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.min(CHUNK_OVERRIDE_MAX, Math.max(CHUNK_OVERRIDE_MIN, Math.floor(n)));
}

/** localStorage key identifying "this file going to this folder". */
export function resumeKey(file: File, target: UploadTarget): string {
  return STORAGE_PREFIX + JSON.stringify([file.name, file.size, file.lastModified, target.space, target.parent]);
}

function readStored(key: string): string | null {
  try {
    const raw = storage()?.getItem(key);
    if (!raw) return null;
    const v: unknown = JSON.parse(raw);
    return v && typeof v === "object" && "id" in v && typeof v.id === "string" ? v.id : null;
  } catch {
    return null;
  }
}

function writeStored(key: string, id: string) {
  try {
    storage()?.setItem(key, JSON.stringify({ id }));
  } catch {
    // Quota or privacy mode: resuming after a reload just won't be possible.
  }
}

function removeStored(key: string) {
  try {
    storage()?.removeItem(key);
  } catch {
    // ignore
  }
}

/** Keys of uploads running in this page, so two drops of the same file don't share a session. */
const activeKeys = new Set<string>();

const uploadPath = (id: string) => `/api/uploads/${encodeURIComponent(id)}`;

function abortError(): DOMException {
  return new DOMException("Upload canceled", "AbortError");
}

async function errorCode(res: Response): Promise<string> {
  try {
    const body: unknown = await res.json();
    if (body && typeof body === "object" && "error" in body && typeof body.error === "string") return body.error;
  } catch {
    // not JSON
  }
  return `http_${res.status}`;
}

/**
 * Transient: network errors (mapped to 503), 5xx except 507 (quota exceeded,
 * which waiting won't fix), and 423 (another request for the upload is still
 * in flight on the server).
 */
function transient(e: unknown): boolean {
  return e instanceof ApiError && ((e.status >= 500 && e.status !== 507) || e.status === 423);
}

/** Retryable for a chunk: transient, or 409 (offset mismatch; re-sync and resend). */
function chunkRetryable(e: unknown): boolean {
  return transient(e) || (e instanceof ApiError && e.status === 409);
}

function offsetHeader(res: Response): number | null {
  const v = res.headers.get("Upload-Offset");
  if (v === null || v.trim() === "") return null;
  const n = Number(v);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    if (ms <= 0) return resolve();
    const onAbort = () => {
      clearTimeout(id);
      reject(abortError());
    };
    const id = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** fetch that maps network failures to a 503 and non-2xx to an {@link UploadHttpError}. */
async function send(path: string, init: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(path, { ...init, credentials: "same-origin" });
  } catch (e) {
    if (init.signal?.aborted) throw abortError();
    throw new UploadHttpError(503, e instanceof TypeError ? "unreachable" : "network", null);
  }
  if (!res.ok) {
    const code = init.method === "HEAD" ? `http_${res.status}` : await errorCode(res);
    throw new UploadHttpError(res.status, code, offsetHeader(res));
  }
  return res;
}

type Session = { id: string; offset: number; chunk: number; size: number };

/** HEAD: the server's view of a session; null when it no longer exists (404). */
async function head(id: string, signal?: AbortSignal): Promise<Session | null> {
  try {
    const res = await send(uploadPath(id), { method: "HEAD", signal, cache: "no-store" });
    const offset = offsetHeader(res);
    const chunk = Number(res.headers.get("Upload-Chunk-Size"));
    const size = Number(res.headers.get("Upload-Length"));
    if (offset === null || !Number.isSafeInteger(chunk) || chunk <= 0 || !Number.isSafeInteger(size)) {
      throw new ApiError(502, "bad_response");
    }
    return { id, offset, chunk, size };
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

/** Escapes `s` for use inside a RegExp. */
const reEscape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The node a completed upload of `file` most likely became: a file in
 * `target` named `file.name` or its unique-name variant (`stem (N).ext`, see
 * nodes.UniqueName) with the same size, newest first. Used when the completion
 * response was lost; undefined if it can't be found.
 */
async function findCompletedNode(file: File, target: UploadTarget): Promise<string | undefined> {
  const name = file.name.normalize("NFC");
  const dot = name.lastIndexOf(".");
  const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
  const variant = new RegExp(`^${reEscape(stem)} \\(\\d+\\)${reEscape(ext)}$`);
  const q = new URLSearchParams({ space: target.space });
  if (target.parent) q.set("parent", target.parent);
  try {
    const res = await send(`/api/nodes?${q}`, { method: "GET", headers: { accept: "application/json" } });
    const list = (await res.json()) as { id: string; name: string; is_dir: boolean; size: number; updated_at: number }[];
    const hits = list
      .filter((n) => !n.is_dir && n.size === file.size && (n.name.normalize("NFC") === name || variant.test(n.name.normalize("NFC"))))
      .sort((x, y) => y.updated_at - x.updated_at);
    return hits[0]?.id;
  } catch {
    return undefined;
  }
}

/** Not worth giving up the session for: transient, or signed out (sign in again, then resume). */
function resumable(e: unknown): boolean {
  return transient(e) || (e instanceof ApiError && e.status === 401);
}

/**
 * Forgets a stored, unfinished upload of `file` to `target` (e.g. when its
 * failed item is cleared from the tray): deletes the server session, which
 * releases its quota reservation, and removes the resume key. Does nothing
 * while an upload of the same file to the same target is running.
 */
export async function discardUpload(file: File, target: UploadTarget): Promise<void> {
  const key = resumeKey(file, target);
  if (activeKeys.has(key)) return;
  const id = readStored(key);
  removeStored(key);
  if (!id) return;
  try {
    await fetch(uploadPath(id), { method: "DELETE", credentials: "same-origin" });
  } catch {
    // The server sweeps abandoned sessions.
  }
}

/**
 * Uploads `file` into `target` and resolves with the new node's id (the
 * server picks the final, unique name). See the module comment for the
 * protocol; behaviour:
 *
 * - A failed request is retried up to {@link MAX_RETRIES} times with
 *   exponential backoff when it is a network error, 5xx, 423 or 409; before
 *   re-sending a chunk the offset is re-synced (from a 409's Upload-Offset,
 *   else via HEAD), so bytes the server already has are not sent twice.
 *   Other 4xx (413 too large, 507 quota, 404 gone, 400 bad name) fail at once.
 * - The session id is kept in localStorage under {@link resumeKey}, so after a
 *   reload (or a retry) the same file to the same folder resumes from the
 *   server's offset. The key is removed on completion, cancel and fatal
 *   errors; when retries run out, or the session expired (401), the key and
 *   the server session are kept so a later attempt resumes.
 * - Aborting `signal` stops the transfer and deletes the server session.
 * - A completion whose response was lost (network error, 5xx, 423) is
 *   detected by the next attempt's 404 plus a HEAD 404 (a successful
 *   Complete deletes the session; a failed one keeps it). The upload then
 *   counts as done; `nodeId` is the node found in `target`, or undefined if
 *   it can't be identified. The same check runs when a cancel races a
 *   completion, so a finished file is never reported as canceled.
 */
export async function uploadFile(
  file: File,
  target: UploadTarget,
  opts: UploadOptions,
): Promise<{ nodeId?: string }> {
  const { signal, onProgress } = opts;
  const baseDelay = opts.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const wantChunk = Math.min(SERVER_MAX_CHUNK, Math.max(SERVER_MIN_CHUNK, Math.floor(opts.chunkBytes ?? DEFAULT_CHUNK_BYTES)));
  if (signal?.aborted) throw abortError();

  const key = resumeKey(file, target);
  // A second concurrent upload of the same file runs as its own session and
  // is not persisted, so the two never write to one server session.
  const persist = !activeKeys.has(key);
  if (persist) activeKeys.add(key);

  /** The server session in use, once known; deleted on cancel or a fatal error. */
  let sessionId: string | null = null;
  /** A completion request was sent; it may have succeeded even if we saw no response. */
  let completeSent = false;
  /** A completion attempt failed without a definite answer (network, 5xx, 423). */
  let completeAmbiguous = false;

  /** The upload finished on the server: forget the session and resolve with its node. */
  const finished = async (): Promise<{ nodeId?: string }> => {
    if (persist) removeStored(key);
    sessionId = null;
    return { nodeId: await findCompletedNode(file, target) };
  };

  try {
    /**
     * Runs `op`; a failure that `canRetry` accepts is retried up to
     * MAX_RETRIES times with exponential backoff, calling `resync` first.
     * A failed resync counts as a failed attempt.
     */
    const withRetry = async <T>(
      op: () => Promise<T>,
      canRetry: (e: unknown) => boolean = transient,
      resync?: (e: unknown) => Promise<void>,
    ): Promise<T> => {
      let last: unknown = null;
      for (let attempt = 0; ; attempt++) {
        try {
          if (last !== null && resync) await resync(last);
          return await op();
        } catch (e) {
          if (signal?.aborted) throw abortError();
          if (!canRetry(e) || attempt >= MAX_RETRIES) throw e;
          // A 409 already says where to continue; nothing to wait for.
          if (!(e instanceof ApiError && e.status === 409)) await sleep(baseDelay * 2 ** attempt, signal);
          last = e;
        }
      }
    };

    let session: Session | null = null;
    if (persist) {
      const stored = readStored(key);
      if (stored) {
        sessionId = stored;
        const found = await withRetry(() => head(stored, signal));
        if (found && found.size === file.size && found.offset <= file.size) {
          session = found;
        } else {
          removeStored(key);
          sessionId = null;
          // A same-id session for different bytes (should not happen): don't leave it reserving quota.
          if (found) void fetch(uploadPath(stored), { method: "DELETE", credentials: "same-origin" }).catch(() => {});
        }
      }
    }
    if (!session) {
      const res = await withRetry(() =>
        send("/api/uploads", {
          method: "POST",
          signal,
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({ space: target.space, parent: target.parent, name: file.name, size: file.size, chunk_size: wantChunk }),
        }),
      );
      const body = (await res.json()) as { id: string; received_bytes: number; chunk_size?: number };
      session = { id: body.id, offset: body.received_bytes ?? 0, chunk: body.chunk_size ?? wantChunk, size: file.size };
      sessionId = session.id;
      if (persist) writeStored(key, session.id);
    }
    const s = session;
    onProgress(s.offset);

    const resync = async (e: unknown) => {
      const hinted = e instanceof UploadHttpError && e.status === 409 ? e.offset : null;
      if (hinted !== null) {
        s.offset = hinted;
        return;
      }
      const now = await head(s.id, signal);
      if (!now) throw new ApiError(404, "not_found");
      s.offset = now.offset;
    };

    for (;;) {
      while (s.offset < file.size) {
        await withRetry(async () => {
          if (s.offset >= file.size) return; // a re-sync showed the server has it all
          const end = Math.min(file.size, s.offset + s.chunk);
          const res = await send(uploadPath(s.id), {
            method: "PATCH",
            signal,
            headers: { "Upload-Offset": String(s.offset), "content-type": "application/offset+octet-stream" },
            body: file.slice(s.offset, end),
          });
          s.offset = offsetHeader(res) ?? end;
        }, chunkRetryable, resync);
        onProgress(s.offset);
      }
      try {
        const res = await withRetry(async () => {
          completeSent = true;
          try {
            return await send(`${uploadPath(s.id)}/complete`, { method: "POST", signal, headers: { accept: "application/json" } });
          } catch (e) {
            if (transient(e)) completeAmbiguous = true;
            throw e;
          }
        });
        const node = (await res.json()) as { id: string };
        if (persist) removeStored(key);
        sessionId = null;
        return { nodeId: node.id };
      } catch (e) {
        // The server is missing bytes after all (e.g. a stale offset): re-sync and send the rest.
        if (e instanceof ApiError && e.status === 409 && e.code === "incomplete") {
          await resync(e);
          if (s.offset < file.size) continue;
        }
        // 404 after an attempt with no definite answer: if the session is gone
        // too, that attempt completed the upload. (A missing destination
        // folder also gives 404, but leaves the session in place.)
        if (e instanceof ApiError && e.status === 404 && completeAmbiguous && (await head(s.id, signal)) === null) {
          return await finished();
        }
        throw e;
      }
    }
  } catch (e) {
    const aborted = signal?.aborted || (e instanceof DOMException && e.name === "AbortError");
    if (aborted && completeSent && sessionId) {
      // Canceled while completing: if the session is gone, the file is done.
      const now = await head(sessionId).catch(() => undefined);
      if (now === null) return await finished();
    }
    const fatal = aborted || !resumable(e);
    if (fatal && persist) removeStored(key);
    if (fatal && sessionId) {
      // Cancel or fatal error: drop the session so its quota reservation is released.
      try {
        await fetch(uploadPath(sessionId), { method: "DELETE", credentials: "same-origin" });
      } catch {
        // Unreachable: the server sweeps abandoned sessions.
      }
    }
    throw aborted ? abortError() : e;
  } finally {
    if (persist) activeKeys.delete(key);
  }
}
