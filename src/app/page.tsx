"use client";

import { useCallback, useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { api, getTokens, setTokens, track } from "@/lib/client-api";
import Landing, { type LandingRoute } from "@/components/dhara/landing";
import { Shell } from "@/components/dhara/shell";
import Dashboard from "@/components/dhara/dashboard";
import TablesView from "@/components/dhara/tables";
import GridView from "@/components/dhara/grid";
import SqlConsole from "@/components/dhara/sql";
import AuthUsers from "@/components/dhara/auth-users";
import ApiExplorer from "@/components/dhara/api-explorer";
import StorageView from "@/components/dhara/storage";
import PatsView from "@/components/dhara/pats";
import McpView from "@/components/dhara/mcp-view";
import SettingsView from "@/components/dhara/settings";
import { DharaLoader } from "@/components/dhara/brand";

/**
 * Dhara — single-page application shell.
 * All dashboard views render here (state-based routing + hash sync).
 */
export default function Home() {
  const store = useStore();
  const [loading, setLoading] = useState(true);
  // Email-action / OAuth deep links (#/reset, #/verify, #/signup, #/oauth) —
  // captured once below BEFORE the hash-sync effect rewrites the URL.
  const [route, setRoute] = useState<LandingRoute | null>(null);

  const boot = useCallback(async () => {
    setLoading(true);
    try {
      const status = await api<{
        configured: boolean;
        connected: boolean;
        banner: string;
        hasUsers: boolean;
      }>("/api/setup", { skipAuth: true });
      store.setBoot({
        configured: status.configured,
        connected: status.connected,
        banner: status.banner,
        hasUsers: status.hasUsers,
      });
      if (status.connected) {
        const { access } = getTokens();
        if (access) {
          try {
            const me = await api<{ user: never }>("/api/auth/me");
            store.setUser(me.user);
          } catch {
            setTokens(null);
          }
        }
      }
    } catch {
      store.setBoot({ configured: false, connected: false });
    } finally {
      setLoading(false);
    }
     
  }, []);

  useEffect(() => {
    void boot();
     
  }, []);

  // Deep links: #/oauth?code=… (H7 code exchange), #/reset?token=…, #/verify?token=…,
  // #/signup?invite=…&email=…. The one-time code / tokens are stripped from the URL
  // immediately after being read (security) — handling itself lives in Landing.
  // Declared FIRST so it runs before the hash-sync effect below.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const hash = window.location.hash;
    if (!hash.startsWith("#/")) return;
    const [path, query = ""] = hash.slice(2).split("?");
    const params = new URLSearchParams(query);
    const keep = (fragment: string) =>
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#${fragment}`);

    if (path === "oauth") {
      const code = params.get("code");
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
      if (code) setRoute({ kind: "oauth", code });
    } else if (path === "reset") {
      const token = params.get("token");
      keep("/reset");
      if (token) setRoute({ kind: "reset", token });
    } else if (path === "verify") {
      const token = params.get("token");
      keep("/verify");
      if (token) setRoute({ kind: "verify", token });
    } else if (path === "signup") {
      const invite = params.get("invite");
      const email = params.get("email");
      if (invite || email) {
        setRoute({ kind: "signup", invite: invite ?? "", email: email ?? "" });
        keep("/signup");
      }
    }
  }, []);

  // load projects when user present
  useEffect(() => {
    if (!store.user) return;
    api<{ projects: never[] }>("/api/projects")
      .then((d) => {
        store.setProjects(d.projects);
        track("app.projects_loaded");
      })
      .catch(() => undefined);
    api<{ usage: { FEATURE: string; CNT: number }[]; autoOrganize: boolean }>("/api/usage")
      .then(async (d) => {
        const map: Record<string, number> = {};
        for (const u of d.usage ?? []) map[u.FEATURE] = Number(u.CNT);
        store.setUsage(map);
        const s = await api<{ autoOrganize: boolean }>("/api/settings");
        store.setAutoOrganize(s.autoOrganize);
      })
      .catch(() => undefined);
     
  }, [store.user]);

  // hash router sync (#/tables, #/table/x, #/sql …)
  useEffect(() => {
    if (!store.user) return;
    const hash = window.location.hash.replace(/^#\/?/, "");
    if (!hash) return;
    const [view, table] = hash.split("/");
    const valid = ["home", "tables", "table", "sql", "auth", "api", "storage", "mcp", "pats", "settings"];
    if (valid.includes(view)) {
      store.navigate(view as never, table ?? null);
    }
     
  }, [store.user]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const target = store.view === "table" && store.activeTable ? `#/table/${store.activeTable}` : `#/${store.view}`;
    if (window.location.hash !== target) {
      window.history.replaceState(null, "", target);
    }
  }, [store.view, store.activeTable]);

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-5 bg-background text-foreground">
        <DharaLoader size={72} className="text-foreground" label="Starting Dhara" />
        <p className="font-mono text-xs tracking-wide text-muted-foreground">Dhara</p>
      </div>
    );
  }

  if (!store.connected || !store.user) {
    return (
      <Landing
        onDone={() => {
          void boot();
        }}
        initialRoute={route}
      />
    );
  }

  return (
    <Shell>
      {store.view === "home" && <Dashboard />}
      {store.view === "tables" && <TablesView />}
      {store.view === "table" && <GridView />}
      {store.view === "sql" && <SqlConsole />}
      {store.view === "auth" && <AuthUsers />}
      {store.view === "api" && <ApiExplorer />}
      {store.view === "storage" && <StorageView />}
      {store.view === "mcp" && <McpView />}
      {store.view === "pats" && <PatsView />}
      {store.view === "settings" && <SettingsView />}
    </Shell>
  );
}
