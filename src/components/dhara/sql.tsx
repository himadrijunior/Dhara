"use client";
import { DharaLoader } from "@/components/dhara/brand";

import { useCallback, useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { api, track } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Play, Save, History, Trash2, Copy, Star,
} from "lucide-react";

interface SqlResult {
  statement: string;
  rows?: Record<string, unknown>[];
  rowsAffected?: number;
  error?: string;
}
interface HistoryRow { ID: string; STATEMENT: string; OK: number; ERROR: string | null; DURATION_MS: number; AT?: string }
interface SavedRow { ID: string; NAME: string; STATEMENT: string; CREATED_AT?: string }

export default function SqlConsole() {
  const store = useStore();
  const [statement, setStatement] = useState("SELECT table_name FROM user_tables ORDER BY table_name");
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<{ ok: boolean; durationMs: number; results: SqlResult[] } | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [saved, setSaved] = useState<SavedRow[]>([]);
  const [saveName, setSaveName] = useState("");
  const [saveOpen, setSaveOpen] = useState(false);

  const loadMeta = useCallback(async () => {
    if (!store.activeProjectId) return;
    try {
      const d = await api<{ history: HistoryRow[]; saved: SavedRow[] }>(`/api/sql?projectId=${store.activeProjectId}`);
      setHistory(d.history ?? []);
      setSaved(d.saved ?? []);
    } catch {
      /* ignore */
    }
  }, [store.activeProjectId]);

  useEffect(() => {
    track("sql.view");
    void loadMeta();
  }, [loadMeta]);

  async function run() {
    if (!statement.trim() || !store.activeProjectId) return;
    setRunning(true);
    try {
      const d = await api<{ ok: boolean; durationMs: number; results: SqlResult[] }>("/api/sql", {
        method: "POST",
        body: JSON.stringify({ projectId: store.activeProjectId, statement }),
      });
      setResults(d);
      if (d.ok) toast.success(`Done in ${d.durationMs}ms`);
      else toast.error("Statement failed — see error below");
      await loadMeta();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Run failed");
    } finally {
      setRunning(false);
    }
  }

  const R = results?.results[0];
  const cols = R?.rows && R.rows.length > 0 ? Object.keys(R.rows[0]) : [];

  return (
    <div className="mx-auto grid w-full max-w-7xl gap-4 p-4 sm:p-6 lg:p-8 lg:grid-cols-[1fr_280px]">
      <div className="space-y-3 min-w-0">
        <div className="panel overflow-hidden">
          <div className="flex items-center gap-2 border-b border-border bg-secondary/40 px-3 py-2">
            <span className="font-display text-xs font-semibold tracking-tight text-foreground">SQL Console</span>
            <span className="hidden items-center gap-1 text-[10px] text-muted-foreground sm:flex"><span className="kbd">Ctrl</span><span className="kbd">↵</span> to run</span>
            <div className="ml-auto flex gap-1.5">
              <Button size="sm" variant="outline" className="press h-8 gap-1 border-border bg-secondary/50 text-xs hover:bg-accent/60" onClick={() => setSaveOpen(true)}>
                <Save className="w-3 h-3" /> Save
              </Button>
              <Button size="sm" className="press h-8 gap-1 bg-gradient-to-r from-[#14B8A6] to-[#0d9488] text-xs font-medium text-zinc-950 shadow-[0_0_16px_-4px_rgba(20,184,166,0.5)] hover:from-[#2DD4BF] hover:to-[#14B8A6]" onClick={run} disabled={running}>
                {running ? <DharaLoader size={14} label="Running" /> : <Play className="w-3 h-3" />} Run
              </Button>
            </div>
          </div>
          <textarea
            value={statement}
            onChange={(e) => setStatement(e.target.value)}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                e.preventDefault();
                void run();
              }
            }}
            rows={7}
            spellCheck={false}
            className="w-full min-h-32 resize-y bg-background/60 p-4 font-mono text-sm text-foreground focus:outline-none"
            placeholder="SELECT * FROM your_table"
          />
        </div>

        {results && (
          <div className="panel overflow-hidden">
            <div className="flex items-center gap-2 border-b border-border px-3 py-2">
              <Badge variant="outline" className={`text-[10px] tabular ${results.ok ? "border-brand/25 bg-brand-soft text-brand" : "border-danger/25 bg-danger/10 text-danger"}`}>
                {results.ok ? "SUCCESS" : "ERROR"}
              </Badge>
              <span className="text-xs text-muted-foreground tabular">{results.durationMs}ms</span>
              {R?.rows && (
                <button className="press ml-auto flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground" onClick={() => { navigator.clipboard.writeText(JSON.stringify(R.rows, null, 2)); toast.success("Copied"); }}>
                  <Copy className="w-3 h-3" /> copy JSON
                </button>
              )}
            </div>
            {R?.error ? (
              <p className="p-4 font-mono text-xs text-danger whitespace-pre-wrap">{R.error}</p>
            ) : R?.rows ? (
              <div className="overflow-x-auto max-h-96">
                <table className="w-full text-xs">
                  <thead className="glass sticky top-0">
                    <tr>{cols.map((c) => <th key={c} className="whitespace-nowrap px-3 py-2 text-left font-mono text-[11px] font-medium text-muted-foreground">{c}</th>)}</tr>
                  </thead>
                  <tbody>
                    {R.rows.map((row, i) => (
                      <tr key={i} className="border-t border-border/60 transition-colors hover:bg-accent/30">
                        {cols.map((c) => (
                          <td key={c} className="max-w-64 truncate px-3 py-1.5 font-mono text-foreground/80" title={String(row[c] ?? "")}>
                            {row[c] === null || row[c] === undefined ? <span className="text-muted-foreground/60 italic">null</span> : typeof row[c] === "object" ? JSON.stringify(row[c]) : String(row[c])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="p-4 text-xs text-muted-foreground tabular">{R?.rowsAffected ?? 0} row(s) affected.</p>
            )}
          </div>
        )}
      </div>

      {/* Sidebar: history + saved */}
      <div className="space-y-4">
        <div className="panel">
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <Star className="h-3.5 w-3.5 text-warning" />
            <span className="text-xs font-medium text-foreground">Saved queries</span>
          </div>
          <div className="p-2 max-h-48 overflow-y-auto space-y-1">
            {saved.length === 0 ? <p className="p-2 text-xs text-muted-foreground/70">Nothing saved yet.</p> : saved.map((s) => (
              <button key={s.ID} className="group flex min-h-[40px] w-full items-center gap-2 rounded-md px-2 py-2 text-left transition-colors hover:bg-accent/60" onClick={() => setStatement(s.STATEMENT)}>
                <span className="flex-1 truncate text-xs text-foreground/90">{s.NAME}</span>
                <button className="press p-1 text-muted-foreground opacity-0 transition-colors group-hover:opacity-100 hover:text-danger" aria-label="Delete saved" onClick={async (e) => { e.stopPropagation(); await api(`/api/sql?id=${s.ID}`, { method: "DELETE" }); await loadMeta(); }}>
                  <Trash2 className="w-3 h-3" />
                </button>
              </button>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <History className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs font-medium text-foreground">History</span>
            <button className="ml-auto text-[10px] text-muted-foreground transition-colors hover:text-danger" onClick={async () => { await api(`/api/sql?history=1&projectId=${store.activeProjectId}`, { method: "DELETE" }); setHistory([]); }}>
              clear
            </button>
          </div>
          <div className="p-2 max-h-72 overflow-y-auto space-y-1">
            {history.length === 0 ? <p className="p-2 text-xs text-muted-foreground/70">No history.</p> : history.map((h) => (
              <button key={h.ID} className="w-full rounded-md px-2 py-2 text-left transition-colors hover:bg-accent/60" onClick={() => setStatement(h.STATEMENT)}>
                <p className="truncate font-mono text-xs text-foreground/80">{h.STATEMENT.slice(0, 60)}</p>
                <p className="text-[10px] text-muted-foreground/70"><span className={Number(h.OK) === 1 ? "text-success" : "text-danger"}>{Number(h.OK) === 1 ? "ok" : "error"}</span> · <span className="tabular">{h.DURATION_MS}ms</span></p>
              </button>
            ))}
          </div>
        </div>
      </div>

      {saveOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => setSaveOpen(false)}>
          <div className="panel w-full max-w-sm space-y-3 p-5 animate-fade-in" onClick={(e) => e.stopPropagation()}>
            <p className="font-display text-sm font-semibold tracking-tight">Save query</p>
            <input
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              placeholder="Query name"
              className="w-full rounded-md border border-border bg-secondary/50 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="outline" className="press border-border bg-secondary/50 hover:bg-accent/60" onClick={() => setSaveOpen(false)}>Cancel</Button>
              <Button size="sm" className="press bg-gradient-to-r from-[#14B8A6] to-[#0d9488] font-medium text-zinc-950 shadow-[0_0_16px_-4px_rgba(20,184,166,0.5)] hover:from-[#2DD4BF] hover:to-[#14B8A6]" onClick={async () => {
                try {
                  await api("/api/sql", { method: "PUT", body: JSON.stringify({ projectId: store.activeProjectId, name: saveName, statement }) });
                  toast.success("Saved");
                  setSaveOpen(false);
                  setSaveName("");
                  await loadMeta();
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Failed");
                }
              }}>Save</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
