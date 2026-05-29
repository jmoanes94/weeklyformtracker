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
  if (import.meta.env.DEV) {
    return `${protocol}//${window.location.host}/ws`;
  }
  const host = import.meta.env.VITE_WS_HOST || `${window.location.hostname}:3001`;
  return `${protocol}//${host}`;
}

/**
 * Keeps websites + entries in sync across tabs/browsers via WebSocket.
 * Persistence stays in localStorage on each client.
 */
export function useRealtimeSync({ websites, entries, setWebsites, setEntries }) {
  const [connected, setConnected] = useState(false);
  const [peerCount, setPeerCount] = useState(0);

  const clientIdRef = useRef(getOrCreateClientId());
  const wsRef = useRef(null);
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
      lastAppliedTsRef.current = timestamp;
      skipNextBroadcastRef.current = true;
      if (Array.isArray(data.websites)) setWebsites(data.websites);
      if (Array.isArray(data.entries)) setEntries(data.entries);
    },
    [setWebsites, setEntries]
  );

  const broadcastState = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    const timestamp = Date.now();
    lastAppliedTsRef.current = timestamp;

    ws.send(
      JSON.stringify({
        type: "state",
        clientId: clientIdRef.current,
        timestamp,
        data: {
          websites: websitesRef.current,
          entries: entriesRef.current,
        },
      })
    );
  }, []);

  useEffect(() => {
    let cancelled = false;
    let reconnectTimer = null;

    function connect() {
      if (cancelled) return;

      const ws = new WebSocket(getWebSocketUrl());
      wsRef.current = ws;

      ws.onopen = () => {
        if (cancelled) return;
        setConnected(true);
        reconnectDelayRef.current = 1000;
        broadcastState();
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);

          if (msg.type === "presence" && typeof msg.peerCount === "number") {
            setPeerCount(msg.peerCount);
            return;
          }

          if (
            msg.type === "state" &&
            msg.clientId !== clientIdRef.current &&
            msg.data &&
            typeof msg.timestamp === "number"
          ) {
            applyRemoteState(msg.data, msg.timestamp);
          }
        } catch {
          /* ignore malformed messages */
        }
      };

      ws.onclose = () => {
        if (cancelled) return;
        setConnected(false);
        wsRef.current = null;
        const delay = reconnectDelayRef.current;
        reconnectDelayRef.current = Math.min(delay * 2, 10000);
        reconnectTimer = setTimeout(connect, delay);
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    return () => {
      cancelled = true;
      clearTimeout(reconnectTimer);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [applyRemoteState, broadcastState]);

  // Push local edits to other clients (localStorage is still saved in App.jsx).
  useEffect(() => {
    if (!connected) return;
    if (skipNextBroadcastRef.current) {
      skipNextBroadcastRef.current = false;
      return;
    }
    broadcastState();
  }, [websites, entries, connected, broadcastState]);

  return { connected, peerCount };
}
