import { createServer } from "http";
import { readFileSync } from "fs";
import { Server } from "socket.io";

/**
 * Dhara — Realtime service (Socket.IO).
 * Rooms: p:{projectId}:{table}
 * - Port 3003: Socket.IO (gateway-forwaded, path "/")
 * - Port 3004: internal admin HTTP (POST /emit with secret, GET /health)
 * - Clients authenticate with any valid Dhara token (JWT / API key / PAT)
 *   via handshake auth; verification is delegated to the main app.
 */

const PORT = 3003;
const ADMIN_PORT = 3004;
const MAIN_APP = "http://127.0.0.1:3000";

function internalSecret(): string {
  try {
    const cfg = JSON.parse(readFileSync(new URL("../../.dhara/config.json", import.meta.url), "utf8"));
    return cfg.internalSecret ?? "";
  } catch {
    return process.env.IKL_INTERNAL_SECRET ?? "";
  }
}

async function verifyToken(token: string): Promise<{ ok: boolean; role?: string }> {
  try {
    const res = await fetch(`${MAIN_APP}/api/internal/verify`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-dhara-internal": internalSecret(),
      },
      body: JSON.stringify({ token }),
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return { ok: false };
    return (await res.json()) as { ok: boolean; role?: string };
  } catch {
    return { ok: false };
  }
}

const io = new Server(createServer(), {
  // DO NOT change the path — the gateway forwards "/" to this port
  path: "/",
  cors: { origin: "*", methods: ["GET", "POST"] },
  pingTimeout: 60000,
  pingInterval: 25000,
});

io.on("connection", (socket) => {
  const token = (socket.handshake.auth?.token as string) ?? "";
  let verified = false;

  socket.on("subscribe", async ({ projectId, table }: { projectId: string; table: string }) => {
    if (!projectId || !table) return;
    if (!verified) {
      const v = await verifyToken(token);
      if (!v.ok) {
        socket.emit("rt_error", { message: "Unauthorized: invalid token" });
        return;
      }
      verified = true;
    }
    const room = `p:${projectId}:${table}`;
    await socket.join(room);
    socket.emit("subscribed", { projectId, table, room });
  });

  socket.on("unsubscribe", ({ projectId, table }: { projectId: string; table: string }) => {
    void socket.leave(`p:${projectId}:${table}`);
  });
});

io.engine.on("connection_error", (err: { req: { url?: string }; message: string }) => {
  if (err.req?.url?.includes("transport=polling") && !err.req.url.includes("EIO=4")) return;
  // log only real errors, ignore gateway probes
});

// Internal admin server — main app pushes change events here
const admin = createServer((req, res) => {
  if (req.method === "POST" && req.url?.startsWith("/emit")) {
    let body = "";
    req.on("data", (c) => {
      body += c;
      if (body.length > 1_000_000) req.destroy();
    });
    req.on("end", () => {
      try {
        if (req.headers["x-dhara-internal"] !== internalSecret()) {
          res.writeHead(403, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "forbidden" }));
          return;
        }
        const payload = JSON.parse(body) as {
          projectId: string;
          table: string;
          event: string;
          record?: unknown;
          old?: unknown;
          count?: number;
        };
        const room = `p:${payload.projectId}:${payload.table}`;
        io.to(room).emit("change", {
          event: payload.event,
          table: payload.table,
          record: payload.record ?? null,
          old: payload.old ?? null,
          count: payload.count ?? null,
          at: new Date().toISOString(),
        });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, room }));
      } catch {
        res.writeHead(400);
        res.end(JSON.stringify({ ok: false }));
      }
    });
    return;
  }
  if (req.method === "GET" && req.url?.startsWith("/health")) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, service: "dhara-realtime", uptime: process.uptime() }));
    return;
  }
  res.writeHead(404);
  res.end();
});

io.listen(PORT);
admin.listen(ADMIN_PORT);
console.log(`[dhara-realtime] socket.io :${PORT} · admin :${ADMIN_PORT}`);
