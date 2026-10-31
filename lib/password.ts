// Shared vault password, stored only as an scrypt hash in HERMES_PASSWORD_HASH.
//
// Encoding:  scrypt:<N>:<r>:<p>:<saltB64url>:<hashB64url>
// ":" (not "$") as the separator because Next loads .env files through
// dotenv-expand, which would treat "$…" as a variable reference and mangle it.
// Generate with `npm run hash-password`.

import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";

const DEFAULT_PARAMS = { N: 2 ** 15, r: 8, p: 1 };
const KEY_LEN = 32;
export const MIN_PASSWORD_LENGTH = 12;

interface Parsed {
  N: number;
  r: number;
  p: number;
  salt: Buffer;
  hash: Buffer;
}

function scrypt(password: string, salt: Buffer, len: number, N: number, r: number, p: number) {
  return new Promise<Buffer>((resolve, reject) =>
    // Node's default maxmem (32 MiB) is exactly 128·N·r at N=2^15, which it
    // rejects — give it headroom.
    scryptCb(password, salt, len, { N, r, p, maxmem: 256 * N * r }, (err, key) =>
      err ? reject(err) : resolve(key),
    ),
  );
}

export function parsePasswordHash(encoded: string): Parsed | null {
  const parts = encoded.trim().split(":");
  if (parts.length !== 6 || parts[0] !== "scrypt") return null;
  const [N, r, p] = parts.slice(1, 4).map((s) => (/^\d+$/.test(s) ? Number(s) : NaN));
  // N must be a power of two; bounds keep a typo from pinning the CPU.
  if (!(N >= 2 ** 10 && N <= 2 ** 20 && (N & (N - 1)) === 0)) return null;
  if (!(r >= 1 && r <= 32 && p >= 1 && p <= 16)) return null;
  const salt = Buffer.from(parts[4], "base64url");
  const hash = Buffer.from(parts[5], "base64url");
  if (salt.length < 16 || hash.length < 16) return null;
  return { N, r, p, salt, hash };
}

export async function hashPassword(password: string): Promise<string> {
  const { N, r, p } = DEFAULT_PARAMS;
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, KEY_LEN, N, r, p);
  return `scrypt:${N}:${r}:${p}:${salt.toString("base64url")}:${hash.toString("base64url")}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const parsed = parsePasswordHash(encoded);
  if (!parsed) throw new Error("Password hash is malformed.");
  const { N, r, p, salt, hash } = parsed;
  const candidate = await scrypt(password, salt, hash.length, N, r, p);
  return timingSafeEqual(candidate, hash);
}

/** The configured hash, validated. Throws a config error (→ 500) if unset or
 * malformed so a misconfigured deploy fails loudly instead of locking out. */
export function getPasswordHash(): string {
  const encoded = process.env.HERMES_PASSWORD_HASH?.trim();
  if (!encoded) {
    throw new Error("HERMES_PASSWORD_HASH env var is required (see `npm run hash-password`).");
  }
  if (!parsePasswordHash(encoded)) {
    throw new Error(
      "HERMES_PASSWORD_HASH is malformed. Regenerate it with `npm run hash-password`.",
    );
  }
  return encoded;
}

export async function checkPassword(input: string): Promise<boolean> {
  return verifyPassword(input, getPasswordHash());
}
