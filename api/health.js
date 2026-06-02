import { canUseSharedStorage, isDevMemoryFallback, isStorageReady } from "./lib/store.js";

/** Quick check after deploy — open /api/health in the browser. */
export default async function handler(_req, res) {
  const blobReady = isStorageReady();
  const memoryFallback = isDevMemoryFallback();
  const ready = canUseSharedStorage();

  return res.status(200).json({
    storageReady: ready,
    mode: blobReady ? "blob" : memoryFallback ? "memory" : "none",
    realtime: blobReady ? "sse" : memoryFallback ? "memory-dev" : "unavailable",
    hint: blobReady
      ? "Vercel Blob is configured. Live SSE sync should work."
      : memoryFallback
        ? "Using in-memory dev fallback (local only). Link Vercel Blob for production."
        : "Link Vercel Blob (Dashboard → Storage → Blob → Connect), then redeploy.",
  });
}
