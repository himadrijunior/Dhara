#!/usr/bin/env node
/**
 * Dhara — MCP stdio bridge (for Claude Desktop / local MCP clients).
 *
 * Usage (Claude Desktop config):
 * {
 *   "mcpServers": {
 *     "dhara-db": {
 *       "command": "node",
 *       "args": ["/path/to/dhara/mcp/server.mjs"],
 *       "env": {
 *         "DHARA_URL": "https://your-dhara-instance",
 *         "DHARA_PAT": "dh_pat_xxxxxxxxxxxxxxxx"
 *       }
 *     }
 *   }
 * }
 *
 * The bridge forwards JSON-RPC to the instance's /api/mcp endpoint.
 */
import readline from "node:readline";

const URL_BASE = (process.env.DHARA_URL ?? "http://localhost:3000").replace(/\/$/, "");
const PAT = process.env.DHARA_PAT ?? "";

const rl = readline.createInterface({ input: process.stdin });

function write(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

async function callRemote(rpc) {
  const res = await fetch(`${URL_BASE}/api/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${PAT}` },
    body: JSON.stringify(rpc),
  });
  if (res.status === 202) return null;
  return res.json();
}

rl.on("line", async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let rpc;
  try {
    rpc = JSON.parse(trimmed);
  } catch {
    return;
  }
  try {
    const result = await callRemote(rpc);
    if (result) write(result);
  } catch (e) {
    write({
      jsonrpc: "2.0",
      id: rpc.id ?? null,
      error: { code: -32603, message: e instanceof Error ? e.message : String(e) },
    });
  }
});

process.on("SIGINT", () => process.exit(0));
