import { randomBytes } from "node:crypto";

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

function base62(bytes: Uint8Array): string {
  // Simple base62-ish encoding: map each byte to a char; not cryptographic encoding,
  // but IDs also include randomness from randomBytes.
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += ALPHABET[bytes[i]! % ALPHABET.length];
  return out;
}

export function makeId(prefix: "u" | "uh" | "t" | "b" | "req"): string {
  const rnd = base62(randomBytes(16));
  return `${prefix}_${rnd}`;
}

