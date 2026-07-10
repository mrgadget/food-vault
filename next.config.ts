import type { NextConfig } from "next";

const nextConfig: NextConfig = {};

export default nextConfig;

// Makes Cloudflare bindings and secrets available to `next dev`. No-op in
// production, where the Worker supplies them directly.
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
initOpenNextCloudflareForDev();
