import { expect, test } from "bun:test";
import { challengeOf, makeVerifier, parseSsoHash, sha256 } from "../lib/sso";

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");

test("sha256 matches the standard vectors, including multi-block input", () => {
  const enc = (s: string) => new TextEncoder().encode(s);
  expect(hex(sha256(enc("")))).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  expect(hex(sha256(enc("abc")))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  expect(hex(sha256(enc("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")))).toBe("248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
  const long = new Uint8Array(1000).fill(97);
  expect(hex(sha256(long))).toBe(new Bun.CryptoHasher("sha256").update(long).digest("hex"));
});

test("PKCE challenge is base64url(sha256(verifier)), 43 chars, and the RFC 7636 example holds", () => {
  expect(challengeOf("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  const v = makeVerifier();
  expect(v).toMatch(/^[A-Za-z0-9_-]{64}$/);
  expect(challengeOf(v)).toMatch(/^[A-Za-z0-9_-]{43}$/);
});

test("parseSsoHash reads ticket, error and linked, and ignores anything else", () => {
  expect(parseSsoHash("#sso_ticket=abc")).toEqual({ ticket: "abc" });
  expect(parseSsoHash("#sso_error=denied")).toEqual({ error: "denied" });
  expect(parseSsoHash("#sso_linked=1")).toEqual({ linked: true });
  expect(parseSsoHash("#other=1")).toBeNull();
  expect(parseSsoHash("")).toBeNull();
});
