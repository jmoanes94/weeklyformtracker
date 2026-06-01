import { useEffect, useRef, useState, useCallback } from "react";

const CLIENT_ID_KEY = "wp-form-ws-client-id";

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

async function resolveSyncTransport() {
  const forced = import.meta.env.VITE_SYNC_MODE;
  if (forced === "websocket") return "websocket";
  if (forced === "sse" || forced === "http") return "sse";
  if (import.meta.env.VITE_WS_URL) return "websocket";
  if (import.meta.env.DEV) return "websocket";

  try {
    const res = await fetch("/api/state", { method: "GET" });
    if (res.status === 200 || res.status === 503) return "sse";
  } catch {
    /* not on Vercel / no API routes */
  }
  return "websocket";
}

/**
 * Real-time sync: WebSocket on Node hosts (dev, Render), SSE + shared Redis on Vercel.
 */
export function useRealtimeSync({ websites, entries, setWebsites, setEntries }) {
  const [connected, setConnected] = useState(false);
  const [peerCount, setPeerCount] = useState(0);
  const [syncMode, setSyncMode] = useState("connecting");
  const [syncError, setSyncError] = useState(null);

  const clientIdRef = useRef(getOrCreateClientId());
  const wsRef = useRef(null);
  const eventSourceRef = useRef(null);
  const transportRef = useRef(null);
  const lastAppliedTsRef = useRef(0);
  const skipNextBroadcastRef = useRef(false);
  const reconnectDelayRef = useRef(1000);

  const websitesRef = useRef(websites);
  const entriesRef = useRef(entries);
  websitesRef.current = websites;
  entriesRef.current = entries;

  const applyRemoteState = useCallback(
    (data, timestamp) => {
      if (!data || timestamp <= lastAppliedTsRef.current) return;

      const remoteWeight = stateWeight(data);
      const localWeight = stateWeight({
        websites: websitesRef.current,
        entries: entriesRef.current,
      });

      if (remoteWeight === 0 && localWeight > 0) return;

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
        applyRemoteState(msg.data, msg.timestamp);
      }
    },
    [applyRemoteState]
  );

  const pushStateToServer = useCallback(async () => {
    const payload = {
      websites: websitesRef.current,
      entries: entriesRef.current,
    };
    if (stateWeight(payload) === 0) return;

    const timestamp = Date.now();
    lastAppliedTsRef.current = timestamp;

    const body = {
      type: "state",
      clientId: clientIdRef.current,
      timestamp,
      data: payload,
    };

    if (transportRef.current === "sse") {
      const res = await fetch("/api/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.status === 503) {
        const err = await res.json().catch(() => ({}));
        setSyncError(err.error ?? "Shared storage not configured on Vercel.");
        setConnected(false);
      }
      return;
    }

    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(body));
    }
  }, []);

  const pullStateFromServer = useCallback(async () => {
    try {
      const res = await fetch("/api/state", { method: "GET" });
      if (res.status === 503) {
        const err = await res.json().catch(() => ({}));
        setSyncError(err.error ?? "Shared storage not configured on Vercel.");
        setConnected(false);
        return;
      }
      if (!res.ok) return;
      const json = await res.json();
      if (json.state?.data && typeof json.state.timestamp === "number") {
        handleIncomingMessage({ type: "snapshot", ...json.state });
      }
    } catch {
      /* ignore */
    }
  }, [handleIncomingMessage]);

  const broadcastState = useCallback(() => {
    pushStateToServer();
  }, [pushStateToServer]);

  const connectWebSocket = useCallback(() => {
    const ws = new WebSocket(getWebSocketUrl());
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      setSyncError(null);
      reconnectDelayRef.current = 1000;

      if (hasLocalData(websitesRef.current, entriesRef.current)) {
        pushStateToServer();
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
  }, [handleIncomingMessage, pushStateToServer]);

  const connectSse = useCallback(() => {
    pullStateFromServer();

    const es = new EventSource("/api/events");
    eventSourceRef.current = es;

    es.onopen = () => {
      setConnected(true);
      setSyncError(null);
      setSyncMode("sse");
      if (hasLocalData(websitesRef.current, entriesRef.current)) {
        pushStateToServer();
      }
    };

    es.onmessage = (event) => {
      try {
        handleIncomingMessage(JSON.parse(event.data));
      } catch {
        /* ignore */
      }
    };

    es.onerror = () => {
      setConnected(false);
      es.close();
      eventSourceRef.current = null;
      setTimeout(() => {
        if (transportRef.current === "sse") connectSse();
      }, reconnectDelayRef.current);
      reconnectDelayRef.current = Math.min(reconnectDelayRef.current * 2, 10000);
    };
  }, [handleIncomingMessage, pullStateFromServer, pushStateToServer]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const transport = await resolveSyncTransport();
      if (cancelled) return;

      transportRef.current = transport;
      setSyncMode(transport);

      if (transport === "sse") {
        connectSse();
      } else {
        connectWebSocket();
      }
    })();

    return () => {
      cancelled = true;
      transportRef.current = null;
      wsRef.current?.close();
      wsRef.current = null;
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
    };
  }, [connectSse, connectWebSocket]);

  useEffect(() => {
    if (!connected) return;
    if (skipNextBroadcastRef.current) {
      skipNextBroadcastRef.current = false;
      return;
    }
    broadcastState();
  }, [websites, entries, connected, broadcastState]);

  return { connected, peerCount, syncMode, syncError };
}
