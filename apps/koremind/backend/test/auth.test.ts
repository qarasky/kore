import { expect, test } from "bun:test";
import { openDb } from "../src/db";
import { AuthError, createAuth } from "../src/auth";
import { addUser } from "./helpers";

const setup = (now = () => 1_000_000) => {
  const db = openDb(":memory:");
  return { db, auth: createAuth(db, now) };
};
const code = async (p: Promise<unknown>) => {
  try { await p; return "ok"; } catch (e) { return e instanceof AuthError ? e.code : "other"; }
};

test("setup is required until the first account exists", () => {
  const { db, auth } = setup();
  expect(auth.setupRequired()).toBe(true);
  addUser(db, "me@home.lan", { owner: true });
  expect(auth.setupRequired()).toBe(false);
});

test("a Kore ID-created account can start a session", () => {
  const { db, auth } = setup();
  const user = addUser(db, "me@home.lan", { owner: true, sub: "sub-1" });
  const r = auth.issueFor(user.id);
  expect(r.user).toMatchObject({ id: user.id, email: "me@home.lan", isOwner: true, ssoLinked: true });
  expect(auth.verify(r.token)?.id).toBe(user.id);
  expect(auth.userBySub("sub-1")?.id).toBe(user.id);
});

test("tokens are stored hashed", () => {
  const { db, auth } = setup();
  const user = addUser(db, "me@home.lan", { owner: true });
  const r = auth.issueFor(user.id);
  const rows = db.query("select token_hash from tokens").all() as { token_hash: string }[];
  expect(rows.length).toBe(1);
  expect(rows[0].token_hash).not.toBe(r.token);
  expect(auth.verify(r.token)?.email).toBe("me@home.lan");
});

test("expired token does not verify", () => {
  let t = 1_000_000;
  const { db, auth } = setup(() => t);
  const user = addUser(db, "me@home.lan", { owner: true });
  const r = auth.issueFor(user.id);
  t += 31 * 24 * 3600 * 1000;
  expect(auth.verify(r.token)).toBeNull();
});

test("logout invalidates the token", () => {
  const { db, auth } = setup();
  const user = addUser(db, "me@home.lan", { owner: true });
  const r = auth.issueFor(user.id);
  auth.logout(r.token);
  expect(auth.verify(r.token)).toBeNull();
});

test("a pairing code signs a new device in as the same user, once", async () => {
  let t = 1_000_000;
  const { db, auth } = setup(() => t);
  const owner = addUser(db, "me@home.lan", { owner: true, sub: "sub-1" });
  const session = auth.issueFor(owner.id, { sid: "kore-sid-1" });
  const pair = auth.startPair(owner.id, session.token);
  expect(pair.code.length).toBeGreaterThanOrEqual(20);
  expect(pair.expiresAt).toBe(t + 120_000);
  const device = await auth.redeemPair(pair.code, "1.1.1.1");
  expect(device.user.id).toBe(owner.id);
  expect(device.token).not.toBe(session.token);
  expect(auth.verify(device.token)?.id).toBe(owner.id);
  expect(await code(auth.redeemPair(pair.code, "1.1.1.1"))).toBe("bad_code"); // single use
  // The paired device inherits the Kore ID session, so back-channel logout ends it too.
  const sid = db.query("select sid from tokens where token_hash=? ").get(new Bun.CryptoHasher("sha256").update(device.token).digest("hex")) as { sid: string | null };
  expect(sid.sid).toBe("kore-sid-1");
});

test("pairing codes expire after two minutes and unknown codes fail the same way", async () => {
  let t = 1_000_000;
  const { db, auth } = setup(() => t);
  const owner = addUser(db, "me@home.lan", { owner: true });
  const pair = auth.startPair(owner.id);
  t += 120_001;
  expect(await code(auth.redeemPair(pair.code, "1.1.1.1"))).toBe("bad_code");
  expect(await code(auth.redeemPair("nope", "1.1.1.1"))).toBe("bad_code");
});

test("guessing pairing codes is rate limited per address, and a new code replaces the old one", async () => {
  const { db, auth } = setup();
  const owner = addUser(db, "me@home.lan", { owner: true });
  for (let i = 0; i < 10; i++) await code(auth.redeemPair(`guess${i}`, "9.9.9.9"));
  expect(await code(auth.redeemPair("guess-final", "9.9.9.9"))).toBe("rate_limited");
  expect(await code(auth.redeemPair("x", "8.8.8.8"))).toBe("bad_code"); // another address is unaffected
  const first = auth.startPair(owner.id);
  const second = auth.startPair(owner.id);
  expect(await code(auth.redeemPair(first.code, "7.7.7.7"))).toBe("bad_code");
  expect(await code(auth.redeemPair(second.code, "7.7.7.7"))).toBe("ok");
});
