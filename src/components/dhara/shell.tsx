"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useStore, ViewId } from "@/lib/store";
import { api, getTokens, setTokens, track } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CommandPalette } from "./palette";
import { DharaLogo } from "@/components/dhara/brand";
import { NewProjectDialog } from "./new-project-dialog";
import {
  Database,
  Home,
  Table2,
  TerminalSquare,
  Users,
  Globe,
  HardDrive,
  Plug,
  KeyRound,
  Settings,
  Plus,
  ChevronDown,
  Menu,
  Search,
  LogOut,
  Sparkles,
  Moon,
  Sun,
  Command,
} from "lucide-react";
import { useTheme } from "next-themes";
import { toast } from "sonner";

const NAV: { id: ViewId; label: string; icon: typeof Home; feature: string; group: string }[] = [
  { id: "home", label: "Home", icon: Home, feature: "nav.home", group: "Overview" },
  { id: "tables", label: "Table Editor", icon: Table2, feature: "nav.tables", group: "Database" },
  { id: "sql", label: "SQL Console", icon: TerminalSquare, feature: "nav.sql", group: "Database" },
  { id: "auth", label: "Authentication", icon: Users, feature: "nav.auth", group: "Services" },
  { id: "api", label: "API & Keys", icon: Globe, feature: "nav.api", group: "Services" },
  { id: "storage", label: "Storage", icon: HardDrive, feature: "nav.storage", group: "Services" },
  { id: "mcp", label: "MCP Server", icon: Plug, feature: "nav.mcp", group: "Platform" },
  { id: "pats", label: "Access Tokens", icon: KeyRound, feature: "nav.pats", group: "Platform" },
  { id: "settings", label: "Settings", icon: Settings, feature: "nav.settings", group: "Platform" },
];

const MOBILE_NAV: ViewId[] = ["home", "tables", "sql", "auth", "api"];
const GROUP_ORDER = ["Overview", "Database", "Services", "Platform"];

