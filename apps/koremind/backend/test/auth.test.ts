import { expect, test } from "bun:test";
import { openDb } from "../src/db";
import { AuthError, createAuth } from "../src/auth";

const creds = { email: "me@home.lan", password: "correct horse" };
const setup = (now = () => 1_000_000) => {
  const db = openDb(":memory:");
  return { db, auth: createAuth(db, now) };
};
const code = async (p: Promise<unknown>) => {
  try { await p; return "ok"; } catch (e) { return e instanceof AuthError ? e.code : "other"; }
};

test("first registered user is owner", async () => {
  const { auth } = setup();
  expect(auth.setupRequired()).toBe(true);
  const r = await auth.register(creds);
  expect(r.user.isOwner).toBe(true);
  expect(auth.setupRequired()).toBe(false);
});

test("register closed after first user unless caller is owner", async () => {
  const { auth } = setup();
  const first = await auth.register(creds);
  expect(await code(auth.register({ email: "b@home.lan", password: "another pass" }))).toBe("setup_closed");
  const second = await auth.register({ email: "b@home.lan", password: "another pass" }, first.user);
  expect(second.user.isOwner).toBe(false);
});

test("login with wrong password fails", async () => {
  const { auth } = setup();
  await auth.register(creds);
  expect(await code(auth.login({ ...creds, password: "wrong password" }, "1.1.1.1"))).toBe("bad_credentials");
  expect((await auth.login(creds, "1.1.1.1")).user.email).toBe("me@home.lan");
});

test("5 wrong passwords from one ip returns rate_limited with retryAfterSec", async () => {
  const { auth } = setup();
  await auth.register(creds);
  for (let i = 0; i < 5; i++) await code(auth.login({ ...creds, password: "wrong password" }, "9.9.9.9"));
  try { await auth.login(creds, "9.9.9.9"); throw new Error("should have thrown"); }
  catch (e) { expect((e as AuthError).code).toBe("rate_limited"); expect((e as AuthError).retryAfterSec).toBeGreaterThan(0); }
});

test("correct password from a different ip still works while the first ip is limited", async () => {
  const { auth } = setup();
  await auth.register(creds);
  for (let i = 0; i < 5; i++) await code(auth.login({ ...creds, password: "wrong password" }, "9.9.9.9"));
  expect((await auth.login(creds, "2.2.2.2")).token.length).toBeGreaterThan(20);
});

test("tokens are stored hashed", async () => {
  const { db, auth } = setup();
  const r = await auth.register(creds);
  const rows = db.query("select token_hash from tokens").all() as { token_hash: string }[];
  expect(rows.length).toBe(1);
  expect(rows[0].token_hash).not.toBe(r.token);
  expect(auth.verify(r.token)?.email).toBe("me@home.lan");
});

test("expired token does not verify", async () => {
  let t = 1_000_000;
  const { auth } = setup(() => t);
  const r = await auth.register(creds);
  t += 31 * 24 * 3600 * 1000;
  expect(auth.verify(r.token)).toBeNull();
});

test("logout invalidates the token", async () => {
  const { auth } = setup();
  const r = await auth.register(creds);
  auth.logout(r.token);
  expect(auth.verify(r.token)).toBeNull();
});

test("stale login attempt rows are pruned", async () => {
  let t = 1_000_000;
  const { db, auth } = setup(() => t);
  await auth.register(creds);
  await code(auth.login({ ...creds, password: "wrong password" }, "5.5.5.5"));
  t += 16 * 60 * 1000;
  await auth.login(creds, "6.6.6.6");
  expect((db.query("select count(*) c from login_attempts").get() as { c: number }).c).toBe(0);
});

test("a pairing code signs a new device in as the same user, once", async () => {
  let t = 1_000_000;
  const { auth } = setup(() => t);
  const owner = await auth.register(creds);
  const pair = auth.startPair(owner.user.id);
  expect(pair.code.length).toBeGreaterThanOrEqual(20);
  expect(pair.expiresAt).toBe(t + 120_000);
  const device = await auth.redeemPair(pair.code, "1.1.1.1");
  expect(device.user.id).toBe(owner.user.id);
  expect(device.token).not.toBe(owner.token);
  expect(auth.verify(device.token)?.id).toBe(owner.user.id);
  expect(await code(auth.redeemPair(pair.code, "1.1.1.1"))).toBe("bad_code"); // single use
});

test("pairing codes expire after two minutes and unknown codes fail the same way", async () => {
  let t = 1_000_000;
  const { auth } = setup(() => t);
  const owner = await auth.register(creds);
  const pair = auth.startPair(owner.user.id);
  t += 120_001;
  expect(await code(auth.redeemPair(pair.code, "1.1.1.1"))).toBe("bad_code");
  expect(await code(auth.redeemPair("nope", "1.1.1.1"))).toBe("bad_code");
});

test("guessing pairing codes is rate limited per address, and a new code replaces the old one", async () => {
  const { auth } = setup();
  const owner = await auth.register(creds);
  for (let i = 0; i < 10; i++) await code(auth.redeemPair(`guess${i}`, "9.9.9.9"));
  expect(await code(auth.redeemPair("guess-final", "9.9.9.9"))).toBe("rate_limited");
  expect(await code(auth.redeemPair("x", "8.8.8.8"))).toBe("bad_code"); // another address is unaffected
  const first = auth.startPair(owner.user.id);
  const second = auth.startPair(owner.user.id);
  expect(await code(auth.redeemPair(first.code, "7.7.7.7"))).toBe("bad_code");
  expect(await code(auth.redeemPair(second.code, "7.7.7.7"))).toBe("ok");
});
