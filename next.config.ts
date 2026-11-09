import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The end-to-end tests run their own server alongside `npm run dev`, so they build into a separate folder.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  cacheComponents: true,
  partialPrefetching: true,
  // The embedded dev database ships WebAssembly files; load it with Node's own require.
  serverExternalPackages: ["@electric-sql/pglite"],
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
