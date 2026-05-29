/**
 * Dev-only standalone WebSocket relay (Vite proxies /ws here).
 */
import { WebSocketServer } from "ws";
import { setupWebSocketRelay } from "./ws-relay.js";

const PORT = Number(process.env.WS_PORT) || 3001;
const wss = new WebSocketServer({ port: PORT });

setupWebSocketRelay(wss);

console.log(`WebSocket relay (dev) listening on ws://localhost:${PORT}`);
