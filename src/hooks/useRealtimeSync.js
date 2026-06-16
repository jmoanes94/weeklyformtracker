import { useEffect, useRef, useState, useCallback } from "react";
import { mergeSharedData, sharedDataEquals } from "../../shared/mergeState.js";

const CLIENT_ID_KEY = "wp-form-ws-client-id";
const SSE_RECONNECT_MIN_MS = 1000;
const SSE_RECONNECT_MAX_MS = 10000;
const POLL_FALLBACK_MS = 1500;

function getOrCreateClientId() {
  try {
    let id = sessionStorage.getItem(CLIENT_ID_KEY);
    if (!id) {
      id = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
      sessionStorage.setItem(CLIENT_ID_KEY, id);
    }
    return id;
  } catch {
    return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  }
}

function getWebSocketUrl() {
  if (import.meta.env.VITE_WS_URL) {
    return import.meta.env.VITE_WS_URL;
  }
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws`;
}

function stateWeight(data) {
  if (!data) return 0;
  return (data.websites?.length ?? 0) + (data.entries?.length ?? 0);
}

function hasLocalData(websites, entries) {
  return websites.length > 0 || entries.length > 0;
}

async function probeApiSync() {
  try {
    const res = await fetch("/api/health", { method: "GET", cache: "no-store" });
    if (!res.ok) return { available: false, storageReady: false, hint: null, setupUrl: null };
    const json = await res.json();
    return {
      available: true,
      storageReady: Boolean(json.storageReady),
      hint: json.hint ?? null,
      setupUrl: json.setupUrl ?? null,
    };
  } catch {
    return { available: false, storageReady: false, hint: null, setupUrl: null };
  }
}

async function resolveSyncTransport() {
  const forced = import.meta.env.VITE_SYNC_MODE;
  if (forced === "websocket") return "websocket";
  if (forced === "sse") return "sse";
  if (forced === "poll" || forced === "http") return "sse";
  if (import.meta.env.VITE_WS_URL) return "websocket";
  // Local dev: WebSocket relay (Vite proxies /ws → ws-server.js).
  if (import.meta.env.DEV) return "websocket";

  // Vercel production: SSE + Blob. Vercel Functions cannot host WebSocket connections.
  return "sse";
}

/**
 * Local dev: WebSocket relay. Vercel production: Vercel Blob + SSE (no database).
 */
export function useRealtimeSync({ websites, entries, setWebsites, setEntries }) {
  const [connected, setConnected] = useState(false);
  const [peerCount, setPeerCount] = useState(0);
  const [syncMode, setSyncMode] = useState("connecting");
  const [syncError, setSyncError] = useState(null);
  const [setupUrl, setSetupUrl] = useState(null);

  const clientIdRef = useRef(getOrCreateClientId());
  const wsRef = useRef(null);
  const eventSourceRef = useRef(null);
  const pollTimerRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const transportRef = useRef(null);
  const lastAppliedTsRef = useRef(0);
  const skipNextBroadcastRef = useRef(false);
  const reconnectDelayRef = useRef(SSE_RECONNECT_MIN_MS);
  const pushingRef = useRef(false);
  const mountedRef = useRef(true);

  const websitesRef = useRef(websites);
  const entriesRef = useRef(entries);
  websitesRef.current = websites;
  entriesRef.current = entries;

  const applyRemoteState = useCallback(
    (data, timestamp, fromClientId) => {
      if (!data || typeof timestamp !== "number") return;

      const local = {
        websites: websitesRef.current,
        entries: entriesRef.current,
      };
      const remoteWeight = stateWeight(data);
      const localWeight = stateWeight(local);

      if (remoteWeight === 0 && localWeight > 0) return;

      const merged = mergeSharedData(local, data);
      if (sharedDataEquals(local, merged)) {
        lastAppliedTsRef.current = Math.max(lastAppliedTsRef.current, timestamp);
        return;
      }

      const isOwnWrite = fromClientId && fromClientId === clientIdRef.current;
      if (isOwnWrite && timestamp <= lastAppliedTsRef.current) return;

      lastAppliedTsRef.current = Math.max(lastAppliedTsRef.current, timestamp);
      skipNextBroadcastRef.current = true;
      setWebsites(merged.websites);
      setEntries(merged.entries);
    },
    [setWebsites, setEntries]
  );

  const handleIncomingMessage = useCallback(
    (msg) => {
      if (msg.type === "connected") {
        setConnected(true);
        setSyncError(null);
        reconnectDelayRef.current = SSE_RECONNECT_MIN_MS;
        return;
      }

      if (msg.type === "presence" && typeof msg.peerCount === "number") {
        setPeerCount(msg.peerCount);
        return;
      }

      if (msg.type === "error") {
        setSyncError(msg.message ?? "Sync stream error");
        return;
      }

      const isRemoteClient = msg.clientId && msg.clientId !== clientIdRef.current;
      const isSharedSnapshot =
        msg.type === "snapshot" || (msg.type === "state" && isRemoteClient);

      if (isSharedSnapshot && msg.data && typeof msg.timestamp === "number") {
        applyRemoteState(msg.data, msg.timestamp, msg.clientId);
      }
    },
    [applyRemoteState]
  );

  const pullStateFromServer = useCallback(async () => {
    try {
      const res = await fetch("/api/state", { method: "GET", cache: "no-store" });
      const json = await res.json().catch(() => ({}));

      if (res.status === 503 || json.storageReady === false) {
        const hint = json.hint ?? json.error;
        setSyncError(
          hint ??
            "Link Vercel Blob: Dashboard → Storage → Blob → Connect → Redeploy."
        );
        if (json.setupUrl) setSetupUrl(json.setupUrl);
        setConnected(false);
        return false;
      }

      if (!res.ok) return false;

      setSyncError(null);
      setSetupUrl(null);
      setConnected(true);

      if (json.state?.data && typeof json.state.timestamp === "number") {
        applyRemoteState(
          json.state.data,
          json.state.timestamp,
          json.state.clientId
        );
      }
      return true;
    } catch {
      return false;
    }
  }, [applyRemoteState]);

  const pushStateToServer = useCallback(async () => {
    if (pushingRef.current) return;

    const payload = {
      websites: websitesRef.current,
      entries: entriesRef.current,
    };
    if (stateWeight(payload) === 0) return;

    const body = {
      type: "state",
      clientId: clientIdRef.current,
      timestamp: Date.now(),
      data: payload,
    };

    pushingRef.current = true;
    try {
      const res = await fetch("/api/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));

      if (res.status === 503 || json.storageReady === false) {
        const hint = json.hint ?? json.error;
        setSyncError(
          hint ??
            "Link Vercel Blob: Dashboard → Storage → Blob → Connect → Redeploy."
        );
        if (json.setupUrl) setSetupUrl(json.setupUrl);
        setConnected(false);
        return;
      }

      if (!res.ok) return;

      setSyncError(null);
      setSetupUrl(null);
      setConnected(true);

      if (json.skipped) return;

      if (json.state?.timestamp) {
        lastAppliedTsRef.current = json.state.timestamp;
      } else {
        lastAppliedTsRef.current = body.timestamp;
      }
    } finally {
      pushingRef.current = false;
    }
  }, []);

  const broadcastState = useCallback(() => {
    if (transportRef.current === "sse") {
      pushStateToServer();
      return;
    }

    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const payload = {
      websites: websitesRef.current,
      entries: entriesRef.current,
    };
    if (stateWeight(payload) === 0) return;
    const timestamp = Date.now();
    lastAppliedTsRef.current = timestamp;
    ws.send(
      JSON.stringify({
        type: "state",
        clientId: clientIdRef.current,
        timestamp,
        data: payload,
      })
    );
  }, [pushStateToServer]);

  const scheduleSseReconnect = useCallback(() => {
    if (!mountedRef.current || transportRef.current !== "sse") return;

    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
    }

    const delay = reconnectDelayRef.current;
    reconnectDelayRef.current = Math.min(delay * 2, SSE_RECONNECT_MAX_MS);
    setConnected(false);

    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      if (mountedRef.current && transportRef.current === "sse") {
        connectSseRef.current?.();
      }
    }, delay);
  }, []);

  const connectSseRef = useRef(null);

  const connectSse = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    const es = new EventSource("/api/events");
    eventSourceRef.current = es;

    es.onopen = () => {
      setSyncError(null);
    };

    es.onmessage = (event) => {
      try {
        handleIncomingMessage(JSON.parse(event.data));
      } catch {
        /* ignore malformed frames */
      }
    };

    es.onerror = () => {
      es.close();
      eventSourceRef.current = null;
      scheduleSseReconnect();
    };
  }, [handleIncomingMessage, scheduleSseReconnect]);

  connectSseRef.current = connectSse;

  const connectWebSocket = useCallback(() => {
    const ws = new WebSocket(getWebSocketUrl());
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      setSyncError(null);
      reconnectDelayRef.current = SSE_RECONNECT_MIN_MS;

      if (hasLocalData(websitesRef.current, entriesRef.current)) {
        broadcastState();
      } else {
        ws.send(
          JSON.stringify({
            type: "request_sync",
            clientId: clientIdRef.current,
          })
        );
      }
    };

    ws.onmessage = (event) => {
      try {
        handleIncomingMessage(JSON.parse(event.data));
      } catch {
        /* ignore */
      }
    };

    ws.onclose = () => {
      setConnected(false);
      wsRef.current = null;
      const delay = reconnectDelayRef.current;
      reconnectDelayRef.current = Math.min(delay * 2, SSE_RECONNECT_MAX_MS);
      setTimeout(() => {
        if (transportRef.current === "websocket") connectWebSocket();
      }, delay);
    };

    ws.onerror = () => ws.close();
  }, [broadcastState, handleIncomingMessage]);

  const connectSseTransport = useCallback(async () => {
    setSyncMode("sse");
    reconnectDelayRef.current = SSE_RECONNECT_MIN_MS;

    const pulled = await pullStateFromServer();
    if (!pulled) {
      setConnected(false);
      return;
    }

    setSyncError(null);

    if (hasLocalData(websitesRef.current, entriesRef.current)) {
      await pushStateToServer();
    }

    connectSse();

    pollTimerRef.current = setInterval(() => {
      pullStateFromServer().catch(() => {});
    }, POLL_FALLBACK_MS);
  }, [pullStateFromServer, pushStateToServer, connectSse]);

  // Re-fetch shared state when the user returns to this tab.
  useEffect(() => {
    if (syncMode !== "sse") return;

    const refresh = () => {
      pullStateFromServer().catch(() => {});
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") refresh();
    };

    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [syncMode, pullStateFromServer]);

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;

    (async () => {
      const transport = await resolveSyncTransport();
      if (cancelled) return;

      transportRef.current = transport;
      setSyncMode(transport);

      if (transport === "sse") {
        connectSseTransport();
      } else {
        connectWebSocket();
      }
    })();

    return () => {
      cancelled = true;
      mountedRef.current = false;
      transportRef.current = null;

      wsRef.current?.close();
      wsRef.current = null;

      eventSourceRef.current?.close();
      eventSourceRef.current = null;

      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }

      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };
  }, [connectSseTransport, connectWebSocket]);

  useEffect(() => {
    if (!connected || transportRef.current !== "sse") return;
    if (skipNextBroadcastRef.current) {
      skipNextBroadcastRef.current = false;
      return;
    }
    pushStateToServer();
  }, [websites, entries, connected, pushStateToServer]);

  useEffect(() => {
    if (!connected || transportRef.current !== "websocket") return;
    if (skipNextBroadcastRef.current) {
      skipNextBroadcastRef.current = false;
      return;
    }
    broadcastState();
  }, [websites, entries, connected, broadcastState]);

  return { connected, peerCount, syncMode, syncError, setupUrl };
}
