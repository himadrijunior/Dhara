"use client";
import { DharaLoader } from "@/components/dhara/brand";

import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { api, track, fmtNum, getTokens } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { io } from "socket.io-client";
import {
  Plus, RefreshCw, Trash2, Pencil, Download, Radio, ChevronLeft, ChevronRight, Database,
  Braces, ShieldCheck, Webhook, Copy,
} from "lucide-react";

type Row = Record<string, unknown>;

interface TableDetail {
  ID: string;
  NAME: string;
  PHYSICAL: string;
  columns: { name: string; type: string; pk?: boolean; required?: boolean }[];
  realtime: boolean;
  realtimeEvents: string;
}

const OPS = ["eq", "neq", "gt", "gte", "lt", "lte", "like", "in", "is", "contains"];
const JSON_TYPES = ["json"];
const BOOL_TYPES = ["boolean"];

export default function GridView() {
  const store = useStore();
  const table = store.activeTable;
  const projectId = store.activeProjectId;

  const [detail, setDetail] = useState<TableDetail | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [page, setPage] = useState(0);
  const [limit] = useState(25);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<{ col: string; op: string; val: string }[]>([]);
  const [order, setOrder] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [liveFlash, setLiveFlash] = useState(false);

  // edit/insert dialogs
  const [editRow, setEditRow] = useState<Row | null>(null);
  const [insertOpen, setInsertOpen] = useState(false);
  const [insertRow, setInsertRow] = useState<Row>({});
  const [jsonView, setJsonView] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const query = useCallback(() => {
    const params = new URLSearchParams({ limit: String(limit), offset: String(page * limit) });
    if (order) params.set("order", order);
    for (const f of filters) if (f.col && f.op && f.val !== "") params.set(`${f.col}.${f.op}`, f.val);
    return params;
  }, [filters, order, page, limit]);

  const load = useCallback(async () => {
    if (!projectId || !table) return;
    setLoading(true);
    try {
      const d = await api<{ table: TableDetail }>(`/api/projects/${projectId}/tables/${table}`);
      setDetail(d.table);
      const r = await api<{ data: Row[]; count: number | null }>(
        `/api/projects/${projectId}/tables/${table}/rows?${query().toString()}`
      );
      setRows(r.data ?? []);
      setTotal(r.count);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [projectId, table, query]);

  useEffect(() => {
    track("table.view");
    void load();
  }, [load]);

  // sync live toggle from persisted table detail (per-table realtime switch)
  useEffect(() => {
    if (detail) setLive(!!detail.realtime);
  }, [detail]);

  // ---- Realtime subscription (per-table toggle) ----
  const reloadRef = useRef(load);
  reloadRef.current = load;
  useEffect(() => {
    if (!live || !projectId || !table) return;
    const { access } = getTokens();
    const socket = io("/?XTransformPort=3003", { path: "/", auth: { token: access } });
    socket.on("connect", () => {
      socket.emit("subscribe", { projectId, table });
    });
    socket.on("subscribed", () => toast.success(`Live — listening to "${table}"`));
    socket.on("change", () => {
      setLiveFlash(true);
      setTimeout(() => setLiveFlash(false), 800);
      reloadRef.current();
    });
    return () => {
      socket.disconnect();
    };
  }, [live, projectId, table]);

  async function toggleRealtime(enabled: boolean) {
    if (!projectId || !table) return;
    try {
      await api(`/api/projects/${projectId}/tables/${table}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "realtime", enabled }),
      });
      setDetail((d) => (d ? { ...d, realtime: enabled } : d));
      setLive(enabled);
      toast.success(enabled ? `Realtime ON for "${table}"` : `Realtime OFF`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  }

  function valueToInput(type: string, v: unknown): string {
    if (v === null || v === undefined) return "";
    if (JSON_TYPES.includes(type) || typeof v === "object") return JSON.stringify(v);
    if (BOOL_TYPES.includes(type)) return String(v);
    return String(v);
  }

  function inputToValue(type: string, raw: string): unknown {
    if (raw === "") return null;
    switch (type) {
      case "number":
      case "decimal":
        return Number(raw);
      case "boolean":
        return raw === "true" || raw === "1";
      case "json":
        try {
          return JSON.parse(raw);
        } catch {
          throw new Error(`Invalid JSON in column`);
        }
      default:
        return raw;
    }
  }

  async function saveEdit() {
    if (!projectId || !table || !editRow || !detail) return;
    const pk = detail.columns.find((c) => c.pk);
    if (!pk) return;
    setBusy(true);
    try {
      const updates: Row = {};
      for (const c of detail.columns) {
        if (c.pk || c.name === "created_at" || c.name === "updated_at") continue;
        const raw = (editRow as Row)[c.name];
        if (raw !== undefined) updates[c.name] = inputToValue(c.type, valueToInput(c.type, raw));
      }
      await api(`/api/projects/${projectId}/tables/${table}/rows`, {
        method: "PATCH",
        body: JSON.stringify({ updates, filters: [{ col: pk.name, op: "eq", val: String(editRow[pk.name]) }] }),
      });
      toast.success("Row updated");
      setEditRow(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  async function saveInsert() {
    if (!projectId || !table || !detail) return;
    setBusy(true);
    try {
      const row: Row = {};
      for (const c of detail.columns) {
        if (c.pk && c.type === "uuid") continue;
        if (c.name === "created_at" || c.name === "updated_at") continue;
        if (insertRow[c.name] !== undefined && insertRow[c.name] !== "") {
          row[c.name] = inputToValue(c.type, valueToInput(c.type, insertRow[c.name]));
        }
      }
      await api(`/api/projects/${projectId}/tables/${table}/rows`, {
        method: "POST",
        body: JSON.stringify(row),
      });
      toast.success("Row inserted");
      setInsertOpen(false);
      setInsertRow({});
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Insert failed");
    } finally {
      setBusy(false);
    }
  }

  async function deleteRow(row: Row) {
    if (!projectId || !table || !detail) return;
    const pk = detail.columns.find((c) => c.pk);
    if (!pk) return;
    if (!confirm("Delete this row?")) return;
    try {
      await api(`/api/projects/${projectId}/tables/${table}/rows`, {
        method: "DELETE",
        body: JSON.stringify({ filters: [{ col: pk.name, op: "eq", val: String(row[pk.name]) }] }),
      });
      toast.success("Row deleted");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  }

  function exportData(kind: "json" | "csv") {
    if (rows.length === 0 || !detail) return;
    let blob: Blob;
    if (kind === "json") {
      blob = new Blob([JSON.stringify(rows, null, 2)], { type: "application/json" });
    } else {
      const cols = detail.columns.map((c) => c.name);
      const esc = (s: unknown) => `"${String(s ?? "").replace(/"/g, '""')}"`;
      const csv = [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
      blob = new Blob([csv], { type: "text/csv" });
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${table}.${kind}`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  if (!table) return <p className="p-10 text-center text-sm text-muted-foreground">No table selected.</p>;

  const pages = total !== null ? Math.max(1, Math.ceil(total / limit)) : 1;

  return (
    <div className="mx-auto w-full max-w-7xl p-4 sm:p-6 lg:p-8">
      <Tabs defaultValue="data">
        <div className="mb-4 flex flex-wrap items-center gap-2 animate-fade-up">
          <TabsList className="h-10 border border-border bg-secondary/40">
            <TabsTrigger value="data" className="gap-1.5 text-xs data-[state=active]:bg-card data-[state=active]:text-foreground">
              <Database className="w-3.5 h-3.5" /> Data
            </TabsTrigger>
            <TabsTrigger value="structure" className="gap-1.5 text-xs data-[state=active]:bg-card data-[state=active]:text-foreground">
              <Braces className="w-3.5 h-3.5" /> Structure
            </TabsTrigger>
            <TabsTrigger value="policies" className="gap-1.5 text-xs data-[state=active]:bg-card data-[state=active]:text-foreground">
              <ShieldCheck className="w-3.5 h-3.5" /> Policies
            </TabsTrigger>
            <TabsTrigger value="webhooks" className="gap-1.5 text-xs data-[state=active]:bg-card data-[state=active]:text-foreground">
              <Webhook className="w-3.5 h-3.5" /> Webhooks
            </TabsTrigger>
          </TabsList>
          <div className="ml-auto flex items-center gap-2">
            <div
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                liveFlash ? "border-brand/40 bg-brand-soft text-brand" : "border-border text-muted-foreground"
              }`}
            >
              <Radio className="w-3 h-3" /> {live ? "LIVE" : "offline"}
            </div>
            <Button size="sm" variant="outline" className="press h-9 gap-1 border-border bg-secondary/50 hover:bg-accent/60" onClick={() => load()}>
              {loading ? <DharaLoader size={14} label="Refreshing" /> : <RefreshCw className="w-3.5 h-3.5" />} Refresh
            </Button>
          </div>
        </div>

        {/* ------------------------------ DATA TAB ------------------------------ */}
        <TabsContent value="data" className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" className="press h-9 gap-1 bg-gradient-to-r from-[#14B8A6] to-[#0d9488] font-medium text-zinc-950 shadow-[0_0_16px_-4px_rgba(20,184,166,0.5)] hover:from-[#2DD4BF] hover:to-[#14B8A6]" onClick={() => { setInsertRow({}); setInsertOpen(true); }}>
              <Plus className="w-3.5 h-3.5" /> Insert row
            </Button>
            <Button size="sm" variant="outline" className="press h-9 gap-1 border-border bg-secondary/50 hover:bg-accent/60" onClick={() => exportData("json")}>
              <Download className="w-3.5 h-3.5" /> JSON
            </Button>
            <Button size="sm" variant="outline" className="press h-9 gap-1 border-border bg-secondary/50 hover:bg-accent/60" onClick={() => exportData("csv")}>
              <Download className="w-3.5 h-3.5" /> CSV
            </Button>
            <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
              <span className="tabular">{total !== null ? `${fmtNum(total)} rows` : ""}</span>
              <Button variant="outline" size="sm" disabled={page === 0} className="press h-8 w-8 border-border bg-secondary/50 p-0 hover:bg-accent/60" onClick={() => setPage((p) => Math.max(0, p - 1))} aria-label="Previous page">
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <span className="tabular">{page + 1}/{pages}</span>
              <Button variant="outline" size="sm" disabled={page + 1 >= pages} className="press h-8 w-8 border-border bg-secondary/50 p-0 hover:bg-accent/60" onClick={() => setPage((p) => p + 1)} aria-label="Next page">
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap gap-2">
            {filters.map((f, i) => (
              <div key={i} className="flex items-center gap-1 rounded-md border border-border bg-secondary/40 p-1">
                <Select value={f.col} onValueChange={(v) => setFilters(filters.map((x, j) => (j === i ? { ...x, col: v } : x)))}>
                  <SelectTrigger className="h-8 w-32 border-0 bg-background/60 text-xs focus:ring-0"><SelectValue /></SelectTrigger>
                  <SelectContent className="border-border bg-popover">
                    {detail?.columns.map((c) => <SelectItem key={c.name} value={c.name} className="text-xs">{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={f.op} onValueChange={(v) => setFilters(filters.map((x, j) => (j === i ? { ...x, op: v } : x)))}>
                  <SelectTrigger className="h-8 w-24 border-0 bg-background/60 text-xs focus:ring-0"><SelectValue /></SelectTrigger>
                  <SelectContent className="border-border bg-popover">
                    {OPS.map((o) => <SelectItem key={o} value={o} className="text-xs">{o}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Input
                  value={f.val}
                  onChange={(e) => setFilters(filters.map((x, j) => (j === i ? { ...x, val: e.target.value } : x)))}
                  className="h-8 w-32 border-border bg-background/60 text-xs"
                  placeholder="value"
                />
                <button onClick={() => setFilters(filters.filter((_, j) => j !== i))} className="press px-1 text-muted-foreground transition-colors hover:text-danger" aria-label="Remove filter">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
            <Button size="sm" variant="outline" className="press h-9 gap-1 border-border bg-secondary/50 text-xs hover:bg-accent/60" onClick={() => setFilters([...filters, { col: detail?.columns[0]?.name ?? "", op: "eq", val: "" }])}>
              <Plus className="w-3 h-3" /> Filter
            </Button>
          </div>

          {/* Grid */}
          <div className="panel overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-secondary/40">
                  {detail?.columns.map((c) => (
                    <th
                      key={c.name}
                      className="cursor-pointer select-none whitespace-nowrap px-3 py-2.5 text-left font-mono text-[11px] font-medium tracking-wide text-muted-foreground transition-colors hover:text-brand"
                      onClick={() => setOrder(order === `${c.name}.asc` ? `${c.name}.desc` : `${c.name}.asc`)}
                      title="Click to sort"
                    >
                      {c.name}
                      {c.pk && <Badge className="ml-1.5 bg-brand-soft px-1 py-0 text-[8px] text-brand">PK</Badge>}
                      {order?.startsWith(c.name) && <span className="ml-1 text-brand">{order.endsWith("desc") ? "↓" : "↑"}</span>}
                    </th>
                  ))}
                  <th className="w-20 px-3 py-2.5 text-right text-[11px] uppercase tracking-wide text-muted-foreground">actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={12} className="px-3 py-10 text-center text-muted-foreground"><DharaLoader size={28} className="inline text-muted-foreground" label="Loading rows" /></td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={12} className="px-3 py-10 text-center text-muted-foreground">No rows — insert one or relax filters.</td></tr>
                ) : (
                  rows.map((r, i) => (
                    <tr key={i} className="border-b border-border/60 transition-colors hover:bg-accent/40">
                      {detail?.columns.map((c) => {
                        const v = r[c.name];
                        const isObj = v !== null && typeof v === "object";
                        return (
                          <td key={c.name} className="max-w-64 truncate px-3 py-2 text-foreground/80" title={String(v ?? "")}>
                            {v === null || v === undefined ? (
                              <span className="text-muted-foreground/60 italic">null</span>
                            ) : isObj ? (
                              <button className="font-mono text-brand hover:underline" onClick={() => setJsonView(JSON.stringify(v, null, 2))}>
                                {"{…}"}
                              </button>
                            ) : (
                              String(v)
                            )}
                          </td>
                        );
                      })}
                      <td className="px-2 py-1.5 text-right whitespace-nowrap">
                        <button className="press p-1.5 text-muted-foreground transition-colors hover:text-brand" onClick={() => setEditRow({ ...r })} aria-label="Edit row">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button className="press p-1.5 text-muted-foreground transition-colors hover:text-danger" onClick={() => deleteRow(r)} aria-label="Delete row">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </TabsContent>

        {/* --------------------------- STRUCTURE TAB --------------------------- */}
        <TabsContent value="structure">
          <StructureTab detail={detail} onChanged={load} />
        </TabsContent>

        {/* ---------------------------- POLICIES TAB ---------------------------- */}
        <TabsContent value="policies">
          <PoliciesTab table={table} />
        </TabsContent>

        {/* ---------------------------- WEBHOOKS TAB ---------------------------- */}
        <TabsContent value="webhooks">
          <WebhooksTab table={table} />
        </TabsContent>
      </Tabs>

      {/* Edit dialog */}
      <Dialog open={!!editRow} onOpenChange={(v) => !v && setEditRow(null)}>
        <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto border-border bg-popover">
          <DialogHeader><DialogTitle>Edit row</DialogTitle></DialogHeader>
          {editRow && detail && (
            <div className="space-y-3">
              {detail.columns.filter((c) => !c.pk && c.name !== "created_at" && c.name !== "updated_at").map((c) => (
                <div key={c.name}>
                  <Label className="text-xs">{c.name} <span className="text-muted-foreground">({c.type})</span></Label>
                  {BOOL_TYPES.includes(c.type) ? (
                    <Select
                      value={String((editRow as Row)[c.name] ?? "null")}
                      onValueChange={(v) => setEditRow({ ...editRow, [c.name]: v })}
                    >
                      <SelectTrigger className="h-10 border-border bg-secondary/50 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent className="border-border bg-popover">
                        <SelectItem value="true">true</SelectItem>
                        <SelectItem value="false">false</SelectItem>
                        <SelectItem value="null">null</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : JSON_TYPES.includes(c.type) ? (
                    <textarea
                      rows={3}
                      value={valueToInput(c.type, (editRow as Row)[c.name])}
                      onChange={(e) => setEditRow({ ...editRow, [c.name]: e.target.value })}
                      className="w-full rounded-md border border-border bg-secondary/50 p-2 font-mono text-xs"
                    />
                  ) : (
                    <Input
                      value={valueToInput(c.type, (editRow as Row)[c.name])}
                      onChange={(e) => setEditRow({ ...editRow, [c.name]: e.target.value })}
                      className="h-10 border-border bg-secondary/50 text-sm"
                    />
                  )}
                </div>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button onClick={saveEdit} disabled={busy} className="press bg-gradient-to-r from-[#14B8A6] to-[#0d9488] font-medium text-zinc-950 shadow-[0_0_16px_-4px_rgba(20,184,166,0.5)] hover:from-[#2DD4BF] hover:to-[#14B8A6]">
              {busy ? <DharaLoader size={16} className="mr-1.5 inline text-foreground" label="Saving" /> : null}{"Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Insert dialog */}
      <Dialog open={insertOpen} onOpenChange={setInsertOpen}>
        <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto border-border bg-popover">
          <DialogHeader><DialogTitle>Insert row</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {detail?.columns.filter((c) => (!c.pk || c.type !== "uuid") && c.name !== "created_at" && c.name !== "updated_at").map((c) => (
              <div key={c.name}>
                <Label className="text-xs">
                  {c.name} <span className="text-muted-foreground">({c.type})</span>
                  {c.required && <span className="text-brand"> *</span>}
                </Label>
                {BOOL_TYPES.includes(c.type) ? (
                  <Select value={String((insertRow as Row)[c.name] ?? "null")} onValueChange={(v) => setInsertRow({ ...insertRow, [c.name]: v })}>
                    <SelectTrigger className="h-10 border-border bg-secondary/50 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent className="border-border bg-popover">
                      <SelectItem value="true">true</SelectItem>
                      <SelectItem value="false">false</SelectItem>
                      <SelectItem value="null">null</SelectItem>
                    </SelectContent>
                  </Select>
                ) : JSON_TYPES.includes(c.type) ? (
                  <textarea
                    rows={3}
                    value={valueToInput(c.type, (insertRow as Row)[c.name])}
                    onChange={(e) => setInsertRow({ ...insertRow, [c.name]: e.target.value })}
                    className="w-full rounded-md border border-border bg-secondary/50 p-2 font-mono text-xs"
                    placeholder='{"key": "value"}'
                  />
                ) : (
                  <Input
                    value={valueToInput(c.type, (insertRow as Row)[c.name])}
                    onChange={(e) => setInsertRow({ ...insertRow, [c.name]: e.target.value })}
                    className="h-10 border-border bg-secondary/50 text-sm"
                  />
                )}
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button onClick={saveInsert} disabled={busy} className="press bg-gradient-to-r from-[#14B8A6] to-[#0d9488] font-medium text-zinc-950 shadow-[0_0_16px_-4px_rgba(20,184,166,0.5)] hover:from-[#2DD4BF] hover:to-[#14B8A6]">
              {busy ? <DharaLoader size={16} className="mr-1.5 inline text-foreground" label="Inserting" /> : null}{"Insert"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* JSON viewer */}
      <Dialog open={!!jsonView} onOpenChange={(v) => !v && setJsonView(null)}>
        <DialogContent className="max-w-lg border-border bg-popover">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              JSON <Button size="sm" variant="outline" className="press h-7 gap-1 border-border bg-secondary/50 hover:bg-accent/60" onClick={() => { navigator.clipboard.writeText(jsonView ?? ""); toast.success("Copied"); }}>
                <Copy className="w-3 h-3" /> Copy
              </Button>
            </DialogTitle>
          </DialogHeader>
          <pre className="max-h-96 overflow-auto rounded-lg border border-border bg-background/60 p-3 font-mono text-xs text-foreground">{jsonView}</pre>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ------------------------------ STRUCTURE TAB ------------------------------ */

function StructureTab({ detail, onChanged }: { detail: TableDetail | null; onChanged: () => void }) {
  const store = useStore();
  const [col, setCol] = useState({ name: "", type: "text" });
  const [syncing, setSyncing] = useState(false);
  if (!detail) return null;

  return (
    <div className="space-y-4">
      <div className="panel overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border bg-secondary/40 text-left">
              <th className="px-3 py-2.5 text-muted-foreground">Column</th>
              <th className="px-3 py-2.5 text-muted-foreground">Type</th>
              <th className="px-3 py-2.5 text-muted-foreground">Flags</th>
              <th className="px-3 py-2.5 w-16" />
            </tr>
          </thead>
          <tbody>
            {detail.columns.map((c) => (
              <tr key={c.name} className="border-b border-border/60 transition-colors hover:bg-accent/30">
                <td className="px-3 py-2 font-mono text-foreground/90">{c.name}</td>
                <td className="px-3 py-2"><Badge variant="outline" className="border-brand/25 bg-brand-soft text-[10px] text-brand">{c.type}</Badge></td>
                <td className="px-3 py-2 text-muted-foreground">
                  {[c.pk && "primary key", c.required && "required"].filter(Boolean).join(" · ") || "—"}
                </td>
                <td className="px-3 py-2 text-right">
                  {!c.pk && (
                    <button
                      className="press p-1.5 text-muted-foreground transition-colors hover:text-danger"
                      aria-label={`Drop ${c.name}`}
                      onClick={async () => {
                        if (!confirm(`Drop column "${c.name}"?`)) return;
                        try {
                          await api(`/api/projects/${store.activeProjectId}/tables/${detail.NAME}`, {
                            method: "PATCH",
                            body: JSON.stringify({ action: "dropColumn", column: { name: c.name } }),
                          });
                          toast.success("Column dropped");
                          onChanged();
                        } catch (e) {
                          toast.error(e instanceof Error ? e.message : "Failed");
                        }
                      }}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div>
          <Label className="text-xs">New column</Label>
          <Input value={col.name} onChange={(e) => setCol({ ...col, name: e.target.value })} placeholder="column_name" className="h-10 w-44 border-border bg-secondary/50 text-sm" />
        </div>
        <div>
          <Label className="text-xs">Type</Label>
          <Select value={col.type} onValueChange={(v) => setCol({ ...col, type: v })}>
            <SelectTrigger className="h-10 w-36 border-border bg-secondary/50 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent className="border-border bg-popover">
              {["uuid", "text", "longtext", "number", "decimal", "boolean", "json", "timestamp", "date"].map((t) => (
                <SelectItem key={t} value={t}>{t}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          className="press h-10 bg-gradient-to-r from-[#14B8A6] to-[#0d9488] font-medium text-zinc-950 shadow-[0_0_16px_-4px_rgba(20,184,166,0.5)] hover:from-[#2DD4BF] hover:to-[#14B8A6]"
          onClick={async () => {
            try {
              await api(`/api/projects/${store.activeProjectId}/tables/${detail.NAME}`, {
                method: "PATCH",
                body: JSON.stringify({ action: "addColumn", column: { name: col.name.trim(), type: col.type } }),
              });
              toast.success("Column added");
              setCol({ name: "", type: "text" });
              onChanged();
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Failed");
            }
          }}
        >
          Add column
        </Button>
        <Button
          variant="outline"
          className="press h-10 gap-1.5 border-border bg-secondary/50 hover:bg-accent/60"
          disabled={syncing}
          onClick={async () => {
            setSyncing(true);
            try {
              await api(`/api/projects/${store.activeProjectId}/tables/${detail.NAME}`, {
                method: "PATCH",
                body: JSON.stringify({ action: "sync" }),
              });
              toast.success("Schema synced from Oracle catalog");
              onChanged();
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Failed");
            } finally {
              setSyncing(false);
            }
          }}
        >
          {syncing ? <DharaLoader size={14} label="Syncing" /> : <RefreshCw className="w-3.5 h-3.5" />} Sync schema
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------ POLICIES TAB ------------------------------- */

interface Policy {
  ID: string;
  NAME: string;
  ACTION: string;
  ROLES: string;
  USING_EXPR: string | null;
  WITH_CHECK: string | null;
  ENABLED: number;
}

const TEMPLATES = [
  { name: "Public read", action: "select", roles: ["anon", "authenticated"], using: "true" },
  { name: "Authenticated read", action: "select", roles: ["authenticated"], using: "true" },
  { name: "Users read own rows", action: "all", roles: ["authenticated"], using: "user_id = auth.uid()" },
  { name: "Users manage own rows", action: "all", roles: ["authenticated"], using: "user_id = auth.uid()" },
];

function PoliciesTab({ table }: { table: string }) {
  const store = useStore();
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", action: "all", roles: "anon,authenticated", using: "true", withCheck: "" });

  const load = useCallback(async () => {
    try {
      const d = await api<{ policies: Policy[] }>(`/api/projects/${store.activeProjectId}/policies?table=${table}`);
      setPolicies(d.policies ?? []);
    } catch {
      setPolicies([]);
    }
  }, [store.activeProjectId, table]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function create() {
    try {
      await api(`/api/projects/${store.activeProjectId}/policies`, {
        method: "POST",
        body: JSON.stringify({
          table,
          name: form.name,
          action: form.action,
          roles: form.roles.split(",").map((r) => r.trim()).filter(Boolean),
          using: form.using,
          withCheck: form.withCheck || undefined,
        }),
      });
      toast.success("Policy created");
      setOpen(false);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" className="press h-9 bg-gradient-to-r from-[#14B8A6] to-[#0d9488] gap-1 font-medium text-zinc-950 shadow-[0_0_16px_-4px_rgba(20,184,166,0.5)] hover:from-[#2DD4BF] hover:to-[#14B8A6]" onClick={() => setOpen(true)}>
          <Plus className="w-3.5 h-3.5" /> New policy
        </Button>
        {TEMPLATES.map((t) => (
          <Button
            key={t.name}
            size="sm"
            variant="outline"
            className="press h-9 border-border bg-secondary/50 text-xs hover:bg-accent/60"
            onClick={async () => {
              try {
                await api(`/api/projects/${store.activeProjectId}/policies`, {
                  method: "POST",
                  body: JSON.stringify({ table, ...t, roles: t.roles }),
                });
                toast.success(`Template applied: ${t.name}`);
                await load();
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Failed");
              }
            }}
          >
            {t.name}
          </Button>
        ))}
      </div>

      <div className="panel overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border bg-secondary/40 text-left text-muted-foreground">
              <th className="px-3 py-2.5">Name</th>
              <th className="px-3 py-2.5">Action</th>
              <th className="px-3 py-2.5">Roles</th>
              <th className="px-3 py-2.5">USING</th>
              <th className="px-3 py-2.5 w-12" />
            </tr>
          </thead>
          <tbody>
            {policies.length === 0 ? (
              <tr><td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">
                No policies — the public API denies all access for anon/authenticated roles (secure by default).
              </td></tr>
            ) : (
              policies.map((p) => (
                <tr key={p.ID} className="border-b border-border/60 transition-colors hover:bg-accent/30">
                  <td className="px-3 py-2 text-foreground/90">{p.NAME}</td>
                  <td className="px-3 py-2"><Badge variant="outline" className="border-border text-[10px] text-muted-foreground">{p.ACTION}</Badge></td>
                  <td className="px-3 py-2 text-muted-foreground">{p.ROLES}</td>
                  <td className="max-w-56 truncate px-3 py-2 font-mono text-brand" title={p.USING_EXPR ?? ""}>{p.USING_EXPR}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      className="press p-1.5 text-muted-foreground transition-colors hover:text-danger"
                      aria-label="Delete policy"
                      onClick={async () => {
                        if (!confirm("Delete this policy?")) return;
                        await api(`/api/projects/${store.activeProjectId}/policies?id=${p.ID}`, { method: "DELETE" });
                        toast.success("Policy deleted");
                        await load();
                      }}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md border-border bg-popover">
          <DialogHeader>
            <DialogTitle>New RLS policy — {table}</DialogTitle>
            <DialogDescription>
              Supabase-style expressions: <code className="text-brand">true</code>,{" "}
              <code className="text-brand">user_id = auth.uid()</code>, <code className="text-brand">status is null</code>, AND/OR supported.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div><Label className="text-xs">Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="h-10 border-border bg-secondary/50" placeholder="Users can read own rows" /></div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Action</Label>
                <Select value={form.action} onValueChange={(v) => setForm({ ...form, action: v })}>
                  <SelectTrigger className="h-10 border-border bg-secondary/50"><SelectValue /></SelectTrigger>
                  <SelectContent className="border-border bg-popover">
                    {["all", "select", "insert", "update", "delete"].map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Roles (comma sep)</Label>
                <Input value={form.roles} onChange={(e) => setForm({ ...form, roles: e.target.value })} className="h-10 border-border bg-secondary/50" />
              </div>
            </div>
            <div>
              <Label className="text-xs">USING expression</Label>
              <Input value={form.using} onChange={(e) => setForm({ ...form, using: e.target.value })} className="h-10 border-border bg-secondary/50 font-mono text-sm" />
            </div>
            <div>
              <Label className="text-xs">WITH CHECK (optional, for insert/update)</Label>
              <Input value={form.withCheck} onChange={(e) => setForm({ ...form, withCheck: e.target.value })} className="h-10 border-border bg-secondary/50 font-mono text-sm" />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={create} className="press bg-gradient-to-r from-[#14B8A6] to-[#0d9488] font-medium text-zinc-950 shadow-[0_0_16px_-4px_rgba(20,184,166,0.5)] hover:from-[#2DD4BF] hover:to-[#14B8A6]">Create policy</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ------------------------------ WEBHOOKS TAB ------------------------------- */

interface Hook {
  ID: string;
  TABLE_NAME: string;
  URL: string;
  SECRET: string;
  EVENTS: string;
  ENABLED: number;
}

function WebhooksTab({ table }: { table: string }) {
  const store = useStore();
  const [hooks, setHooks] = useState<Hook[]>([]);
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string>("insert,update,delete");
  const [logs, setLogs] = useState<{ ID: string; EVENT: string; STATUS: number; OK: number; ERROR: string | null; AT?: string }[]>([]);

  const load = useCallback(async () => {
    try {
      const all = await api<{ webhooks: Hook[] }>(`/api/projects/${store.activeProjectId}/webhooks`);
      setHooks((all.webhooks ?? []).filter((h) => h.TABLE_NAME === table));
      const l = await api<{ logs: typeof logs }>(`/api/projects/${store.activeProjectId}/webhooks?logs=1`);
      setLogs((l.logs ?? []).slice(0, 15));
    } catch {
      /* ignore */
    }
  }, [store.activeProjectId, table]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button size="sm" className="press h-9 bg-gradient-to-r from-[#14B8A6] to-[#0d9488] gap-1 font-medium text-zinc-950 shadow-[0_0_16px_-4px_rgba(20,184,166,0.5)] hover:from-[#2DD4BF] hover:to-[#14B8A6]" onClick={() => setOpen(true)}>
          <Plus className="w-3.5 h-3.5" /> New webhook
        </Button>
        <span className="text-xs text-muted-foreground">POST with HMAC-SHA256 signature (X-Dhara-Signature) on every change.</span>
      </div>

      <div className="panel overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border bg-secondary/40 text-left text-muted-foreground">
              <th className="px-3 py-2.5">URL</th>
              <th className="px-3 py-2.5">Events</th>
              <th className="px-3 py-2.5">Status</th>
              <th className="px-3 py-2.5 w-12" />
            </tr>
          </thead>
          <tbody>
            {hooks.length === 0 ? (
              <tr><td colSpan={4} className="px-3 py-8 text-center text-muted-foreground">No webhooks for this table yet.</td></tr>
            ) : (
              hooks.map((h) => (
                <tr key={h.ID} className="border-b border-border/60 transition-colors hover:bg-accent/30">
                  <td className="max-w-72 truncate px-3 py-2 font-mono text-foreground/80">{h.URL}</td>
                  <td className="px-3 py-2 text-muted-foreground">{h.EVENTS}</td>
                  <td className="px-3 py-2">
                    <Switch
                      checked={Number(h.ENABLED) === 1}
                      onCheckedChange={async (v) => {
                        await api(`/api/projects/${store.activeProjectId}/webhooks`, {
                          method: "PATCH",
                          body: JSON.stringify({ id: h.ID, enabled: v }),
                        });
                        await load();
                      }}
                    />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      className="press p-1.5 text-muted-foreground transition-colors hover:text-danger"
                      aria-label="Delete webhook"
                      onClick={async () => {
                        if (!confirm("Delete this webhook?")) return;
                        await api(`/api/projects/${store.activeProjectId}/webhooks?id=${h.ID}`, { method: "DELETE" });
                        toast.success("Webhook deleted");
                        await load();
                      }}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold text-foreground">Recent deliveries</p>
        <div className="space-y-1">
          {logs.length === 0 ? (
            <p className="text-xs text-muted-foreground/70">No deliveries yet.</p>
          ) : (
            logs.map((l) => (
              <div key={l.ID} className="flex items-center gap-2 rounded-md border border-border bg-secondary/40 px-2.5 py-1.5 text-[11px]">
                <Badge variant="outline" className={`text-[9px] tabular ${Number(l.OK) === 1 ? "border-brand/25 bg-brand-soft text-brand" : "border-danger/25 bg-danger/10 text-danger"}`}>
                  {Number(l.OK) === 1 ? "OK" : "FAIL"} {l.STATUS}
                </Badge>
                <span className="text-muted-foreground">{l.EVENT}</span>
                <span className="flex-1 truncate text-muted-foreground/60">{l.ERROR ?? ""}</span>
                <span className="shrink-0 text-muted-foreground/70 tabular">{l.AT ? new Date(l.AT).toLocaleTimeString() : ""}</span>
              </div>
            ))
          )}
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md border-border bg-popover">
          <DialogHeader>
            <DialogTitle>New webhook — {table}</DialogTitle>
            <DialogDescription>A signing secret is generated automatically.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div><Label className="text-xs">Endpoint URL</Label><Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://hooks.slack.com/…" className="h-10 border-border bg-secondary/50" /></div>
            <div><Label className="text-xs">Events</Label><Input value={events} onChange={(e) => setEvents(e.target.value)} className="h-10 border-border bg-secondary/50" /></div>
          </div>
          <DialogFooter>
            <Button
              className="press bg-gradient-to-r from-[#14B8A6] to-[#0d9488] font-medium text-zinc-950 shadow-[0_0_16px_-4px_rgba(20,184,166,0.5)] hover:from-[#2DD4BF] hover:to-[#14B8A6]"
              onClick={async () => {
                try {
                  const d = await api<{ secret?: string }>(`/api/projects/${store.activeProjectId}/webhooks`, {
                    method: "POST",
                    body: JSON.stringify({ table, url, events: events.split(",").map((s) => s.trim()) }),
                  });
                  if (d.secret) {
                    await navigator.clipboard.writeText(d.secret).catch(() => undefined);
                    toast.success("Webhook created — signing secret copied to clipboard");
                  }
                  setOpen(false);
                  setUrl("");
                  await load();
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Failed");
                }
              }}
            >
              Create webhook
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
