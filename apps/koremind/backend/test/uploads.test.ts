import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db";
import { createUploads, UploadError } from "../src/uploads";

const setup = (max = 1024) => {
  const db = openDb(":memory:");
  for (const u of ["u1", "u2"]) db.run("insert into users(id,email,password_hash,is_owner,created_at) values(?,?,?,0,1)", [u, `${u}@x.co`, "h"]);
  return createUploads(db, mkdtempSync(join(tmpdir(), "zero-up-")), max);
};
const err = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e as UploadError; } };

test("rejects a file over the limit with a readable message", async () => {
  const up = setup(10);
  const e = await err(up.save("u1", new File([new Uint8Array(11)], "big.png", { type: "image/png" })));
  expect(e?.code).toBe("too_large");
  expect(e?.message).toContain("10 B");
});

test("rejects an unsupported mime", async () => {
  const up = setup();
  expect((await err(up.save("u1", new File(["x"], "a.exe", { type: "application/x-msdownload" }))))?.code).toBe("unsupported");
});

test("another user cannot read my upload", async () => {
  const up = setup();
  const a = await up.save("u1", new File(["hello"], "n.txt", { type: "text/plain" }));
  expect(up.read(a.id, "u2")).toBeNull();
  expect(up.stream(a.id, "u2")).toBeNull();
});

test("read returns a data url and save returns attachment info", async () => {
  const up = setup();
  const a = await up.save("u1", new File(["hello"], "n.txt", { type: "text/plain" }));
  expect(a).toMatchObject({ name: "n.txt", mime: "text/plain", size: 5 });
  expect(up.read(a.id, "u1")).toEqual({ name: "n.txt", mime: "text/plain", dataUrl: "data:text/plain;base64,aGVsbG8=" });
});

test("file names cannot escape the upload directory", async () => {
  const up = setup();
  const a = await up.save("u1", new File(["x"], "../../etc/passwd", { type: "text/plain" }));
  expect(a.name).toBe("passwd");
  expect(up.read(a.id, "u1")).not.toBeNull();
});
