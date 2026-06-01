import { Redis } from "@upstash/redis";

const STATE_KEY = "wp-form:shared-state";

function stateWeight(data) {
  if (!data) return 0;
  return (data.websites?.length ?? 0) + (data.entries?.length ?? 0);
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

export function getRedis() {
  const url =
    process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token =
    process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) return null;
  return new Redis({ url, token });
}

export async function readSharedState() {
  const redis = getRedis();
  if (!redis) return null;
  const raw = await redis.get(STATE_KEY);
  if (!raw) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return raw;
}

export async function writeSharedState(incoming) {
  const redis = getRedis();
  if (!redis) return { ok: false, error: "Redis not configured" };

  const current = await readSharedState();
  if (!shouldReplaceSnapshot(current, incoming)) {
    return { ok: true, skipped: true, state: current };
  }

  const next = {
    clientId: incoming.clientId,
    timestamp: incoming.timestamp,
    data: incoming.data,
  };

  await redis.set(STATE_KEY, JSON.stringify(next));
  return { ok: true, skipped: false, state: next };
}

export function corsHeaders(origin = "*") {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}
