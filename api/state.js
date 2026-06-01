import {
  corsHeaders,
  getRedis,
  readSharedState,
  writeSharedState,
} from "./lib/store.js";

export default async function handler(req, res) {
  Object.entries(corsHeaders()).forEach(([key, value]) => {
    res.setHeader(key, value);
  });

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (!getRedis()) {
    return res.status(503).json({
      error:
        "Shared storage not configured. Add Vercel KV or Upstash Redis env vars.",
    });
  }

  if (req.method === "GET") {
    const state = await readSharedState();
    return res.status(200).json({ state });
  }

  if (req.method === "POST") {
    const body = req.body ?? {};
    if (body.type !== "state" || !body.data) {
      return res.status(400).json({ error: "Expected { type: 'state', data, timestamp, clientId }" });
    }

    const result = await writeSharedState({
      clientId: body.clientId,
      timestamp: body.timestamp ?? Date.now(),
      data: body.data,
    });

    if (!result.ok) {
      return res.status(503).json({ error: result.error });
    }

    return res.status(200).json({
      ok: true,
      skipped: result.skipped,
      state: result.state,
    });
  }

  res.setHeader("Allow", "GET, POST, OPTIONS");
  return res.status(405).json({ error: "Method not allowed" });
}
