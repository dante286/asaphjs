import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",

  // The photo route re-encodes uploads with sharp. Standalone tracing follows JS
  // and `.node` binaries, but not the shared library that binary dlopens — the
  // trace picks up `@img/sharp-<platform>/lib/*.node` and leaves
  // `@img/sharp-libvips-<platform>/lib/libvips-cpp.so.*` behind, so the route
  // throws ERR_DLOPEN_FAILED at runtime while building and typechecking cleanly.
  // Pulling in the whole `@img` tree is the documented escape hatch.
  outputFileTracingIncludes: {
    "/api/collections/*/items/*/photo": ["./node_modules/@img/**/*"],
  },
};

export default nextConfig;
