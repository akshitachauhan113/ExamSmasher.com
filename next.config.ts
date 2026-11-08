import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // tesseract.js spawns its own worker + wasm at runtime, so it must not be
  // bundled into the route (bundling breaks its __dirname/worker resolution).
  serverExternalPackages: ["tesseract.js"],
  // …and the worker thread must also find its files at runtime: it does a
  // bare `require('..')` back into src/worker-script and loads tesseract.js-core
  // + helpers, which plain tracing misses on serverless. Without these, prod
  // OCR died with MODULE_NOT_FOUND and the request hung until the 300s
  // function timeout (verified via vercel logs).
  outputFileTracingIncludes: {
    "/api/extract": [
      "./node_modules/tesseract.js/**/*",
      "./node_modules/tesseract.js-core/**/*",
      "./node_modules/wasm-feature-detect/**/*",
      "./node_modules/regenerator-runtime/**/*",
      "./node_modules/is-url/**/*",
      "./node_modules/bmp-js/**/*",
      "./node_modules/node-fetch/**/*",
    ],
  },
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
