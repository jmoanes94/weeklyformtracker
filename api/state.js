import {
  canUseSharedStorage,
  corsHeaders,
  getStorageDiagnostics,
  isDevMemoryFallback,
  isStorageReady,
  parseJsonBody,
  probeBlobStorage,
  readSharedState,
  writeSharedState,
} from "./lib/store.js";

const SETUP_URL = "https://vercel.com/dashboard/stores";

function storageUnavailableResponse() {
  const diagnostics = getStorageDiagnostics();
  return {
    error: "Vercel Blob is not linked to this project.",
    storageReady: false,
    setupUrl: SETUP_URL,
    hint: diagnostics.onVercel
      ? "Dashboard → Storage → Blob → Connect to this project → Redeploy."
      : "Deploy on Vercel and connect Blob storage, or use npm run dev locally.",
    credentials: {
      readWriteToken: diagnostics.readWriteToken,
      storeId: diagnostics.storeId,
      oidcToken: diagnostics.oidcToken,
    },
  };
}

export default async function handler(req, res) {
  Object.entries(corsHeaders()).forEach(([key, value]) => {
    res.setHeader(key, value);
  });

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  const storageReady = canUseSharedStorage();

  if (!storageReady) {
    return res.status(503).json(storageUnavailableResponse());
  }

  if (isStorageReady()) {
    const probe = await probeBlobStorage();
    if (!probe.ok) {
      return res.status(503).json({
        ...storageUnavailableResponse(),
        error: probe.message ?? "Blob store unreachable.",
        probe,
      });
    }
  }

  if (req.method === "GET") {
    const state = await readSharedState();
    return res.status(200).json({
      storageReady: true,
      mode: isStorageReady() ? "blob" : "memory",
      state,
    });
  }

  if (req.method === "POST") {
    let body;
    try {
      body = await parseJsonBody(req);
    } catch {
      return res.status(400).json({ error: "Invalid JSON body" });
    }

    if (body.type !== "state" || !body.data) {
      return res.status(400).json({
        error: "Expected { type: 'state', data, timestamp, clientId }",
      });
    }

    const result = await writeSharedState({
      clientId: body.clientId,
      timestamp: body.timestamp ?? Date.now(),
      data: body.data,
    });

    if (!result.ok) {
      return res.status(503).json({ error: result.error, storageReady: false });
    }

    return res.status(200).json({
      ok: true,
      skipped: result.skipped,
      state: result.state,
      storageReady: true,
    });
  }

  res.setHeader("Allow", "GET, POST, OPTIONS");
  return res.status(405).json({ error: "Method not allowed" });
}
