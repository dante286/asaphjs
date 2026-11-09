import type { NextConfig } from "next";
import { CSV_ACTION_BODY_LIMIT_BYTES } from "./src/lib/csv/limits";
import { STATIC_SECURITY_HEADERS, TOKEN_PAGE_HEADERS, TOKEN_PAGE_SOURCES } from "./src/lib/security-headers";

const nextConfig: NextConfig = {
  output: "standalone",
  // The headers that don't depend on the deployment. The CSP and HSTS do, and
  // are set per request in proxy.ts. Later entries override earlier ones for
  // the same key, so the token pages' stricter Referrer-Policy comes last.
  async headers() {
    return [
      { source: "/:path*", headers: STATIC_SECURITY_HEADERS },
      ...TOKEN_PAGE_SOURCES.map((source) => ({ source, headers: TOKEN_PAGE_HEADERS })),
    ];
  },
  experimental: {
    serverActions: {
      // Sized for a CSV import at the file cap; see src/lib/csv/limits.ts.
      bodySizeLimit: CSV_ACTION_BODY_LIMIT_BYTES,
    },
  },
};

export default nextConfig;
