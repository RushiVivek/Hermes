import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // We use proxy.ts (middleware), so Next buffers each request body through
    // the proxy with a default 10MB cap. Family docs (phone photos, scanned
    // PDFs) routinely exceed that, so raise it. The route itself enforces a
    // 250MB-per-request ceiling.
    //
    // NOTE: this only governs the proxy buffer for `npm run dev` / a
    // self-hosted Node server. On Vercel, serverless functions have their own
    // hard request-body limit (~4.5MB) that this setting CANNOT raise — a file
    // larger than that will fail once deployed because the upload streams
    // through our function. The real fix for Vercel is a direct
    // client→Buzzheavier upload path (deferred; needs the account token off
    // the client).
    proxyClientMaxBodySize: "300mb",
  },
};

export default nextConfig;
