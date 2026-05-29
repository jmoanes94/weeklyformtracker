/**
 * In-memory WebSocket relay — no database.
 * Clients broadcast full app state; this server forwards to every other peer.
 */
import { WebSocketServer } from "ws";

const PORT = Number(process.env.WS_PORT) || 3001;
const wss = new WebSocketServer({ port: PORT });
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

console.log(`WebSocket relay listening on ws://localhost:${PORT}`);
