import { isStorageReady } from "./lib/store.js";

/** Quick check for Vercel KV — open /api/health in the browser after deploy. */
export default async function handler(_req, res) {
  return res.status(200).json({
    storageReady: isStorageReady(),
    hint: isStorageReady()
      ? "Redis is configured. Live sync should work."
      : "Link Redis (Upstash) to this project (Vercel → Storage), then redeploy.",
  });
}
