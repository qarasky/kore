/** Without 0 O 1 l I, which look alike when read aloud or typed from a screen. */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

/** A random password for a new user: 18 characters from a look-alike-free alphabet. */
export function generatePassword(length = 18): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}
