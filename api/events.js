import { canUseSharedStorage, readSharedState } from "./lib/store.js";

const POLL_MS = 600;
const HEARTBEAT_MS = 15000;

/**
 * Server-Sent Events stream for Vercel (WebSockets are not supported on Vercel Functions).
 * Polls shared Blob storage and pushes snapshots; clients reconnect when the function times out.
 */
export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!canUseSharedStorage()) {
    return res.status(503).json({
      error:
        "Shared storage not configured. Add Vercel Blob to this project (see DEPLOYMENT.md).",
      storageReady: false,
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

  const send = (payload) => {
    if (closed) return;
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  const pushIfNew = async () => {
    if (closed) return;
    try {
      const state = await readSharedState();
      if (!state || typeof state.timestamp !== "number") return;
      if (state.timestamp <= lastTimestamp) return;
      lastTimestamp = state.timestamp;
      send({
        type: "snapshot",
        clientId: state.clientId,
        timestamp: state.timestamp,
        data: state.data,
      });
    } catch {
      send({ type: "error", message: "Failed to read shared state" });
    }
  };

  req.on("close", () => {
    closed = true;
  });

  send({ type: "connected", transport: "sse" });
  await pushIfNew();

  const pollTimer = setInterval(() => {
    pushIfNew().catch(() => {});
  }, POLL_MS);

  const heartbeatTimer = setInterval(() => {
    if (closed) return;
    res.write(": heartbeat\n\n");
  }, HEARTBEAT_MS);

  req.on("close", () => {
    clearInterval(pollTimer);
    clearInterval(heartbeatTimer);
  });
}

export const config = {
  maxDuration: 60,
};
