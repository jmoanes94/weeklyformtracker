import { isStorageReady, readSharedState } from "./lib/store.js";

/**
 * Server-Sent Events stream for Vercel (WebSockets are not supported on Vercel Functions).
 * Clients reconnect automatically when the function times out.
 */
export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!isStorageReady()) {
    return res.status(503).json({
      error:
        "Shared storage not configured. Add Vercel KV or Upstash Redis env vars.",
    });
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  let lastTimestamp = 0;
  let closed = false;

  req.on("close", () => {
    closed = true;
  });

  const send = (payload) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  const pushIfNew = async () => {
    if (closed) return;
    try {
      const state = await readSharedState();
      if (!state || typeof state.timestamp !== "number") return;
      if (state.timestamp <= lastTimestamp) return;
      lastTimestamp = state.timestamp;
      send({ type: "snapshot", ...state });
    } catch {
      send({ type: "error", message: "Failed to read shared state" });
    }
  };

  await pushIfNew();
  send({ type: "presence", peerCount: 1 });

  const interval = setInterval(() => {
    pushIfNew().catch(() => {});
  }, 800);

  req.on("close", () => {
    clearInterval(interval);
  });
}

export const config = {
  maxDuration: 60,
};
