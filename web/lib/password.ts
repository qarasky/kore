/**
 * Password rules mirrored from the API (lengths are UTF-8 bytes, like Go's
 * len()), strength hints, and a generator for initial / reset passwords.
 * Nothing here logs or stores a password.
 */

export const MIN_PASSWORD_BYTES = 8;
export const MAX_PASSWORD_BYTES = 1024;
/** Length from which the "longer" hint counts as met. */
export const STRONG_PASSWORD_LENGTH = 12;

export function passwordBytes(pw: string): number {
  return new TextEncoder().encode(pw).length;
}

/** The server's verdict on a new password, or null if it would be accepted. */
export function passwordProblem(pw: string): "too_short" | "too_long" | null {
  const n = passwordBytes(pw);
  if (n < MIN_PASSWORD_BYTES) return "too_short";
  if (n > MAX_PASSWORD_BYTES) return "too_long";
  return null;
}

export type PasswordHints = {
  /** Required: at least 8 characters. */
  minLength: boolean;
  /** Recommended: 12 or more characters. */
  long: boolean;
  /** Recommended: at least two of lower case, upper case, digits, symbols. */
  mixed: boolean;
};

export function passwordHints(pw: string): PasswordHints {
  const classes = [/\p{Ll}/u, /\p{Lu}/u, /\p{N}/u, /[^\p{L}\p{N}]/u].filter((re) => re.test(pw)).length;
  return {
    minLength: passwordBytes(pw) >= MIN_PASSWORD_BYTES,
    long: [...pw].length >= STRONG_PASSWORD_LENGTH,
    mixed: classes >= 2,
  };
}

/** No look-alikes (0/O, 1/l/I), so a password read aloud or copied by hand works. */
export const PASSWORD_ALPHABET = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/**
 * A random password of `groups` groups of `groupLength` characters joined by
 * "-" (default 4×5, about 116 bits). Uses rejection sampling, so every
 * character is equally likely.
 */
export function generatePassword(
  groups = 4,
  groupLength = 5,
  random: (buf: Uint8Array) => Uint8Array = (buf) => crypto.getRandomValues(buf),
): string {
  const n = PASSWORD_ALPHABET.length;
  const limit = 256 - (256 % n);
  const out: string[] = [];
  while (out.length < groups * groupLength) {
    for (const b of random(new Uint8Array(32))) {
      if (b < limit && out.length < groups * groupLength) out.push(PASSWORD_ALPHABET[b % n]);
    }
  }
  const parts: string[] = [];
  for (let i = 0; i < groups; i++) parts.push(out.slice(i * groupLength, (i + 1) * groupLength).join(""));
  return parts.join("-");
}
