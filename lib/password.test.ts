import { describe, expect, it } from "vitest";
import { hashPassword, parsePasswordHash, verifyPassword } from "./password";

describe("hashPassword / verifyPassword", () => {
  it("round-trips the right password and rejects a wrong one", async () => {
    const encoded = await hashPassword("correct horse battery");
    expect(await verifyPassword("correct horse battery", encoded)).toBe(true);
    expect(await verifyPassword("correct horse batterY", encoded)).toBe(false);
  });

  it("salts: the same password hashes differently each time", async () => {
    const a = await hashPassword("same password here");
    const b = await hashPassword("same password here");
    expect(a).not.toBe(b);
  });

  it("uses ':' separators and no '$' (dotenv-expand would mangle '$')", async () => {
    const encoded = await hashPassword("whatever password");
    expect(encoded).toMatch(/^scrypt:\d+:\d+:\d+:[\w-]+:[\w-]+$/);
    expect(encoded).not.toContain("$");
  });
});

describe("parsePasswordHash", () => {
  const salt = Buffer.alloc(16, 1).toString("base64url");
  const hash = Buffer.alloc(32, 2).toString("base64url");

  it("accepts a well-formed value", () => {
    expect(parsePasswordHash(`scrypt:32768:8:1:${salt}:${hash}`)).not.toBeNull();
  });

  it.each([
    ["plain text", "hunter2"],
    ["wrong scheme", `bcrypt:32768:8:1:${salt}:${hash}`],
    ["N not a power of two", `scrypt:30000:8:1:${salt}:${hash}`],
    ["N absurdly large", `scrypt:${2 ** 24}:8:1:${salt}:${hash}`],
    ["short salt", `scrypt:32768:8:1:AAAA:${hash}`],
    ["missing field", `scrypt:32768:8:1:${salt}`],
  ])("rejects %s", (_label, value) => {
    expect(parsePasswordHash(value)).toBeNull();
  });

  it("verifyPassword throws on a malformed hash instead of returning false", async () => {
    await expect(verifyPassword("x", "garbage")).rejects.toThrow(/malformed/);
  });
});
