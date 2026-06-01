/**
 * In-memory WebSocket relay + latest shared snapshot (no database file).
 * New visitors who open a shared link receive the snapshot on connect.
 */

function stateWeight(data) {
  if (!data) return 0;
  return (data.websites?.length ?? 0) + (data.entries?.length ?? 0);
}

function shouldReplaceSnapshot(current, incoming) {
  if (!incoming?.data) return false;
  const nextWeight = stateWeight(incoming.data);
  if (!current) return true;
  const currentWeight = stateWeight(current.data);
  // Never let an empty payload wipe data others are sharing.
  if (nextWeight === 0 && currentWeight > 0) return false;
  if (nextWeight > currentWeight) return true;
  if (nextWeight < currentWeight) return false;
  return incoming.timestamp >= current.timestamp;
}

export function setupWebSocketRelay(wss) {
  const clients = new Set();
  let latestSnapshot = null;

  function broadcastClientCount() {
    const count = clients.size;
    const payload = JSON.stringify({ type: "presence", peerCount: count });
    for (const client of clients) {
      if (client.readyState === 1) client.send(payload);
    }
  }

  function sendSnapshot(ws) {
    if (!latestSnapshot || ws.readyState !== 1) return;
    ws.send(
      JSON.stringify({
        type: "snapshot",
        clientId: latestSnapshot.clientId,
        timestamp: latestSnapshot.timestamp,
        data: latestSnapshot.data,
      })
    );
  }

  function maybeUpdateSnapshot(msg) {
    if (msg?.type !== "state" || !msg.data) return;
    if (!shouldReplaceSnapshot(latestSnapshot, msg)) return;
    latestSnapshot = {
      clientId: msg.clientId,
      timestamp: msg.timestamp,
      data: msg.data,
    };
  }

  function relayToOthers(sender, text) {
    for (const client of clients) {
      if (client !== sender && client.readyState === 1) {
        client.send(text);
      }
    }
  }

  wss.on("connection", (ws) => {
    clients.add(ws);
    sendSnapshot(ws);
    broadcastClientCount();

    ws.on("message", (raw) => {
      const text = raw.toString();
      let msg;
      try {
        msg = JSON.parse(text);
      } catch {
        relayToOthers(ws, text);
        return;
      }

      if (msg.type === "state") {
        maybeUpdateSnapshot(msg);
      }

      if (msg.type === "request_sync" && latestSnapshot) {
        ws.send(
          JSON.stringify({
            type: "snapshot",
            clientId: latestSnapshot.clientId,
            timestamp: latestSnapshot.timestamp,
            data: latestSnapshot.data,
          })
        );
      }

      relayToOthers(ws, text);
    });

    ws.on("close", () => {
      clients.delete(ws);
      broadcastClientCount();
    });

    ws.on("error", () => {
      clients.delete(ws);
      broadcastClientCount();
    });
  });
}
