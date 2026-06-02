import { useEffect, useRef, useState, useCallback } from "react";

const CLIENT_ID_KEY = "wp-form-ws-client-id";
const POLL_MS = 1200;

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
    if (!res.ok) return { available: false, storageReady: false };
    const json = await res.json();
    return { available: true, storageReady: Boolean(json.storageReady) };
  } catch {
    return { available: false, storageReady: false };
  }
}

async function resolveSyncTransport() {
  const forced = import.meta.env.VITE_SYNC_MODE;
  if (forced === "websocket") return "websocket";
  if (forced === "poll" || forced === "sse" || forced === "http") return "poll";
  if (import.meta.env.VITE_WS_URL) return "websocket";
  if (import.meta.env.DEV) return "websocket";

  const probe = await probeApiSync();
  if (probe.available) return "poll";
  return "websocket";
}

/**
 * Local dev: WebSocket. Vercel production: shared KV + polling (Vercel cannot host WebSockets).
 */
export function useRealtimeSync({ websites, entries, setWebsites, setEntries }) {
  const [connected, setConnected] = useState(false);
  const [peerCount, setPeerCount] = useState(0);
  const [syncMode, setSyncMode] = useState("connecting");
  const [syncError, setSyncError] = useState(null);

  const clientIdRef = useRef(getOrCreateClientId());
  const wsRef = useRef(null);
  const pollTimerRef = useRef(null);
  const transportRef = useRef(null);
  const lastAppliedTsRef = useRef(0);
  const skipNextBroadcastRef = useRef(false);
  const reconnectDelayRef = useRef(1000);
  const pushingRef = useRef(false);

  const websitesRef = useRef(websites);
  const entriesRef = useRef(entries);
  websitesRef.current = websites;
  entriesRef.current = entries;

  const applyRemoteState = useCallback(
    (data, timestamp, fromClientId) => {
      if (!data || typeof timestamp !== "number") return;
      if (timestamp < lastAppliedTsRef.current) return;

      const remoteWeight = stateWeight(data);
      const localWeight = stateWeight({
        websites: websitesRef.current,
        entries: entriesRef.current,
      });

      if (remoteWeight === 0 && localWeight > 0) return;

      const isOwnWrite =
        fromClientId && fromClientId === clientIdRef.current;
      if (isOwnWrite && timestamp <= lastAppliedTsRef.current) return;

      lastAppliedTsRef.current = timestamp;
      skipNextBroadcastRef.current = true;
      if (Array.isArray(data.websites)) setWebsites(data.websites);
      if (Array.isArray(data.entries)) setEntries(data.entries);
    },
    [setWebsites, setEntries]
  );

  const handleIncomingMessage = useCallback(
    (msg) => {
      if (msg.type === "presence" && typeof msg.peerCount === "number") {
        setPeerCount(msg.peerCount);
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
        setSyncError(
          json.error ??
            "Link Redis to this project (Vercel → Storage → Redis), then redeploy."
        );
        setConnected(false);
        return false;
      }

      if (!res.ok) return false;

      setSyncError(null);
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
        setSyncError(
          json.error ??
            "Link Redis to this project (Vercel → Storage → Redis), then redeploy."
        );
        setConnected(false);
        return;
      }

      if (!res.ok) return;

      setSyncError(null);
      setConnected(true);

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
    if (transportRef.current === "poll") {
      pushStateToServer();
    } else {
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
    }
  }, [pushStateToServer]);

  const connectWebSocket = useCallback(() => {
    const ws = new WebSocket(getWebSocketUrl());
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      setSyncError(null);
      reconnectDelayRef.current = 1000;

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
      reconnectDelayRef.current = Math.min(delay * 2, 10000);
      setTimeout(() => {
        if (transportRef.current === "websocket") connectWebSocket();
      }, delay);
    };

    ws.onerror = () => ws.close();
  }, [broadcastState, handleIncomingMessage]);

  const startPolling = useCallback(() => {
    const tick = async () => {
      await pullStateFromServer();
    };

    tick();

    pollTimerRef.current = setInterval(tick, POLL_MS);
  }, [pullStateFromServer]);

  const connectPoll = useCallback(async () => {
    const probe = await probeApiSync();
    if (!probe.storageReady) {
      setSyncError(
        "Redis is not linked. Vercel Dashboard → Storage → Redis → Connect → Redeploy."
      );
      setConnected(false);
      setSyncMode("poll");
      return;
    }

    setSyncError(null);
    setSyncMode("poll");
    await pullStateFromServer();

    if (hasLocalData(websitesRef.current, entriesRef.current)) {
      await pushStateToServer();
    }

    startPolling();
  }, [pullStateFromServer, pushStateToServer, startPolling]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const transport = await resolveSyncTransport();
      if (cancelled) return;

      transportRef.current = transport;
      setSyncMode(transport);

      if (transport === "poll") {
        connectPoll();
      } else {
        connectWebSocket();
      }
    })();

    return () => {
      cancelled = true;
      transportRef.current = null;
      wsRef.current?.close();
      wsRef.current = null;
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [connectPoll, connectWebSocket]);

  useEffect(() => {
    if (!connected || transportRef.current !== "poll") return;
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

  return { connected, peerCount, syncMode, syncError };
}
