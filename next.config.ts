import type { NextConfig } from "next";

const production = process.env.NODE_ENV === "production";
/** Photos are uploaded to and shown from Supabase Storage in production. */
const storage = process.env.SUPABASE_URL?.trim().replace(/\/+$/, "") ?? "";

/**
 * What a page may load. Scripts and styles are the app's own; Next.js's inline
 * page data needs 'unsafe-inline'. Images and uploads may also use the photo
 * storage. No other site can put the app in a frame.
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${storage}`.trim(),
  `connect-src 'self' ${storage}`.trim(),
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=()" },
  // Development runs over plain http and hot-reloads code, so these two are for real deployments only.
  ...(production
    ? [
        { key: "Content-Security-Policy", value: contentSecurityPolicy },
        { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
      ]
    : []),
];

const nextConfig: NextConfig = {
  // The end-to-end tests run their own server alongside `npm run dev`, so they build into a separate folder.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  // The embedded dev database ships WebAssembly files; load it with Node's own require.
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // The TV board's link is its key: keep it out of caches, search engines and referrer headers.
      {
        source: "/tv/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store" },
          { key: "X-Robots-Tag", value: "noindex" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        // Plain CSS modules (the TV board's) skip Tailwind, which would turn them into global CSS.
        condition: { not: { path: "*.module.css" } },
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
