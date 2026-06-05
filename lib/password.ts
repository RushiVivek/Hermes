import { createHash, timingSafeEqual } from "node:crypto";

function sha256(input: string): Buffer {
  return createHash("sha256").update(input, "utf8").digest();
}

export function checkPassword(input: string): boolean {
  const expected = process.env.HERMES_PASSWORD;
  if (!expected) {
    throw new Error("HERMES_PASSWORD env var is required.");
  }
  const a = sha256(input);
  const b = sha256(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
