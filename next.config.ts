import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Photo imports post several multi-megabyte images in one request.
    serverActions: { bodySizeLimit: "25mb" },
  },
};

export default nextConfig;
