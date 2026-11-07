import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Load the libheif WASM build (HEIC decoding) from node_modules at runtime instead of bundling it.
  // sharp is already on Next's built-in external list.
  serverExternalPackages: ["heic-decode", "libheif-js"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
