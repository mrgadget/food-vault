import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// No incremental cache: every page is either user-scoped or fully dynamic,
// so there is nothing worth caching at the edge.
export default defineCloudflareConfig();
