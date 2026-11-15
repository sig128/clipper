/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@clipforge/contracts"],
  // bullmq is server-only; keep it out of the client bundle.
  serverExternalPackages: ["bullmq"],
};
export default nextConfig;
