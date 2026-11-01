import { networkInterfaces } from "node:os";
import type { NextConfig } from "next";

/** This machine's private IPv4 addresses, so phones/laptops on the LAN can
 * use the dev server at http://<ip>:28085. Exact addresses rather than a
 * wildcard: Next matches patterns label-by-label, so "192.168.*.*" would
 * also allow a hostname like "192.168.evil.example". Read at startup —
 * restart `npm run dev` if the IP changes. */
function lanAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flat()
    .filter((a) => a && a.family === "IPv4" && !a.internal)
    .map((a) => a!.address);
}

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  ...(process.env.NODE_ENV === "production"
    ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]
    : []),
];

const nextConfig: NextConfig = {
  // Dev only (ignored by `next start`): `next dev` refuses its own scripts
  // and hot-reload socket (403) to any origin but localhost, which breaks
  // the page — login included — when opened via the local Caddy domain or
  // the LAN IP. Allow exactly those.
  allowedDevOrigins: ["hermes.test", ...lanAddresses()],
  experimental: {
    // We use proxy.ts (middleware), so Next buffers each request body through
    // the proxy with a default 10MB cap. A batch of phone photos / scanned
    // PDFs exceeds that, so raise it — to just above the upload route's
    // MAX_UPLOAD_BYTES (100MB, lib/types.ts) plus multipart overhead, so an
    // oversized batch gets the route's clear 413 instead of a truncated body.
    // Kept tight because every byte here sits in RAM (512MB on Render free).
    //
    // NOTE: this only governs a persistent Node server (Render / `npm run
    // dev`). Serverless hosts like Vercel cap request bodies at ~4.5MB
    // regardless, which is why hermes runs on Render.
    proxyClientMaxBodySize: "110mb",
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
