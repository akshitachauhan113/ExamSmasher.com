import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // tesseract.js spawns its own worker + wasm at runtime, so it must not be
  // bundled into the route (bundling breaks its __dirname/worker resolution).
  serverExternalPackages: ["tesseract.js"],
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
