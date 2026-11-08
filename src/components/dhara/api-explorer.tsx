"use client";

import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { api, track } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Play, Copy, RefreshCw, Globe, KeyRound } from "lucide-react";

interface TableMetaLite { NAME: string }
interface KeyRow { ID: string; KIND: string; PREFIX: string; CREATED_AT?: string; LAST_USED_AT?: string }

export default function ApiExplorer() {
  const store = useStore();
  const [tables, setTables] = useState<TableMetaLite[]>([]);
  const [table, setTable] = useState("");
  const [method, setMethod] = useState<"GET" | "POST" | "PATCH" | "DELETE">("GET");
  const [filters, setFilters] = useState<{ col: string; op: string; val: string }[]>([]);
  const [cols, setCols] = useState<{ name: string }[]>([]);
  const [body, setBody] = useState('{\n  "title": "Hello from Dhara",\n  "done": false\n}');
  const [limit, setLimit] = useState("50");
  const [response, setResponse] = useState<{ status: number; data: unknown; ms: number } | null>(null);
  const [keys, setKeys] = useState<KeyRow[]>([]);
  const [newKey, setNewKey] = useState<{ kind: string; key: string } | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    track("api.view");
    if (!store.activeProjectId) return;
    api<{ tables: TableMetaLite[] }>(`/api/projects/${store.activeProjectId}/tables`)
      .then((d) => setTables(d.tables ?? []))
      .catch(() => undefined);
    api<{ keys: KeyRow[] }>(`/api/projects/${store.activeProjectId}/keys`)
      .then((d) => setKeys(d.keys ?? []))
      .catch(() => undefined);
  }, [store.activeProjectId]);

  useEffect(() => {
    if (!table || !store.activeProjectId) return;
    api<{ table: { columns: { name: string }[] } }>(`/api/projects/${store.activeProjectId}/tables/${table}`)
      .then((d) => setCols(d.table?.columns ?? []))
      .catch(() => setCols([]));
  }, [table, store.activeProjectId]);

  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
  const apiUrl = `${baseUrl}/api/v1/${store.activeProjectId ?? "PROJECT"}${table ? `/${table}` : ""}`;

  function buildQuery(): string {
    const p = new URLSearchParams();
    for (const f of filters) if (f.col && f.op && f.val !== "") p.set(`${f.col}.${f.op}`, f.val);
    if (limit && method === "GET") p.set("limit", limit);
    return p.toString();
  }

  async function run() {
    if (!store.activeProjectId || !table) return toast.error("Pick a table first");
    setRunning(true);
    const start = Date.now();
    try {
      const qs = buildQuery();
      const url = `/api/v1/${store.activeProjectId}/${table}${qs ? `?${qs}` : ""}`;
      const headers: Record<string, string> = {};
      if (method !== "GET") headers["content-type"] = "application/json";
      const res = await fetch(url, {
        method,
        headers,
        body: method !== "GET" ? body : undefined,
      });
      const data = await res.json().catch(() => ({}));
      setResponse({ status: res.status, data, ms: Date.now() - start });
    } catch (e) {
      setResponse({ status: 0, data: { error: e instanceof Error ? e.message : "failed" }, ms: Date.now() - start });
    } finally {
      setRunning(false);
    }
  }

  const snippet = (lang: "curl" | "js" | "python") => {
    const qs = buildQuery();
    const url = `${apiUrl}${qs ? `?${qs}` : ""}`;
    if (lang === "curl") {
      return `curl "${url}" \\\n  -H "x-api-key: dh_pub_YOUR_PUBLISHABLE_KEY" \\\n  -H "Authorization: Bearer <user-jwt-optional>"`;
    }
    if (lang === "js") {
      return `const res = await fetch("${url}", {\n  headers: {\n    apikey: "dh_pub_YOUR_PUBLISHABLE_KEY",\n    Authorization: \`Bearer \${jwt}\`, // optional\n  },\n});\nconst { data } = await res.json();`;
    }
    return `import requests\n\nres = requests.get(\n    "${url}",\n    headers={"apikey": "dh_pub_YOUR_PUBLISHABLE_KEY"},\n)\nprint(res.json())`;
  };

  async function genKey(kind: "pub" | "sec") {
    if (!confirm(`Regenerate the ${kind === "pub" ? "publishable" : "secret (service_role)"} key? Old key stops working.`)) return;
    try {
      const d = await api<{ key: string }>(`/api/projects/${store.activeProjectId}/keys`, {
        method: "POST",
        body: JSON.stringify({ kind }),
      });
      setNewKey({ kind, key: d.key });
      toast.success(`${kind === "pub" ? "Publishable" : "Secret"} key generated — copy it now`);
      const k = await api<{ keys: KeyRow[] }>(`/api/projects/${store.activeProjectId}/keys`);
      setKeys(k.keys ?? []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  }

  return (
    <div className="stagger mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8">
      <div>
        <h1 className="flex items-center gap-2.5 font-display text-2xl font-bold tracking-tight">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-brand-soft"><Globe className="h-4 w-4 text-brand" /></span> API Explorer &amp; Keys
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Auto-generated REST API (PostgREST-style) — every table instantly gets a URL.
        </p>
      </div>

      {/* API keys */}
      <div className="panel p-4">
        <div className="flex items-center gap-2 mb-3">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-warning/10"><KeyRound className="h-3.5 w-3.5 text-warning" /></span>
          <span className="text-sm font-medium">Project API keys</span>
          <span className="text-[11px] text-muted-foreground">hashed at rest · shown once at creation</span>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="rounded-xl border border-border bg-background/60 p-3">
            <p className="mb-1 text-xs font-medium text-foreground">Publishable (anon)</p>
            <p className="mb-2 text-[11px] text-muted-foreground">Safe for browsers/mobile. RLS applies — no policy = denied.</p>
            <Button size="sm" variant="outline" className="press border-border bg-secondary/50 text-xs hover:bg-accent/60" onClick={() => genKey("pub")}>
              <RefreshCw className="w-3 h-3 mr-1" /> Generate
            </Button>
          </div>
          <div className="rounded-xl border border-danger/25 bg-background/60 p-3">
            <p className="mb-1 text-xs font-medium text-danger">Secret (service_role)</p>
            <p className="mb-2 text-[11px] text-muted-foreground">Bypasses RLS. Server-side only. Keep it in your pocket.</p>
            <Button size="sm" variant="outline" className="press border-danger/30 bg-secondary/50 text-xs text-danger hover:bg-danger/10" onClick={() => genKey("sec")}>
              <RefreshCw className="w-3 h-3 mr-1" /> Generate
            </Button>
          </div>
        </div>
        {newKey && (
          <div className="mt-3 rounded-xl border border-brand/30 bg-brand-soft p-3">
            <p className="mb-1 text-xs text-brand">{newKey.kind === "pub" ? "Publishable" : "Secret"} key — copy now, shown once:</p>
            <div className="flex gap-2">
              <code className="flex-1 overflow-x-auto whitespace-nowrap rounded-md border border-border bg-background/60 px-2 py-1.5 font-mono text-xs">{newKey.key}</code>
              <Button size="sm" variant="outline" className="press h-8 border-brand/30 text-brand hover:bg-brand-soft" onClick={() => { navigator.clipboard.writeText(newKey.key); toast.success("Copied"); }}>
                <Copy className="w-3 h-3" />
              </Button>
            </div>
          </div>
        )}
        {keys.length > 0 && (
          <p className="mt-2 font-mono text-[11px] text-muted-foreground">
            Active keys: {keys.map((k) => `${k.KIND} (${k.PREFIX}…)`).join(" · ")}
          </p>
        )}
      </div>

      {/* Explorer */}
      <div className="grid lg:grid-cols-2 gap-4">
        <div className="space-y-3">
          <div className="flex gap-2">
            <Select value={method} onValueChange={(v) => setMethod(v as typeof method)}>
              <SelectTrigger className="w-28 border-border bg-secondary/50"><SelectValue /></SelectTrigger>
              <SelectContent className="border-border bg-popover">
                {["GET", "POST", "PATCH", "DELETE"].map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={table} onValueChange={setTable}>
              <SelectTrigger className="flex-1 border-border bg-secondary/50"><SelectValue placeholder="Select table" /></SelectTrigger>
              <SelectContent className="border-border bg-popover">
                {tables.map((t) => <SelectItem key={t.NAME} value={t.NAME}>{t.NAME}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2 rounded-xl border border-border bg-secondary/40 p-3">
            <p className="text-xs font-medium text-muted-foreground">Filters</p>
            {filters.map((f, i) => (
              <div key={i} className="flex gap-1.5">
                <Select value={f.col} onValueChange={(v) => setFilters(filters.map((x, j) => (j === i ? { ...x, col: v } : x)))}>
                  <SelectTrigger className="h-9 flex-1 border-border bg-secondary/50 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent className="border-border bg-popover">
                    {cols.map((c) => <SelectItem key={c.name} value={c.name} className="text-xs">{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={f.op} onValueChange={(v) => setFilters(filters.map((x, j) => (j === i ? { ...x, op: v } : x)))}>
                  <SelectTrigger className="h-9 w-24 border-border bg-secondary/50 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent className="border-border bg-popover">
                    {["eq", "neq", "gt", "gte", "lt", "lte", "like", "in", "is", "contains"].map((o) => <SelectItem key={o} value={o} className="text-xs">{o}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Input value={f.val} onChange={(e) => setFilters(filters.map((x, j) => (j === i ? { ...x, val: e.target.value } : x)))} className="h-9 flex-1 border-border bg-secondary/50 text-xs" placeholder="value" />
                <button onClick={() => setFilters(filters.filter((_, j) => j !== i))} className="press px-1 text-muted-foreground transition-colors hover:text-danger" aria-label="Remove">✕</button>
              </div>
            ))}
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" className="press h-8 border-border bg-secondary/50 text-xs hover:bg-accent/60" onClick={() => setFilters([...filters, { col: cols[0]?.name ?? "", op: "eq", val: "" }])}>
                + filter
              </Button>
              {method === "GET" && (
                <div className="flex items-center gap-1.5 ml-auto">
                  <Label className="text-xs text-muted-foreground">limit</Label>
                  <Input value={limit} onChange={(e) => setLimit(e.target.value)} className="h-8 w-20 border-border bg-secondary/50 text-xs" />
                </div>
              )}
            </div>
          </div>

          {method !== "GET" && (
            <div>
              <Label className="text-xs">JSON body</Label>
              <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={6}
                className="w-full rounded-md border border-border bg-secondary/50 p-3 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-ring" />
            </div>
          )}

          <Button className="press h-10 w-full gap-2 bg-gradient-to-r from-[#14B8A6] to-[#0d9488] font-medium text-zinc-950 shadow-[0_0_16px_-4px_rgba(20,184,166,0.5)] hover:from-[#2DD4BF] hover:to-[#14B8A6]" onClick={run} disabled={running || !table}>
            <Play className="w-4 h-4" /> {running ? "Running…" : "Run request"}
          </Button>

          <div>
            <Label className="text-xs">Code snippets</Label>
            {(["curl", "js", "python"] as const).map((lang) => (
              <div key={lang} className="mt-1.5 overflow-hidden rounded-xl border border-border bg-background/60">
                <div className="flex items-center border-b border-border px-3 py-1.5">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{lang}</span>
                  <button className="press ml-auto text-muted-foreground transition-colors hover:text-foreground" onClick={() => { navigator.clipboard.writeText(snippet(lang)); toast.success("Copied"); }} aria-label="Copy snippet">
                    <Copy className="w-3 h-3" />
                  </button>
                </div>
                <pre className="overflow-x-auto whitespace-pre-wrap break-all p-3 font-mono text-[11px] text-foreground/80">{snippet(lang)}</pre>
              </div>
            ))}
          </div>
        </div>

        {/* Response */}
        <div className="panel flex flex-col overflow-hidden">
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <span className="text-xs font-medium text-foreground">Response</span>
            {response && (
              <>
                <Badge variant="outline" className={`text-[10px] tabular ${response.status < 300 ? "border-brand/25 bg-brand-soft text-brand" : "border-danger/25 bg-danger/10 text-danger"}`}>
                  {response.status || "ERR"}
                </Badge>
                <span className="text-[10px] text-muted-foreground tabular">{response.ms}ms</span>
              </>
            )}
          </div>
          <pre className="max-h-[480px] flex-1 overflow-auto whitespace-pre-wrap break-all p-4 font-mono text-xs text-foreground/80">
            {response ? JSON.stringify(response.data, null, 2) : "Run a request to see the response…"}
          </pre>
        </div>
      </div>
    </div>
  );
}
