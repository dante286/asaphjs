import type { NextConfig } from "next";
import { CSV_ACTION_BODY_LIMIT_BYTES } from "./src/lib/csv/limits";

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    serverActions: {
      // Sized for a CSV import at the file cap; see src/lib/csv/limits.ts.
      bodySizeLimit: CSV_ACTION_BODY_LIMIT_BYTES,
    },
  },
};

export default nextConfig;
