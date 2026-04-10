import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@launchpad/shared", "@launchpad/guards"],
};

export default nextConfig;