export function Shell({ children }: { children: React.ReactNode }) {
  const store = useStore();
  const { theme, setTheme } = useTheme();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [projectOpen, setProjectOpen] = useState(false);
  const [tables, setTables] = useState<{ NAME: string }[]>([]);

  const activeProject = store.projects.find((p) => p.ID === store.activeProjectId) ?? null;

  // usage-based auto ordering (AI nav formation)
  const orderedNav = useMemo(() => {
    if (!store.autoOrganize) return NAV;
    const score = (f: string) => store.usage[f] ?? 0;
    return [...NAV].sort((a, b) => score(b.feature) - score(a.feature));
  }, [store.autoOrganize, store.usage]);

  const topUsed = useMemo(() => {
    return [...orderedNav]
      .filter((n) => (store.usage[n.feature] ?? 0) > 0)
      .slice(0, 4);
  }, [orderedNav, store.usage]);

  const groupedNav = useMemo(() => {
    return GROUP_ORDER.map((g) => ({ group: g, items: NAV.filter((n) => n.group === g) }));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // load tables for quick jump
  useEffect(() => {
    if (!store.user || !store.activeProjectId) return;
    api<{ tables: { NAME: string }[] }>(`/api/projects/${store.activeProjectId}/tables`)
      .then((d) => setTables(d.tables ?? []))
      .catch(() => setTables([]));
  }, [store.user, store.activeProjectId, store.view, store.activeTable]);

  async function logout() {
    const { refresh } = getTokens();
    try {
      await api("/api/auth/logout", { method: "POST", body: JSON.stringify({ refreshToken: refresh }) });
    } catch {
      /* ignore */
    }
    setTokens(null);
    store.setUser(null);
    toast.success("Signed out");
  }

  const navItem = (n: (typeof NAV)[number], onUsageScore = false) => {
    const active = store.view === n.id || (n.id === "tables" && store.view === "table");
    const usageCount = store.usage[n.feature] ?? 0;
    return (
      <button
        key={n.id}
        onClick={() => {
          store.navigate(n.id);
          track(n.feature);
        }}
        aria-current={active ? "page" : undefined}
        className={`group relative flex min-h-[42px] w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all duration-150 ${
          active
            ? "bg-accent text-foreground font-medium shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
            : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
        }`}
      >
        {active && (
          <motion.span
            layoutId="nav-rail"
            className="absolute -left-3 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-brand"
            transition={{ type: "spring", stiffness: 500, damping: 35 }}
          />
        )}
        <n.icon
          className={`h-[18px] w-[18px] shrink-0 transition-colors ${
            active ? "text-brand" : "text-muted-foreground/70 group-hover:text-foreground"
          }`}
        />
        <span className="truncate">{n.label}</span>
        {onUsageScore && usageCount > 2 && (
          <span className="ml-auto rounded-full bg-brand-soft px-1.5 py-0.5 text-[10px] font-medium text-brand tabular">
            {usageCount}
          </span>
        )}
      </button>
    );
  };

  const logo = (
    <div className="flex items-center gap-2.5 px-1">
      <DharaLogo size={32} className="shrink-0 text-foreground" />
      <div className="min-w-0 leading-tight">
        <p className="font-display text-[15px]">Dhara</p>
        <p className="truncate text-[10px] text-muted-foreground">Oracle Autonomous AI · 26ai</p>
      </div>
    </div>
  );

  const sidebarContent = (
    <div className="flex h-full flex-col">
      {/* Brand */}
      <div className="flex h-14 items-center border-b border-border px-4">{logo}</div>

      {/* Project switcher */}
      <div className="px-3 pb-3 pt-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="group flex min-h-[46px] w-full items-center gap-2.5 rounded-xl border border-border bg-card px-3 py-2.5 text-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition-colors hover:border-brand/30 hover:bg-accent"
              aria-label="Switch project"
            >
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-inset ring-black/20"
                style={{ background: activeProject?.COLOR ?? "#14B8A6", boxShadow: `0 0 10px -2px ${activeProject?.COLOR ?? "#14B8A6"}` }}
              />
              <span className="min-w-0 flex-1 text-left">
                <span className="block truncate text-[13px] font-medium leading-tight">
                  {activeProject?.NAME ?? "No project"}
                </span>
                <span className="block text-[10px] leading-tight text-muted-foreground">Project</span>
              </span>
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64 border-border bg-popover">
            <DropdownMenuLabel className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Projects
            </DropdownMenuLabel>
            {store.projects.map((p) => (
              <DropdownMenuItem
                key={p.ID}
                onClick={() => store.setActiveProject(p.ID)}
                className="cursor-pointer gap-2.5"
              >
                <span className="h-2 w-2 rounded-full" style={{ background: p.COLOR ?? "#14B8A6" }} />
                <span className="truncate">{p.NAME}</span>
                {p.ID === store.activeProjectId && (
                  <span className="ml-auto rounded-full bg-brand-soft px-1.5 py-0.5 text-[9px] font-medium text-brand">
                    active
                  </span>
                )}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator className="bg-border" />
            <DropdownMenuItem onClick={() => setProjectOpen(true)} className="cursor-pointer gap-2.5 text-brand">
              <span className="flex h-4.5 w-4.5 items-center justify-center rounded bg-brand-soft">
                <Plus className="h-3 w-3" />
              </span>
              New project
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* For You (AI) */}
      {store.autoOrganize && topUsed.length > 0 && (
        <div className="px-3 pb-1">
          <div className="mb-1.5 flex items-center gap-1.5 px-2">
            <Sparkles className="h-3 w-3 text-ai" />
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              For you
            </span>
            <span className="ml-auto rounded-full border border-ai/25 bg-ai/10 px-1.5 text-[9px] font-medium text-ai">
              AI
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5 px-1 pb-1.5">
            {topUsed.map((n) => (
              <button
                key={n.id}
                onClick={() => {
                  store.navigate(n.id);
                  track(n.feature);
                }}
                className="press flex min-h-[28px] items-center gap-1.5 rounded-full border border-ai/25 bg-ai/10 px-2.5 text-[11px] font-medium text-ai transition-colors hover:bg-ai/20"
              >
                <n.icon className="h-3 w-3" />
                {n.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Nav */}
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2" aria-label="Main navigation">
        {store.autoOrganize ? (
          orderedNav.map((n) => navItem(n, true))
        ) : (
          groupedNav.map(({ group, items }) => (
            <div key={group} className="pb-2">
              <p className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">
                {group}
              </p>
              {items.map((n) => navItem(n))}
            </div>
          ))
        )}

        {tables.length > 0 && (
          <>
            <div className="flex items-center justify-between px-3 pb-1 pt-4">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">
                Tables
              </p>
              <span className="rounded-full bg-secondary px-1.5 text-[10px] font-medium text-muted-foreground tabular">
                {tables.length}
              </span>
            </div>
            {tables.slice(0, 12).map((t) => {
              const active = store.view === "table" && store.activeTable === t.NAME;
              return (
                <button
                  key={t.NAME}
                  onClick={() => {
                    store.navigate("table", t.NAME);
                    track("nav.table.open");
                  }}
                  className={`flex min-h-[40px] w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                    active
                      ? "bg-accent font-medium text-foreground"
                      : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                  }`}
                >
                  <Table2
                    className={`h-4 w-4 shrink-0 ${active ? "text-brand" : "text-muted-foreground/60"}`}
                  />
                  <span className="truncate font-mono text-[13px]">{t.NAME}</span>
                </button>
              );
            })}
          </>
        )}
      </nav>

      {/* Footer — live connection card */}
      <div className="border-t border-border p-3">
        <div className="flex items-center gap-2.5 rounded-xl border border-border bg-card px-3 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
          <span className="relative flex h-2 w-2 shrink-0">
            {store.connected && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-60" />
            )}
            <span
              className={`relative inline-flex h-2 w-2 rounded-full ${store.connected ? "bg-brand" : "bg-danger"}`}
            />
          </span>
          <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
            {store.connected ? store.banner || "Oracle connected" : "Disconnected"}
          </span>
          <button
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label="Toggle theme"
          >
            {theme === "dark" ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
    </div>
  );

  const viewLabels: Record<ViewId, string> = {
    home: "Home",
    tables: "Table Editor",
    table: store.activeTable ?? "Table",
    sql: "SQL Console",
    auth: "Authentication",
    api: "API & Keys",
    storage: "Storage",
    mcp: "MCP Server",
    pats: "Access Tokens",
    settings: "Settings",
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <div className="flex min-h-0 flex-1">
        {/* Desktop sidebar */}
        <aside className="hidden w-[264px] shrink-0 flex-col border-r border-border bg-sidebar md:flex">
          {sidebarContent}
        </aside>

        {/* Mobile drawer */}
        <Sheet open={store.sidebarOpen} onOpenChange={(v) => store.toggleSidebar()}>
          <SheetContent side="left" className="w-[280px] border-border bg-sidebar p-0">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            {sidebarContent}
          </SheetContent>
        </Sheet>

        {/* Main column */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Glass header */}
          <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background/70 px-4 backdrop-blur-xl backdrop-saturate-150 sm:px-5">
            <button
              className="-ml-2 rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground md:hidden"
              onClick={() => store.toggleSidebar()}
              aria-label="Open navigation"
            >
              <Menu className="h-5 w-5" />
            </button>
            <nav className="flex min-w-0 items-center gap-2 text-sm" aria-label="Breadcrumb">
              {activeProject && (
                <>
                  <span className="hidden items-center gap-1.5 text-muted-foreground sm:flex">
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ background: activeProject.COLOR ?? "#14B8A6" }}
                    />
                    <span className="max-w-40 truncate">{activeProject.NAME}</span>
                  </span>
                  <span className="hidden text-border sm:inline">/</span>
                </>
              )}
              <span className="truncate font-medium">{viewLabels[store.view]}</span>
            </nav>

            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={() => setPaletteOpen(true)}
                className="group flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-2.5 text-muted-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition-colors hover:border-brand/30 hover:text-foreground sm:pr-1.5"
                aria-label="Open command palette"
              >
                <Search className="h-3.5 w-3.5" />
                <span className="hidden text-xs sm:inline">Search…</span>
                <kbd className="kbd hidden items-center gap-0.5 sm:flex">
                  <Command className="h-2.5 w-2.5" />K
                </kbd>
              </button>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="flex min-h-[36px] items-center gap-2 rounded-full border border-border bg-card py-1 pl-1 pr-2 transition-colors hover:bg-accent"
                    aria-label="Account menu"
                  >
                    <span
                      className="flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold text-zinc-950"
                      style={{
                        background: `linear-gradient(135deg, ${store.user?.avatarColor ?? "#14B8A6"}, color-mix(in oklab, ${store.user?.avatarColor ?? "#14B8A6"} 55%, #ffffff))`,
                      }}
                    >
                      {(store.user?.name ?? "U").slice(0, 1).toUpperCase()}
                    </span>
                    <span className="hidden max-w-24 truncate text-xs sm:inline">{store.user?.name}</span>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56 border-border bg-popover">
                  <DropdownMenuLabel className="text-xs">
                    <span className="block font-medium">{store.user?.name}</span>
                    <span className="block truncate text-[11px] font-normal text-muted-foreground">
                      {store.user?.email}
                    </span>
                    <span className="mt-1 inline-block rounded-full bg-brand-soft px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-brand">
                      {store.user?.role}
                    </span>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator className="bg-border" />
                  <DropdownMenuItem
                    onClick={() => {
                      store.navigate("pats");
                      track("nav.pats");
                    }}
                    className="cursor-pointer"
                  >
                    <KeyRound className="mr-2 h-4 w-4" /> Access tokens
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                    className="cursor-pointer"
                  >
                    {theme === "dark" ? (
                      <Sun className="mr-2 h-4 w-4" />
                    ) : (
                      <Moon className="mr-2 h-4 w-4" />
                    )}
                    {theme === "dark" ? "Light mode" : "Dark mode"}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator className="bg-border" />
                  <DropdownMenuItem onClick={logout} className="cursor-pointer text-danger focus:text-danger">
                    <LogOut className="mr-2 h-4 w-4" /> Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </header>

          {/* View with page transition */}
          <main className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={`${store.view}:${store.activeTable ?? ""}`}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                className="pb-20 md:pb-6"
              >
                {children}
              </motion.div>
            </AnimatePresence>
          </main>

          {/* Mobile bottom nav */}
          <nav
            className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/85 backdrop-blur-xl backdrop-saturate-150 md:hidden"
            style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
            aria-label="Bottom navigation"
          >
            <div className="grid grid-cols-5">
              {MOBILE_NAV.map((id) => {
                const n = NAV.find((x) => x.id === id)!;
                const active = store.view === id || (id === "tables" && store.view === "table");
                return (
                  <button
                    key={id}
                    onClick={() => {
                      store.navigate(id);
                      track(n.feature);
                    }}
                    className="flex min-h-[52px] flex-col items-center justify-center gap-0.5 py-1.5"
                    aria-current={active ? "page" : undefined}
                  >
                    <n.icon
                      className={`h-[18px] w-[18px] transition-colors ${active ? "text-brand" : "text-muted-foreground"}`}
                    />
                    <span
                      className={`text-[9.5px] leading-none ${active ? "font-medium text-foreground" : "text-muted-foreground"}`}
                    >
                      {id === "home" ? "Home" : n.label.split(" ")[0]}
                    </span>
                  </button>
                );
              })}
            </div>
          </nav>
        </div>
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <NewProjectDialog open={projectOpen} onOpenChange={setProjectOpen} />
    </div>
  );
}
