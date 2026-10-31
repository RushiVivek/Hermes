import { describe, expect, it } from "vitest";
import { isSameOrigin } from "./origin";

describe("isSameOrigin", () => {
  const host = "hermes.example.com";

  it("always allows safe methods", () => {
    expect(isSameOrigin("GET", "https://evil.example", host)).toBe(true);
    expect(isSameOrigin("HEAD", "https://evil.example", host)).toBe(true);
  });

  it("allows a write from this site", () => {
    expect(isSameOrigin("POST", "https://hermes.example.com", host)).toBe(true);
    expect(isSameOrigin("DELETE", "http://localhost:28085", "localhost:28085")).toBe(true);
  });

  it("blocks a cross-site write", () => {
    expect(isSameOrigin("POST", "https://evil.example", host)).toBe(false);
    expect(isSameOrigin("DELETE", "https://hermes.example.com.evil.example", host)).toBe(false);
  });

  it("blocks a port mismatch", () => {
    expect(isSameOrigin("POST", "http://localhost:9999", "localhost:28085")).toBe(false);
  });

  it('blocks the opaque "null" origin', () => {
    expect(isSameOrigin("POST", "null", host)).toBe(false);
  });

  it("allows a write with no Origin (non-browser client)", () => {
    expect(isSameOrigin("POST", null, host)).toBe(true);
  });
});
