/**
 * Production server: static React build + WebSocket relay on /ws (same origin).
 */
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { WebSocketServer } from "ws";
import { setupWebSocketRelay } from "./ws-relay.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUILD_DIR = path.join(__dirname, "..", "build");
const PORT = Number(process.env.PORT) || 3000;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".webp": "image/webp",
  ".map": "application/json",
};

function safePathFromUrl(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const relative = decoded === "/" ? "/index.html" : decoded;
  const resolved = path.normalize(path.join(BUILD_DIR, relative));
  if (!resolved.startsWith(BUILD_DIR)) return null;
  return resolved;
}

function serveFile(filePath, res) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] ?? "application/octet-stream";

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(err.code === "ENOENT" ? 404 : 500);
      res.end(err.code === "ENOENT" ? "Not found" : "Server error");
      return;
    }
    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  });
}

function serveSpa(res) {
  serveFile(path.join(BUILD_DIR, "index.html"), res);
}

const server = http.createServer((req, res) => {
  if (!req.url || req.method !== "GET") {
    res.writeHead(405);
    res.end("Method not allowed");
    return;
  }

  const filePath = safePathFromUrl(req.url);
  if (!filePath) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.stat(filePath, (err, stat) => {
    if (!err && stat.isFile()) {
      serveFile(filePath, res);
      return;
    }
    if (!err && stat.isDirectory()) {
      const indexPath = path.join(filePath, "index.html");
      fs.stat(indexPath, (indexErr, indexStat) => {
        if (!indexErr && indexStat.isFile()) {
          serveFile(indexPath, res);
        } else {
          serveSpa(res);
        }
      });
      return;
    }
    serveSpa(res);
  });
});

const wss = new WebSocketServer({ server, path: "/ws" });
setupWebSocketRelay(wss);

if (!fs.existsSync(BUILD_DIR)) {
  console.error(
    `Build folder not found at ${BUILD_DIR}. Run "npm run build" before "npm start".`
  );
  process.exit(1);
}

server.listen(PORT, () => {
  console.log(`Production server http://localhost:${PORT}`);
  console.log(`WebSocket relay ws://localhost:${PORT}/ws`);
});
