/** @type {import('next').NextConfig} */
const nextConfig = {
  // @clipforge/contracts ships TypeScript source; Next compiles it with the app.
  transpilePackages: ["@clipforge/contracts"],
  experimental: {
    // bullmq (with ioredis) runs on the server only; load it from node_modules
    // instead of bundling it. (Next 14 name; Next 15 renamed it serverExternalPackages.)
    serverComponentsExternalPackages: ["bullmq"],
  },
  webpack(config) {
    // contracts imports its own files ESM-style ("./edl.js" -> edl.ts).
    // Next 14's webpack doesn't map .js to .ts on its own.
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
    };
    return config;
  },
  async rewrites() {
    // The studio is one static page (copied into public/ at build time); serve it at the root.
    return { beforeFiles: [{ source: "/", destination: "/studio.html" }] };
  },
};

export default nextConfig;
