"use client";

import { useCallback, useEffect, useState } from "react";
import { useStore, TableMeta } from "@/lib/store";
import { api, track, fmtNum } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Plus, RefreshCw, Trash2, Table2, FileJson, Search, ArrowRight, Braces, Radio } from "lucide-react";

const COL_TYPES = ["uuid", "text", "longtext", "number", "decimal", "boolean", "json", "timestamp", "date"] as const;
type ColType = (typeof COL_TYPES)[number];

interface ColumnDraft {
  name: string;
  type: ColType;
  pk: boolean;
  required: boolean;
  unique: boolean;
  defaultValue: string;
}

const blank: ColumnDraft = { name: "", type: "text", pk: false, required: false, unique: false, defaultValue: "" };

export default function TablesView() {
  const store = useStore();
  const [tables, setTables] = useState<(TableMeta & { rowCount?: number | null })[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [jsonOpen, setJsonOpen] = useState(false);
  const [tableName, setTableName] = useState("");
  const [cols, setCols] = useState<ColumnDraft[]>([{ ...blank }, { name: "", type: "text", pk: false, required: false, unique: false, defaultValue: "" }]);
  const [jsonName, setJsonName] = useState("");
  const [jsonBody, setJsonBody] = useState("");
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!store.activeProjectId) return;
    setLoading(true);
    try {
      const d = await api<{ tables: (TableMeta & { rowCount?: number | null })[] }>(
        `/api/projects/${store.activeProjectId}/tables?counts=1`
      );
      setTables(d.tables ?? []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load tables");
    } finally {
      setLoading(false);
    }
  }, [store.activeProjectId]);

  useEffect(() => {
    track("tables.view");
    void load();
  }, [load]);

  function previewInferred(): string {
    try {
      const parsed = JSON.parse(jsonBody);
      const arr = Array.isArray(parsed) ? parsed.slice(0, 50) : [parsed];
      const keys = new Map<string, string>();
      for (const item of arr) {
        if (typeof item !== "object" || item === null) continue;
        for (const [k, v] of Object.entries(item as Record<string, unknown>)) {
          if (["id", "created_at", "updated_at"].includes(k.toLowerCase())) continue;
          if (!keys.has(k)) {
            const t =
              typeof v === "boolean" ? "boolean"
              : typeof v === "number" ? (Number.isInteger(v) ? "number" : "decimal")
              : typeof v === "string" ? (/^\d{4}-\d{2}-\d{2}T?\d{0,2}:?\d{0,2}/.test(v) ? "timestamp" : "text")
              : "json";
            keys.set(k, t);
          }
        }
      }
      return [...keys.entries()].map(([k, t]) => `${k}: ${t}`).join("\n") || "No columns detected";
    } catch {
      return "Invalid JSON";
    }
  }

  async function createTable() {
    if (!store.activeProjectId) return;
    const validCols = cols
      .filter((c) => c.name.trim())
      .map((c) => ({
        name: c.name.trim(),
        type: c.type,
        pk: c.pk,
        required: c.required || c.pk,
        unique: c.unique,
        defaultValue: c.defaultValue || null,
      }));
    if (!tableName.trim()) return toast.error("Table name required");
    try {
      await api(`/api/projects/${store.activeProjectId}/tables`, {
        method: "POST",
        body: JSON.stringify({ name: tableName.trim(), columns: validCols }),
      });
      toast.success(`Table "${tableName}" created`);
      setCreateOpen(false);
      setTableName("");
      setCols([{ ...blank }, { ...blank }]);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Create failed");
    }
  }

  async function createFromJson() {
    if (!store.activeProjectId) return;
    try {
      const parsed = JSON.parse(jsonBody);
      await api(`/api/projects/${store.activeProjectId}/tables`, {
        method: "POST",
        body: JSON.stringify({ name: jsonName.trim(), json: parsed }),
      });
      toast.success(`Table "${jsonName}" auto-created from JSON 🎉`);
      setJsonOpen(false);
      setJsonName("");
      setJsonBody("");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed (invalid JSON?)");
    }
  }

  async function dropTable(name: string) {
    setDropTarget(null);
    try {
      await api(`/api/projects/${store.activeProjectId}/tables/${name}`, { method: "DELETE" });
      toast.success(`Table "${name}" dropped`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Drop failed");
    }
  }

  async function syncAll() {
    try {
      for (const t of tables) {
        await api(`/api/projects/${store.activeProjectId}/tables/${t.NAME}`, {
          method: "PATCH",
          body: JSON.stringify({ action: "sync" }),
        });
      }
      toast.success("Schemas synced from Oracle catalog");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sync failed");
    }
  }

  const filtered = tables.filter((t) => t.NAME.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="mx-auto w-full max-w-7xl p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-center gap-3 animate-fade-up">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Table Editor</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {tables.length} table{tables.length === 1 ? "" : "s"} · auto table creation from JSON supported
          </p>
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Filter tables"
              className="h-9 w-44 bg-card pl-8 sm:w-56"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-1.5 border-border bg-card shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] hover:bg-accent"
            onClick={syncAll}
          >
            <RefreshCw className="h-3.5 w-3.5" /> Sync
          </Button>
          <Dialog open={jsonOpen} onOpenChange={setJsonOpen}>
            <DialogTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-9 gap-1.5 border-brand/40 bg-brand-soft text-brand hover:bg-brand/20"
              >
                <FileJson className="h-3.5 w-3.5" /> Paste JSON
              </Button>
            </DialogTrigger>
            <DialogContent className="panel max-w-lg">
              <DialogHeader>
                <DialogTitle className="font-display flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-soft">
                    <Braces className="h-4 w-4 text-brand" />
                  </span>
                  Auto table creation from JSON
                </DialogTitle>
                <DialogDescription>
                  Paste a JSON object or array — Dhara infers columns and creates the table (Firebase-style).
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label className="text-xs font-medium text-muted-foreground">Table name</Label>
                  <Input value={jsonName} onChange={(e) => setJsonName(e.target.value)} placeholder="tasks" className="h-10 font-mono" />
                </div>
                <div>
                  <Label className="text-xs font-medium text-muted-foreground">JSON</Label>
                  <textarea
                    value={jsonBody}
                    onChange={(e) => setJsonBody(e.target.value)}
                    rows={8}
                    placeholder='{"title": "Buy milk", "done": false, "priority": 2}'
                    className="w-full rounded-xl border border-border bg-secondary/50 p-3 font-mono text-xs text-foreground placeholder:text-muted-foreground/50 focus:border-brand/50 focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
                {jsonBody && (
                  <pre className="max-h-24 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-secondary/50 p-2.5 font-mono text-[10px] text-muted-foreground animate-fade-in">
                    {previewInferred()}
                  </pre>
                )}
              </div>
              <DialogFooter>
                <Button
                  onClick={createFromJson}
                  className="bg-gradient-to-r from-[#14B8A6] to-[#0d9488] font-medium text-zinc-950 hover:from-[#2DD4BF] hover:to-[#14B8A6]"
                >
                  Create table
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button
                size="sm"
                className="h-9 gap-1.5 bg-gradient-to-r from-[#14B8A6] to-[#0d9488] font-medium text-zinc-950 shadow-[0_0_16px_-4px_rgba(20,184,166,0.5)] hover:from-[#2DD4BF] hover:to-[#14B8A6]"
              >
                <Plus className="h-3.5 w-3.5" /> New table
              </Button>
            </DialogTrigger>
            <DialogContent className="panel max-h-[85vh] max-w-2xl overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="font-display">Create table</DialogTitle>
                <DialogDescription>
                  Columns are created on your Oracle Autonomous AI DB. id (uuid PK), created_at and updated_at
                  are added automatically.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label className="text-xs font-medium text-muted-foreground">Table name</Label>
                  <Input value={tableName} onChange={(e) => setTableName(e.target.value)} placeholder="tasks" className="h-10 font-mono" />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-medium text-muted-foreground">Columns</Label>
                  {cols.map((c, i) => (
                    <div key={i} className="grid grid-cols-12 items-center gap-2">
                      <Input
                        value={c.name}
                        onChange={(e) => setCols(cols.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                        placeholder="column_name"
                        className="col-span-4 h-9 bg-secondary/50 font-mono text-xs"
                      />
                      <Select value={c.type} onValueChange={(v) => setCols(cols.map((x, j) => (j === i ? { ...x, type: v as ColType } : x)))}>
                        <SelectTrigger className="col-span-3 h-9 bg-secondary/50 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="border-border bg-popover">
                          {COL_TYPES.map((t) => (
                            <SelectItem key={t} value={t} className="font-mono text-xs">{t}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <label className="col-span-2 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                        <Checkbox
                          checked={c.pk}
                          onCheckedChange={(v) => setCols(cols.map((x, j) => (j === i ? { ...x, pk: !!v } : x)))}
                          className="border-muted-foreground data-[state=checked]:border-brand data-[state=checked]:bg-brand"
                        />
                        PK
                      </label>
                      <label className="col-span-2 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                        <Checkbox
                          checked={c.required}
                          onCheckedChange={(v) => setCols(cols.map((x, j) => (j === i ? { ...x, required: !!v } : x)))}
                          className="border-muted-foreground data-[state=checked]:border-brand data-[state=checked]:bg-brand"
                        />
                        req
                      </label>
                      <button
                        onClick={() => setCols(cols.filter((_, j) => j !== i))}
                        className="col-span-1 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-danger/10 hover:text-danger"
                        aria-label="Remove column"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCols([...cols, { ...blank }])}
                    className="border-border bg-secondary/40 text-xs hover:bg-accent"
                  >
                    <Plus className="mr-1 h-3 w-3" /> Add column
                  </Button>
                </div>
              </div>
              <DialogFooter>
                <Button
                  onClick={createTable}
                  className="bg-gradient-to-r from-[#14B8A6] to-[#0d9488] font-medium text-zinc-950 hover:from-[#2DD4BF] hover:to-[#14B8A6]"
                >
                  Create table
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="shimmer h-32 rounded-xl border border-border" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border border-dashed border-border bg-card/40 p-14 text-center animate-fade-in">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-secondary/40">
            <Table2 className="h-6 w-6 text-muted-foreground" />
          </div>
          <p className="mb-1 font-medium">No tables yet</p>
          <p className="mb-5 text-sm text-muted-foreground">
            Create one with the visual editor or paste JSON.
          </p>
          <Button
            size="sm"
            className="gap-1.5 bg-gradient-to-r from-[#14B8A6] to-[#0d9488] font-medium text-zinc-950 hover:from-[#2DD4BF] hover:to-[#14B8A6]"
            onClick={() => setCreateOpen(true)}
          >
            <Plus className="h-4 w-4" /> New table
          </Button>
        </div>
      ) : (
        <div className="stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((t) => (
            <div
              key={t.ID}
              className="lift group relative overflow-hidden rounded-xl border border-border bg-card p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
            >
              <div className="mb-2 flex items-center gap-2">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-soft">
                  <Table2 className="h-3.5 w-3.5 text-brand" />
                </span>
                <button
                  className="truncate text-left font-mono text-sm font-semibold hover:text-brand hover:underline"
                  onClick={() => { store.navigate("table", t.NAME); track("nav.table.open"); }}
                >
                  {t.NAME}
                </button>
                <span className="ml-auto shrink-0 rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium text-muted-foreground tabular">
                  {fmtNum(t.rowCount)} rows
                </span>
              </div>
              <p className="mb-1 truncate font-mono text-[10px] text-muted-foreground/60">{t.PHYSICAL}</p>
              <p className="truncate text-[11px] text-muted-foreground">
                {t.columns?.slice(0, 5).map((c) => c.name).join(", ")}
                {t.columns?.length > 5 ? ` +${t.columns.length - 5}` : ""}
              </p>
              <div className="mt-3 flex items-center gap-2 border-t border-border pt-3">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1 border-border bg-secondary/40 text-xs hover:bg-accent"
                  onClick={() => { store.navigate("table", t.NAME); track("nav.table.open"); }}
                >
                  Open <ArrowRight className="h-3 w-3" />
                </Button>
                <span className="text-[10px] text-muted-foreground/60">{t.columns?.length} cols</span>
                {Number(t.REALTIME) === 1 && (
                  <span className="ml-auto flex items-center gap-1.5 rounded-full border border-brand/25 bg-brand-soft px-2 py-0.5 text-[10px] font-medium text-brand">
                    <Radio className="h-2.5 w-2.5 animate-pulse" /> live
                  </span>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className={`ml-auto h-8 hover:bg-danger/10 hover:text-danger ${Number(t.REALTIME) === 1 ? "" : "ml-0"}`}
                  onClick={() => setDropTarget(t.NAME)}
                  aria-label={`Drop ${t.NAME}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Drop confirmation — proper AlertDialog instead of window.confirm */}
      <AlertDialog open={!!dropTarget} onOpenChange={(v) => !v && setDropTarget(null)}>
        <AlertDialogContent className="panel border-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display">Drop table &quot;{dropTarget}&quot;?</AlertDialogTitle>
            <AlertDialogDescription>
              All data in this table will be permanently deleted. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-border bg-secondary/40">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => dropTarget && dropTable(dropTarget)}
              className="bg-danger text-white hover:bg-danger/90"
            >
              <Trash2 className="mr-1.5 h-4 w-4" /> Drop table
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
