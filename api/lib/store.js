import { get, head, put } from "@vercel/blob";
import { mergeSharedData, sharedDataEquals } from "../../shared/mergeState.js";

const STATE_BLOB_PATH = "wp-form/shared-state.json";

/** In-memory fallback for local dev when Blob is not configured. */
let memoryState = null;
let memoryEtag = 0;

function readEnv(name) {
  try {
    const value = process.env[name];
    return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
  } catch {
    return undefined;
  }
}

/** Vercel Blob via static token or OIDC (BLOB_STORE_ID + VERCEL_OIDC_TOKEN). */
export function hasBlobCredentials() {
  if (readEnv("BLOB_READ_WRITE_TOKEN")) return true;
  if (readEnv("BLOB_STORE_ID") && readEnv("VERCEL_OIDC_TOKEN")) return true;
  return false;
}

export function getStorageDiagnostics() {
  const readWriteToken = Boolean(readEnv("BLOB_READ_WRITE_TOKEN"));
  const storeId = Boolean(readEnv("BLOB_STORE_ID"));
  const oidcToken = Boolean(readEnv("VERCEL_OIDC_TOKEN"));
  const onVercel = Boolean(readEnv("VERCEL"));
  const devMemory = isDevMemoryFallback();

  return {
    readWriteToken,
    storeId,
    oidcToken,
    onVercel,
    devMemory,
    credentialsFound: hasBlobCredentials(),
  };
}

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

export function isStorageReady() {
  return hasBlobCredentials();
}

export function isDevMemoryFallback() {
  return !isStorageReady() && !process.env.VERCEL;
}

export function canUseSharedStorage() {
  return isStorageReady() || isDevMemoryFallback();
}

/** Confirms Blob credentials can reach the store (missing file is OK). */
export async function probeBlobStorage() {
  if (!isStorageReady()) {
    return { ok: false, reason: "no_credentials" };
  }

  try {
    await head(STATE_BLOB_PATH);
    return { ok: true, reason: "reachable" };
  } catch (err) {
    if (err?.name === "BlobNotFoundError" || err?.code === "BLOB_NOT_FOUND") {
      return { ok: true, reason: "empty_store" };
    }
    console.error("probeBlobStorage:", err);
    return {
      ok: false,
      reason: "access_failed",
      message: err?.message ?? "Blob store unreachable",
    };
  }
}

async function readFromBlob() {
  try {
    let etag = null;
    try {
      const meta = await head(STATE_BLOB_PATH);
      etag = meta?.etag ?? null;
    } catch (headErr) {
      if (headErr?.name !== "BlobNotFoundError" && headErr?.code !== "BLOB_NOT_FOUND") {
        throw headErr;
      }
      return null;
    }

    const result = await get(STATE_BLOB_PATH, { access: "private" });
    if (!result?.stream) return null;
    const raw = await new Response(result.stream).text();
    if (!raw) return null;
    const state = JSON.parse(raw);
    return { ...state, etag };
  } catch (err) {
    if (err?.name === "BlobNotFoundError" || err?.code === "BLOB_NOT_FOUND") {
      return null;
    }
    console.error("readFromBlob:", err);
    return null;
  }
}

async function writeToBlob(next, etag) {
  const options = {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
    cacheControlMaxAge: 5,
  };
  if (etag) options.ifMatch = etag;

  const blob = await put(STATE_BLOB_PATH, JSON.stringify(next), options);
  return blob;
}

export async function readSharedState() {
  if (isStorageReady()) {
    return readFromBlob();
  }
  if (isDevMemoryFallback()) {
    return memoryState;
  }
  return null;
}

function buildMergedState(current, incoming) {
  const mergedData = mergeSharedData(current?.data, incoming.data, {
    preferIncoming: true,
  });
  const currentWeight = stateWeight(current?.data);
  const mergedWeight = stateWeight(mergedData);

  if (mergedWeight === 0 && currentWeight > 0) {
    return { skip: true, state: current };
  }

  if (current && sharedDataEquals(current.data, mergedData)) {
    return { skip: true, state: current };
  }

  return {
    skip: false,
    state: {
      clientId: incoming.clientId,
      timestamp: Date.now(),
      data: mergedData,
    },
  };
}

export async function writeSharedState(incoming) {
  if (!isStorageReady()) {
    if (!isDevMemoryFallback()) {
      return { ok: false, error: "Vercel Blob not configured" };
    }

    const result = buildMergedState(memoryState, incoming);
    if (result.skip) {
      return { ok: true, skipped: true, state: memoryState };
    }

    memoryEtag += 1;
    memoryState = { ...result.state, etag: String(memoryEtag) };
    return { ok: true, skipped: false, state: memoryState };
  }

  let current = await readFromBlob();
  let built = buildMergedState(current, incoming);
  if (built.skip) {
    return { ok: true, skipped: true, state: current };
  }

  let next = built.state;
  let etag = current?.etag ?? null;
  const maxAttempts = 3;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const blob = await writeToBlob(next, etag);
      return {
        ok: true,
        skipped: false,
        state: { ...next, etag: blob.etag ?? blob.url },
      };
    } catch (err) {
      if (err?.name === "BlobPreconditionFailedError" && attempt < maxAttempts - 1) {
        current = await readFromBlob();
        built = buildMergedState(current, incoming);
        if (built.skip) {
          return { ok: true, skipped: true, state: current };
        }
        next = built.state;
        etag = current?.etag ?? null;
        continue;
      }
      console.error("writeSharedState:", err);
      return { ok: false, error: "Failed to write shared state" };
    }
  }

  return { ok: false, error: "Failed to write shared state after retries" };
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
