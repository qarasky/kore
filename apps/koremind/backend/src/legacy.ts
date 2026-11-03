import { existsSync, renameSync } from "node:fs";
import { join } from "node:path";

/** KoreMind was called Zero at first: carry over a database named zero.sqlite (and its WAL files) once. */
export function migrateLegacyDb(dataDir: string): boolean {
  const old = join(dataDir, "zero.sqlite");
  const next = join(dataDir, "koremind.sqlite");
  if (!existsSync(old) || existsSync(next)) return false;
  for (const suffix of ["", "-wal", "-shm"]) if (existsSync(old + suffix)) renameSync(old + suffix, next + suffix);
  return true;
}
