import { Redis } from "@upstash/redis";

const STATE_KEY = "wp-form:shared-state";

function stateWeight(data) {
  if (!data) return 0;
  return (data.websites?.length ?? 0) + (data.entries?.length ?? 0);
}

export function isStorageReady() {
  return Boolean(
    process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN
  );
}

function getRedis() {
  if (!isStorageReady()) return null;
  return Redis.fromEnv();
}

export function shouldReplaceSnapshot(current, incoming) {
  if (!incoming?.data) return false;
  const nextWeight = stateWeight(incoming.data);
  if (!current) return true;
  const currentWeight = stateWeight(current.data);
  if (nextWeight === 0 && currentWeight > 0) return false;
  if (nextWeight > currentWeight) return true;
  if (nextWeight < currentWeight) return false;
  return incoming.timestamp >= current.timestamp;
}

export async function readSharedState() {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const state = await redis.get(STATE_KEY);
    if (!state) return null;
    if (typeof state === "string") {
      try {
        return JSON.parse(state);
      } catch {
        return null;
      }
    }
    return state;
  } catch (err) {
    console.error("readSharedState:", err);
    return null;
  }
}

export async function writeSharedState(incoming) {
  const redis = getRedis();
  if (!redis) {
    return { ok: false, error: "Redis not configured" };
  }

  const current = await readSharedState();
  if (!shouldReplaceSnapshot(current, incoming)) {
    return { ok: true, skipped: true, state: current };
  }

  const next = {
    clientId: incoming.clientId,
    timestamp: incoming.timestamp,
    data: incoming.data,
  };

  await redis.set(STATE_KEY, next);
  return { ok: true, skipped: false, state: next };
}

export function corsHeaders(origin = "*") {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export async function parseJsonBody(req) {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === "string") {
      return req.body ? JSON.parse(req.body) : {};
    }
    if (Buffer.isBuffer(req.body)) {
      return JSON.parse(req.body.toString("utf8"));
    }
    return req.body;
  }

  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}
