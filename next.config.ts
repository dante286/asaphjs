import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",

  // Two routes re-encode images with sharp: the photo upload route, and the item
  // detail page, whose metadata actions mirror provider cover art through the
  // same pipeline. Standalone tracing follows JS and `.node` binaries, but not
  // the shared library that binary dlopens — the trace picks up
  // `@img/sharp-<platform>/lib/*.node` and leaves
  // `@img/sharp-libvips-<platform>/lib/libvips-cpp.so.*` behind, so the route
  // throws ERR_DLOPEN_FAILED at runtime while building and typechecking cleanly.
  // Pulling in the whole `@img` tree is the documented escape hatch.
  outputFileTracingIncludes: {
    "/api/collections/*/items/*/photo": ["./node_modules/@img/**/*"],
    "/collections/*/items/*": ["./node_modules/@img/**/*"],
  },
};

export default nextConfig;
