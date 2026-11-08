"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useStore } from "@/lib/store";
import { api, track, fmtNum, fmtBytes } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { NewProjectDialog } from "./new-project-dialog";
import {
  Table2, Rows3, KeyRound, Webhook, ShieldCheck, HardDrive, Radio, Plus, TerminalSquare,
  Activity, Sparkles, Boxes, FolderPlus, ArrowRight, CircleCheck,
} from "lucide-react";

interface Stats {
  tables: number;
  totalRows: number;
  perTable: { name: string; rows: number }[];
  keys: number;
  webhooks: number;
  policies: number;
  files: number;
  storageBytes: number;
  realtimeTables: number;
}

interface AuditRow {
  ID: string;
  ACTION: string;
  TARGET: string | null;
  EMAIL: string | null;
  AT?: string;
}

const ACTION_TINTS: Record<string, string> = {
  table: "text-brand border-brand/25 bg-brand-soft",
  auth: "text-ai border-ai/25 bg-ai/10",
  storage: "text-[#38bdf8] border-[#38bdf8]/25 bg-[#38bdf8]/10",
  project: "text-[#fbbf24] border-[#fbbf24]/25 bg-[#fbbf24]/10",
  sql: "text-[#f472b6] border-[#f472b6]/25 bg-[#f472b6]/10",
};

function actionTint(action: string): string {
  const prefix = action.split(".")[0];
  return ACTION_TINTS[prefix] ?? "border-border bg-secondary text-muted-foreground";
}

