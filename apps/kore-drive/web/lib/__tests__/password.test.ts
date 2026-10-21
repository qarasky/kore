import { describe, expect, it } from "vitest";
import {
  generatePassword,
  PASSWORD_ALPHABET,
  passwordBytes,
  passwordHints,
  passwordProblem,
} from "../password";

describe("passwordProblem", () => {
  it("mirrors the server's byte limits", () => {
    expect(passwordProblem("")).toBe("too_short");
    expect(passwordProblem("1234567")).toBe("too_short");
    expect(passwordProblem("12345678")).toBeNull();
    // Go counts bytes: four Cyrillic letters are eight bytes.
    expect(passwordBytes("пароль")).toBe(12);
    expect(passwordProblem("абвг")).toBeNull();
    expect(passwordProblem("a".repeat(1024))).toBeNull();
    expect(passwordProblem("a".repeat(1025))).toBe("too_long");
  });
});

describe("passwordHints", () => {
  it("reports each hint", () => {
    expect(passwordHints("")).toEqual({ minLength: false, long: false, mixed: false });
    expect(passwordHints("abcdefgh")).toEqual({ minLength: true, long: false, mixed: false });
    expect(passwordHints("abcdefgh1")).toEqual({ minLength: true, long: false, mixed: true });
    expect(passwordHints("correct horse battery")).toEqual({ minLength: true, long: true, mixed: true });
    expect(passwordHints("ABCDEFGHIJKL")).toEqual({ minLength: true, long: true, mixed: false });
  });
});

describe("generatePassword", () => {
  it("makes dash-separated groups from the unambiguous alphabet", () => {
    const pw = generatePassword();
    expect(pw).toMatch(/^[^-]{5}-[^-]{5}-[^-]{5}-[^-]{5}$/);
    for (const ch of pw.replaceAll("-", "")) expect(PASSWORD_ALPHABET).toContain(ch);
    expect(passwordProblem(pw)).toBeNull();
    expect(passwordHints(pw).long).toBe(true);
  });

  it("differs between calls", () => {
    expect(new Set(Array.from({ length: 20 }, () => generatePassword())).size).toBe(20);
  });

  it("rejects biased bytes (rejection sampling)", () => {
    // 256 % 56 = 32: bytes >= 224 must be skipped, never mapped.
    let call = 0;
    const random = (buf: Uint8Array) => {
      buf.fill(call++ === 0 ? 255 : 0);
      return buf;
    };
    expect(generatePassword(1, 4, random)).toBe(PASSWORD_ALPHABET[0].repeat(4));
  });

  it("has no look-alike characters", () => {
    for (const ch of "0O1lI") expect(PASSWORD_ALPHABET).not.toContain(ch);
  });
});
