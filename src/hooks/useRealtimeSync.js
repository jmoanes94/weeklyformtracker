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

/**
 * Real-time sync across anyone with the same app URL (shared link).
 * Server keeps the latest in-memory snapshot; each browser still uses localStorage.
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

      const remoteWeight = stateWeight(data);
      const localWeight = stateWeight({
        websites: websitesRef.current,
        entries: entriesRef.current,
      });

      // Ignore empty broadcasts so a new tab cannot wipe shared data.
      if (remoteWeight === 0 && localWeight > 0) return;

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

    const payload = {
      websites: websitesRef.current,
      entries: entriesRef.current,
    };

    // Do not publish empty state while waiting for a shared snapshot.
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
  }, []);

  const requestSyncFromPeers = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(
      JSON.stringify({
        type: "request_sync",
        clientId: clientIdRef.current,
      })
    );
  }, []);

  const handleIncomingMessage = useCallback(
    (msg) => {
      if (msg.type === "presence" && typeof msg.peerCount === "number") {
        setPeerCount(msg.peerCount);
        return;
      }

      const isRemoteClient = msg.clientId && msg.clientId !== clientIdRef.current;
      const isSharedSnapshot =
        msg.type === "snapshot" || (msg.type === "state" && isRemoteClient);

      if (
        isSharedSnapshot &&
        msg.data &&
        typeof msg.timestamp === "number"
      ) {
        applyRemoteState(msg.data, msg.timestamp);
        return;
      }

      if (
        msg.type === "request_sync" &&
        isRemoteClient &&
        hasLocalData(websitesRef.current, entriesRef.current)
      ) {
        broadcastState();
      }
    },
    [applyRemoteState, broadcastState]
  );

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

        if (hasLocalData(websitesRef.current, entriesRef.current)) {
          broadcastState();
        } else {
          requestSyncFromPeers();
        }
      };

      ws.onmessage = (event) => {
        try {
          handleIncomingMessage(JSON.parse(event.data));
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
  }, [broadcastState, requestSyncFromPeers, handleIncomingMessage]);

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
