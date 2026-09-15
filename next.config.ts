import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `pg` and `mysql2` are native/dynamic-require heavy; keep them external so
  // the Next bundler does not try to trace them into the server bundle.
  serverExternalPackages: ["pg", "mysql2"],
  experimental: {
    // Server Actions receive dashboard layouts, which can be a few hundred KB.
    serverActions: { bodySizeLimit: "2mb" },
  },
};

export default nextConfig;
