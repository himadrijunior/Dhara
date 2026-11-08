"use client";

import { useEffect, useState } from "react";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { useStore, ViewId } from "@/lib/store";
import { track } from "@/lib/client-api";
import {
  Home, Table2, TerminalSquare, Users, Globe, HardDrive, Plug, KeyRound, Settings, Plus, Hash,
} from "lucide-react";

const VIEWS: { id: ViewId; label: string; icon: typeof Home; feature: string }[] = [
  { id: "home", label: "Home / Dashboard", icon: Home, feature: "nav.home" },
  { id: "tables", label: "Table Editor", icon: Table2, feature: "nav.tables" },
  { id: "sql", label: "SQL Console", icon: TerminalSquare, feature: "nav.sql" },
  { id: "auth", label: "Authentication", icon: Users, feature: "nav.auth" },
  { id: "api", label: "API & Keys", icon: Globe, feature: "nav.api" },
  { id: "storage", label: "Storage", icon: HardDrive, feature: "nav.storage" },
  { id: "mcp", label: "MCP Server", icon: Plug, feature: "nav.mcp" },
  { id: "pats", label: "Access Tokens", icon: KeyRound, feature: "nav.pats" },
  { id: "settings", label: "Settings", icon: Settings, feature: "nav.settings" },
];

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const store = useStore();
  const [tables, setTables] = useState<{ NAME: string }[]>([]);

  useEffect(() => {
    if (!open || !store.activeProjectId) return;
    import("@/lib/client-api").then(({ api }) =>
      api<{ tables: { NAME: string }[] }>(`/api/projects/${store.activeProjectId}/tables`)
        .then((d) => setTables(d.tables ?? []))
        .catch(() => setTables([]))
    );
  }, [open, store.activeProjectId]);

  const go = (view: ViewId, feature: string) => {
    store.navigate(view);
    track(feature);
    onOpenChange(false);
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Search views, tables, actions…" />
      <CommandList className="max-h-96">
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Navigate">
          {VIEWS.map((v) => (
            <CommandItem key={v.id} onSelect={() => go(v.id, v.feature)}>
              <v.icon className="mr-2 h-4 w-4 text-brand" /> {v.label}
            </CommandItem>
          ))}
        </CommandGroup>
        {tables.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading={`Tables (${store.projects.find((p) => p.ID === store.activeProjectId)?.NAME ?? ""})`}>
              {tables.map((t) => (
                <CommandItem
                  key={t.NAME}
                  onSelect={() => {
                    store.navigate("table", t.NAME);
                    track("nav.table.open");
                    onOpenChange(false);
                  }}
                >
                  <Hash className="mr-2 h-4 w-4 text-muted-foreground" /> <span className="font-mono text-[13px]">{t.NAME}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
        <CommandSeparator />
        <CommandGroup heading="Actions">
          <CommandItem onSelect={() => { go("tables", "nav.tables"); }}>
            <Plus className="w-4 h-4 mr-2" /> Create a table (paste JSON or design columns)
          </CommandItem>
          <CommandItem onSelect={() => { go("sql", "nav.sql"); }}>
            <TerminalSquare className="w-4 h-4 mr-2" /> Open SQL Console
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
