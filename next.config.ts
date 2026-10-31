import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  ...(process.env.NODE_ENV === "production"
    ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]
    : []),
];

const nextConfig: NextConfig = {
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
