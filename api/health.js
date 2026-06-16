import {
  canUseSharedStorage,
  getStorageDiagnostics,
  hasBlobCredentials,
  isDevMemoryFallback,
  isStorageReady,
  probeBlobStorage,
} from "./lib/store.js";

function buildSetupHint(diagnostics, probe) {
  if (diagnostics.devMemory) {
    return "Using in-memory dev fallback (local only). Link Vercel Blob for production.";
  }

  if (!diagnostics.onVercel) {
    return "Run on Vercel with Blob linked, or use npm run dev for local WebSocket sync.";
  }

  if (!diagnostics.credentialsFound) {
    return [
      "Vercel Blob is not linked to this project.",
      "1. Vercel Dashboard → this project → Storage → Blob → Create (or Connect).",
      "2. Select Production + Preview environments.",
      "3. Deployments → Redeploy the latest deployment.",
    ].join(" ");
  }

  if (probe?.reason === "access_failed") {
    return `Blob credentials found but storage is unreachable: ${probe.message ?? "check store connection and redeploy."}`;
  }

  return "Link Vercel Blob (Dashboard → Storage → Blob → Connect), then redeploy.";
}

/** Quick check after deploy — open /api/health in the browser. */
export default async function handler(_req, res) {
  const diagnostics = getStorageDiagnostics();
  const blobReady = isStorageReady();
  const memoryFallback = isDevMemoryFallback();
  const ready = canUseSharedStorage();

  let probe = null;
  if (blobReady) {
    probe = await probeBlobStorage();
  }

  const storageWorking = memoryFallback || (blobReady && probe?.ok);
  const setupUrl = diagnostics.onVercel
    ? "https://vercel.com/dashboard/stores"
    : null;

  return res.status(200).json({
    storageReady: storageWorking,
    mode: blobReady && probe?.ok ? "blob" : memoryFallback ? "memory" : "none",
    realtime: storageWorking ? (memoryFallback ? "memory-dev" : "sse") : "unavailable",
    credentials: {
      readWriteToken: diagnostics.readWriteToken,
      storeId: diagnostics.storeId,
      oidcToken: diagnostics.oidcToken,
    },
    probe: probe ?? { ok: false, reason: "not_checked" },
    setupUrl,
    hint: storageWorking
      ? blobReady
        ? "Vercel Blob is configured. Live SSE sync should work."
        : "Using in-memory dev fallback (local only)."
      : buildSetupHint(diagnostics, probe),
  });
}
