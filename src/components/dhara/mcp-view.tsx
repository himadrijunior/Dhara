"use client";

import { useEffect, useState } from "react";
import { api, track } from "@/lib/client-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Plug, Copy, TerminalSquare } from "lucide-react";

const TOOLS = [
  { name: "list_projects", desc: "List all projects", scope: "projects:read" },
  { name: "list_tables", desc: "List tables in a project", scope: "db:read" },
  { name: "describe_table", desc: "Columns, types, realtime flag", scope: "db:read" },
  { name: "select_rows", desc: "Query rows with filters", scope: "db:read" },
  { name: "insert_rows", desc: "Insert rows (auto-creates table)", scope: "db:write" },
  { name: "update_rows", desc: "Update rows by filter", scope: "db:write" },
  { name: "delete_rows", desc: "Delete rows by filter", scope: "db:write" },
  { name: "run_sql", desc: "Run raw SQL", scope: "sql:run" },
];

export default function McpView() {
  const [origin, setOrigin] = useState("");
  useEffect(() => {
    track("mcp.view");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOrigin(window.location.origin);
  }, []);

  const stdioConfig = JSON.stringify(
    {
      mcpServers: {
        "dhara-db": {
          command: "node",
          args: ["/path/to/dhara/mcp/server.mjs"],
          env: { DHARA_URL: origin || "https://your-instance", DHARA_PAT: "dh_pat_xxxxxxxx" },
        },
      },
    },
    null,
    2
  );

  const curlExample = `curl -X POST ${origin || "https://your-instance"}/api/mcp \\
  -H "Authorization: Bearer dh_pat_xxxxxxxx" \\
  -H "Content-Type: application/json" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`;

  return (
    <div className="stagger mx-auto w-full max-w-5xl space-y-5 p-4 sm:p-6 lg:p-8">
      <div>
        <h1 className="flex items-center gap-2.5 font-display text-2xl font-bold tracking-tight">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-brand-soft"><Plug className="h-4 w-4 text-brand" /></span> MCP Server
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Connect Claude, Cursor, or any MCP client directly to your Oracle data — Model Context
          Protocol over Streamable HTTP (+ stdio bridge script included).
        </p>
      </div>

      <div className="panel space-y-3 p-4">
        <p className="text-sm font-medium">Endpoint</p>
        <div className="flex gap-2 items-center">
          <code className="flex-1 overflow-x-auto whitespace-nowrap rounded-md border border-border bg-background/60 px-3 py-2 font-mono text-xs text-brand">
            POST {origin}/api/mcp
          </code>
          <Button size="sm" variant="outline" className="press h-8 border-border bg-secondary/50 hover:bg-accent/60" onClick={() => { navigator.clipboard.writeText(`${origin}/api/mcp`); toast.success("Copied"); }}>
            <Copy className="w-3 h-3" />
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Auth: <code className="text-foreground/90">Authorization: Bearer dh_pat_…</code> — create a token in{" "}
          <strong>Access Tokens</strong> (scopes apply per tool).
        </p>
      </div>

      <div className="panel overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-secondary/40">
            <tr className="text-left text-muted-foreground">
              <th className="px-3 py-2.5">Tool</th>
              <th className="px-3 py-2.5">Description</th>
              <th className="px-3 py-2.5">Required scope</th>
            </tr>
          </thead>
          <tbody>
            {TOOLS.map((t) => (
              <tr key={t.name} className="border-t border-border/60 transition-colors hover:bg-accent/30">
                <td className="px-3 py-2 font-mono text-brand">{t.name}</td>
                <td className="px-3 py-2 text-muted-foreground">{t.desc}</td>
                <td className="px-3 py-2"><Badge variant="outline" className="text-[10px] border-border text-muted-foreground">{t.scope}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="overflow-hidden rounded-xl border border-border bg-background/60">
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <TerminalSquare className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Claude Desktop / stdio config</span>
            <button className="press ml-auto text-muted-foreground transition-colors hover:text-foreground" onClick={() => { navigator.clipboard.writeText(stdioConfig); toast.success("Copied"); }} aria-label="Copy">
              <Copy className="w-3 h-3" />
            </button>
          </div>
          <pre className="overflow-x-auto p-3 font-mono text-[11px] text-foreground/80">{stdioConfig}</pre>
        </div>
        <div className="overflow-hidden rounded-xl border border-border bg-background/60">
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <Plug className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">HTTP test</span>
            <button className="press ml-auto text-muted-foreground transition-colors hover:text-foreground" onClick={() => { navigator.clipboard.writeText(curlExample); toast.success("Copied"); }} aria-label="Copy">
              <Copy className="w-3 h-3" />
            </button>
          </div>
          <pre className="overflow-x-auto p-3 font-mono text-[11px] text-foreground/80">{curlExample}</pre>
        </div>
      </div>
    </div>
  );
}
