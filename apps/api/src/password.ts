import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

// Format: scrypt$N$r$p$saltB64$hashB64
const N = 16384;
const r = 8;
const p = 1;
const keyLen = 32;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, keyLen, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 6) return false;
  const [algo, nStr, rStr, pStr, saltB64, hashB64] = parts;
  if (algo !== "scrypt") return false;

  const n = Number(nStr);
  const rr = Number(rStr);
  const pp = Number(pStr);
  if (!Number.isFinite(n) || !Number.isFinite(rr) || !Number.isFinite(pp)) return false;

  const salt = Buffer.from(saltB64!, "base64");
  const expected = Buffer.from(hashB64!, "base64");
  const actual = scryptSync(password, salt, expected.length, { N: n, r: rr, p: pp });
  return timingSafeEqual(expected, actual);
}

