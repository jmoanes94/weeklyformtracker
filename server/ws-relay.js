/**
 * Shared in-memory WebSocket relay (no database).
 * Used by the dev-only relay and the production HTTP server.
 */
export function setupWebSocketRelay(wss) {
  const clients = new Set();

  function broadcastClientCount() {
    const count = clients.size;
    const payload = JSON.stringify({ type: "presence", peerCount: count });
    for (const client of clients) {
      if (client.readyState === 1) client.send(payload);
    }
  }

  wss.on("connection", (ws) => {
    clients.add(ws);
    broadcastClientCount();

    ws.on("message", (raw) => {
      const text = raw.toString();
      for (const client of clients) {
        if (client !== ws && client.readyState === 1) {
          client.send(text);
        }
      }
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
