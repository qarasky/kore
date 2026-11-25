import type { Database } from "bun:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { Attachment } from "@koremind/shared";
import type { EngineFile } from "./engine/types";

export class UploadError extends Error {
  constructor(public code: "too_large" | "unsupported", message: string) {
    super(message);
  }
}

const allowed = (mime: string) => mime.startsWith("image/") || mime.startsWith("text/") || mime === "application/pdf" || mime === "application/json";
const human = (n: number) => (n >= 1024 * 1024 ? `${Math.round(n / 1024 / 1024)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);

export function createUploads(db: Database, dir: string, maxBytes = 20 * 1024 * 1024) {
  mkdirSync(dir, { recursive: true });
  const find = (id: string, userId: string) =>
    db.query("select * from attachments where id=? and user_id=?").get(id, userId) as { id: string; name: string; mime: string; size: number; path: string } | null;

  return {
    async save(userId: string, file: File): Promise<Attachment> {
      const mime = file.type.split(";")[0].trim().toLowerCase();
      if (file.size > maxBytes) throw new UploadError("too_large", `That file is too large. The limit is ${human(maxBytes)}.`);
      if (!allowed(mime)) throw new UploadError("unsupported", "That file type isn't supported. Use a photo, PDF or text file.");
      const id = crypto.randomUUID();
      const name = basename(file.name.replaceAll("\\", "/")) || "file";
      const userDir = join(dir, userId);
      mkdirSync(userDir, { recursive: true });
      const path = join(userDir, id);
      await Bun.write(path, file);
      db.run("insert into attachments(id,user_id,message_id,name,mime,size,path) values(?,?,null,?,?,?,?)", [id, userId, name, mime, file.size, path]);
      return { id, name, mime, size: file.size };
    },

    read(id: string, userId: string): EngineFile | null {
      const a = find(id, userId);
      if (!a) return null;
      return { name: a.name, mime: a.mime, dataUrl: `data:${a.mime};base64,${readFileSync(a.path).toString("base64")}` };
    },

    stream(id: string, userId: string): Response | null {
      const a = find(id, userId);
      if (!a) return null;
      return new Response(Bun.file(a.path), { headers: { "content-type": a.mime, "content-disposition": `inline; filename="${a.name.replaceAll('"', "")}"` } });
    },
  };
}
export type Uploads = ReturnType<typeof createUploads>;