export default function Dashboard() {
  const store = useStore();
  const [stats, setStats] = useState<Stats | null>(null);
  const [activity, setActivity] = useState<AuditRow[]>([]);
  const [projectOpen, setProjectOpen] = useState(false);
  const project = store.projects.find((p) => p.ID === store.activeProjectId);

  useEffect(() => {
    track("home.view");
    if (!store.activeProjectId) return;
    api<Stats>(`/api/projects/${store.activeProjectId}/stats`).then(setStats).catch(() => setStats(null));
    api<{ audit: AuditRow[] }>("/api/audit").then((d) => setActivity(d.audit ?? [])).catch(() => setActivity([]));
  }, [store.activeProjectId]);

  const cards = [
    { label: "Tables", value: fmtNum(stats?.tables), icon: Table2, color: "#14B8A6" },
    { label: "Total rows", value: fmtNum(stats?.totalRows), icon: Rows3, color: "#F5A623" },
    { label: "RLS policies", value: fmtNum(stats?.policies), icon: ShieldCheck, color: "#A78BFA" },
    { label: "API keys", value: fmtNum(stats?.keys), icon: KeyRound, color: "#38BDF8" },
    { label: "Webhooks", value: fmtNum(stats?.webhooks), icon: Webhook, color: "#F87171" },
    { label: "Realtime tables", value: fmtNum(stats?.realtimeTables), icon: Radio, color: "#F472B6" },
    { label: "Storage files", value: fmtNum(stats?.files), icon: HardDrive, color: "#34D399" },
    { label: "Storage size", value: fmtBytes(stats?.storageBytes ?? 0), icon: Boxes, color: "#94A3B8" },
  ];

  const topFeatures = Object.entries(store.usage)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const maxRows = stats?.perTable?.length ? Math.max(...stats.perTable.map((x) => x.rows)) : 1;

  return (
    <div className="mx-auto w-full max-w-7xl p-4 sm:p-6 lg:p-8">
      {/* Greeting */}
      <div className="mb-7 animate-fade-up">
        <h1 className="font-display flex flex-wrap items-center gap-2.5 text-2xl font-bold tracking-tight sm:text-[1.7rem]">
          Welcome back, {store.user?.name?.split(" ")[0]}
          <Sparkles className="h-5 w-5 text-ai" />
        </h1>
        <p className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          {project ? (
            <>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ background: project.COLOR ?? "#14B8A6" }} />
                <span className="font-medium text-foreground">{project.NAME}</span>
              </span>
              <span className="text-border">·</span>
              <span className="inline-flex items-center gap-1.5">
                auto-create tables
                {project.AUTO_CREATE_TABLES ? (
                  <Badge variant="outline" className="h-5 border-brand/25 bg-brand-soft px-1.5 text-[10px] text-brand">
                    <CircleCheck className="mr-0.5 h-2.5 w-2.5" /> ON
                  </Badge>
                ) : (
                  <Badge variant="outline" className="h-5 border-border bg-secondary px-1.5 text-[10px] text-muted-foreground">
                    OFF
                  </Badge>
                )}
              </span>
            </>
          ) : (
            "Create your first project to get started"
          )}
        </p>
      </div>

      {/* Quick actions */}
      <div className="mb-6 flex flex-wrap gap-2 animate-fade-up" style={{ animationDelay: "0.05s" }}>
        <Button
          size="sm"
          className="press h-9 gap-2 bg-gradient-to-r from-[#14B8A6] to-[#0d9488] font-medium text-zinc-950 shadow-[0_0_16px_-4px_rgba(20,184,166,0.5)] hover:from-[#2DD4BF] hover:to-[#14B8A6]"
          onClick={() => { store.navigate("tables"); track("nav.tables"); }}
        >
          <Plus className="h-4 w-4" /> New table
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-9 gap-2 border-border bg-card shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] hover:bg-accent"
          onClick={() => { store.navigate("sql"); track("nav.sql"); }}
        >
          <TerminalSquare className="h-4 w-4 text-brand" /> SQL Console
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-9 gap-2 border-border bg-card shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] hover:bg-accent"
          onClick={() => setProjectOpen(true)}
        >
          <FolderPlus className="h-4 w-4 text-ai" /> New project
        </Button>
      </div>

      {/* Stat cards */}
      <div className="stagger mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {cards.map((c) => (
          <div
            key={c.label}
            className="lift group relative overflow-hidden rounded-xl border border-border bg-card p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
          >
            <div
              className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full opacity-0 blur-2xl transition-opacity duration-300 group-hover:opacity-25"
              style={{ background: c.color }}
              aria-hidden
            />
            <div className="flex items-center gap-3">
              <div
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border"
                style={{ background: `${c.color}1a` }}
              >
                <c.icon className="h-4 w-4" style={{ color: c.color }} />
              </div>
              <div className="min-w-0">
                <p className="truncate text-lg font-bold leading-tight tabular">{c.value}</p>
                <p className="truncate text-[11px] text-muted-foreground">{c.label}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Table breakdown */}
        <Card className="panel border-border shadow-none">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-brand-soft">
                <Table2 className="h-3.5 w-3.5 text-brand" />
              </span>
              Rows per table
            </CardTitle>
          </CardHeader>
          <CardContent className="max-h-72 overflow-y-auto">
            {stats?.perTable?.length ? (
              <div className="space-y-1">
                {stats.perTable.map((t) => (
                  <button
                    key={t.name}
                    onClick={() => { store.navigate("table", t.name); track("nav.table.open"); }}
                    className="group flex min-h-[40px] w-full items-center gap-3 rounded-lg px-2 py-2 text-sm transition-colors hover:bg-accent/70"
                  >
                    <span className="truncate font-mono text-[13px]">{t.name}</span>
                    <div className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-secondary">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{
                          width: `${Math.min(100, (t.rows / Math.max(1, maxRows)) * 100)}%`,
                        }}
                        transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
                        className="h-full rounded-full bg-gradient-to-r from-brand/70 to-brand"
                      />
                    </div>
                    <span className="w-14 shrink-0 text-right text-xs text-muted-foreground tabular">
                      {t.rows < 0 ? "—" : fmtNum(t.rows)}
                    </span>
                    <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                  </button>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center py-8 text-center">
                <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl border border-dashed border-border bg-secondary/40">
                  <Table2 className="h-5 w-5 text-muted-foreground" />
                </div>
                <p className="text-sm font-medium">No tables yet</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Create one from the Table Editor — or paste JSON.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Activity + AI usage */}
        <div className="space-y-4">
          <Card className="panel border-border shadow-none">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm">
                <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[#fbbf24]/10">
                  <Activity className="h-3.5 w-3.5 text-[#fbbf24]" />
                </span>
                Recent activity
              </CardTitle>
            </CardHeader>
            <CardContent className="max-h-52 overflow-y-auto">
              {activity.length ? (
                <div className="space-y-0.5 text-xs">
                  {activity.slice(0, 10).map((a) => (
                    <div
                      key={a.ID}
                      className="flex items-center gap-2 rounded-md px-1.5 py-1.5 transition-colors hover:bg-accent/60"
                    >
                      <Badge
                        variant="outline"
                        className={`shrink-0 border font-mono text-[9px] ${actionTint(a.ACTION)}`}
                      >
                        {a.ACTION}
                      </Badge>
                      <span className="truncate text-muted-foreground">{a.TARGET ?? "—"}</span>
                      <span className="ml-auto shrink-0 text-[10px] text-muted-foreground/60 tabular">
                        {a.AT ? new Date(a.AT).toLocaleTimeString() : ""}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="py-4 text-center text-sm text-muted-foreground">No activity yet.</p>
              )}
            </CardContent>
          </Card>

          <Card className="panel relative overflow-hidden border-border shadow-none">
            <div
              className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full opacity-20 blur-2xl"
              style={{ background: "#38bdf8" }}
              aria-hidden
            />
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm">
                <span className="flex h-6 w-6 items-center justify-center rounded-md bg-ai/10">
                  <Sparkles className="h-3.5 w-3.5 text-ai" />
                </span>
                AI-organized navigation
                <Badge variant="outline" className="ml-auto border-ai/25 bg-ai/10 text-[9px] font-semibold text-ai">
                  AUTO
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {store.autoOrganize ? (
                topFeatures.length ? (
                  <div className="space-y-2">
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      Sidebar re-orders itself around your workflow. Most used:
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {topFeatures.map(([f, count]) => (
                        <span
                          key={f}
                          className="inline-flex items-center gap-1 rounded-full border border-ai/25 bg-ai/10 px-2 py-0.5 text-[10px] font-medium text-ai"
                        >
                          {f}
                          <span className="rounded-full bg-ai/20 px-1 text-[9px] tabular">{count}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Keep working — the sidebar &amp; &quot;For you&quot; chips will re-organize based on which
                    features you use the most.
                  </p>
                )
              ) : (
                <p className="text-xs text-muted-foreground">
                  Auto-organize is off. Enable it in Settings → AI Preferences.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <NewProjectDialog open={projectOpen} onOpenChange={setProjectOpen} />
    </div>
  );
}
