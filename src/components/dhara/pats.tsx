"use client";

import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { api, track } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { toast } from "sonner";
import { KeyRound, Plus, Trash2, Copy } from "lucide-react";

interface Pat {
  ID: string;
  NAME: string;
  PREFIX: string;
  SCOPE_MODE: string;
  SCOPES: string | null;
  EXPIRES_AT?: string | null;
  CREATED_AT?: string;
  LAST_USED_AT?: string | null;
  REVOKED: number;
}

const SCOPES = [
  "projects:read", "projects:manage", "db:read", "db:write", "sql:run",
  "auth:read", "auth:manage", "storage:read", "storage:write", "webhooks:manage",
];

export default function PatsView() {
  const store = useStore();
  const [pats, setPats] = useState<Pat[]>([]);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [mode, setMode] = useState<"full" | "read_only" | "specific">("read_only");
  const [selected, setSelected] = useState<string[]>(["db:read"]);
  const [expiryDays, setExpiryDays] = useState("90");
  const [created, setCreated] = useState<string | null>(null);

  const load = () => api<{ pats: Pat[] }>("/api/pats").then((d) => setPats(d.pats ?? [])).catch(() => undefined);

  useEffect(() => {
    track("pats.view");
    void load();
  }, []);

  async function create() {
    try {
      const d = await api<{ token: string }>("/api/pats", {
        method: "POST",
        body: JSON.stringify({ name, mode, scopes: selected, expiresInDays: Number(expiryDays) || 0 }),
      });
      setCreated(d.token);
      setOpen(false);
      setName("");
      toast.success("PAT created — copy it now");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  }

  return (
    <div className="stagger mx-auto w-full max-w-5xl space-y-5 p-4 sm:p-6 lg:p-8">
      <div className="flex flex-wrap items-center gap-2">
        <div>
          <h1 className="flex items-center gap-2.5 font-display text-2xl font-bold tracking-tight">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-brand-soft"><KeyRound className="h-4 w-4 text-brand" /></span> Personal Access Tokens
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            For MCP, CLI and automation — scoped: <strong>Full</strong>, <strong>Read-only</strong>, or{" "}
            <strong>Specific</strong> permissions.
          </p>
        </div>
        <Button className="press ml-auto gap-1 bg-gradient-to-r from-[#14B8A6] to-[#0d9488] font-medium text-zinc-950 shadow-[0_0_16px_-4px_rgba(20,184,166,0.5)] hover:from-[#2DD4BF] hover:to-[#14B8A6]" onClick={() => setOpen(true)}>
          <Plus className="w-4 h-4" /> New token
        </Button>
      </div>

      {created && (
        <div className="rounded-xl border border-brand/30 bg-brand-soft p-4">
          <p className="text-sm font-medium text-brand mb-2">Copy this token now — it will never be shown again:</p>
          <div className="flex gap-2">
            <code className="flex-1 overflow-x-auto whitespace-nowrap rounded-md border border-border bg-background/60 px-3 py-2 font-mono text-xs">{created}</code>
            <Button size="sm" variant="outline" className="press border-brand/30 text-brand hover:bg-brand-soft" onClick={() => { navigator.clipboard.writeText(created); toast.success("Copied"); }}>
              <Copy className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      )}

      <div className="panel overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-secondary/40">
            <tr className="text-left text-muted-foreground">
              <th className="px-3 py-2.5">Name</th>
              <th className="px-3 py-2.5">Scopes</th>
              <th className="px-3 py-2.5">Last used</th>
              <th className="px-3 py-2.5">Expires</th>
              <th className="px-3 py-2.5 w-12" />
            </tr>
          </thead>
          <tbody>
            {pats.length === 0 ? (
              <tr><td colSpan={5} className="px-3 py-8 text-center text-muted-foreground/70">No tokens yet.</td></tr>
            ) : (
              pats.map((p) => (
                <tr key={p.ID} className={`border-t border-border/60 transition-colors hover:bg-accent/30 ${Number(p.REVOKED) === 1 ? "opacity-40" : ""}`}>
                  <td className="px-3 py-2 text-foreground/90">
                    {p.NAME}
                    <span className="block font-mono text-[10px] text-muted-foreground/70">{p.PREFIX}…</span>
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant="outline" className="border-brand/25 bg-brand-soft text-[10px] text-brand">{p.SCOPE_MODE}</Badge>
                    {p.SCOPE_MODE === "specific" && (
                      <span className="mt-0.5 block max-w-56 truncate font-mono text-[10px] text-muted-foreground">{p.SCOPES}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground tabular">{p.LAST_USED_AT ? new Date(p.LAST_USED_AT).toLocaleDateString() : "never"}</td>
                  <td className="px-3 py-2 text-muted-foreground tabular">{p.EXPIRES_AT ? new Date(p.EXPIRES_AT).toLocaleDateString() : "—"}</td>
                  <td className="px-3 py-2 text-right">
                    {Number(p.REVOKED) === 0 && (
                      <button
                        className="press p-1.5 text-muted-foreground transition-colors hover:text-danger"
                        aria-label="Revoke"
                        onClick={async () => {
                          if (!confirm(`Revoke "${p.NAME}"?`)) return;
                          await api(`/api/pats?id=${p.ID}`, { method: "DELETE" });
                          toast.success("Token revoked");
                          await load();
                        }}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => setOpen(false)}>
          <div className="panel max-h-[85vh] w-full max-w-md space-y-4 overflow-y-auto p-5 animate-fade-in" onClick={(e) => e.stopPropagation()}>
            <p className="font-display text-sm font-semibold tracking-tight">Create personal access token</p>
            <div>
              <Label className="text-xs">Token name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="claude-desktop" className="h-10 border-border bg-secondary/50" />
            </div>
            <div>
              <Label className="text-xs">Scope mode</Label>
              <RadioGroup value={mode} onValueChange={(v) => setMode(v as typeof mode)} className="mt-1.5 space-y-2">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <RadioGroupItem value="full" /> Full — everything (dangerous)
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <RadioGroupItem value="read_only" /> Read-only — all *:read scopes
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <RadioGroupItem value="specific" /> Specific — pick below
                </label>
              </RadioGroup>
            </div>
            {mode === "specific" && (
              <div className="grid grid-cols-2 gap-1.5">
                {SCOPES.map((s) => (
                  <label key={s} className="flex items-center gap-2 text-xs cursor-pointer">
                    <Checkbox
                      checked={selected.includes(s)}
                      onCheckedChange={(v) => setSelected(v ? [...selected, s] : selected.filter((x) => x !== s))}
                      className="border-border"
                    />
                    {s}
                  </label>
                ))}
              </div>
            )}
            <div>
              <Label className="text-xs">Expires in days (0 = never)</Label>
              <Input type="number" value={expiryDays} onChange={(e) => setExpiryDays(e.target.value)} className="h-10 border-border bg-secondary/50" />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" className="press border-border bg-secondary/50 hover:bg-accent/60" onClick={() => setOpen(false)}>Cancel</Button>
              <Button size="sm" className="press bg-gradient-to-r from-[#14B8A6] to-[#0d9488] font-medium text-zinc-950 shadow-[0_0_16px_-4px_rgba(20,184,166,0.5)] hover:from-[#2DD4BF] hover:to-[#14B8A6]" onClick={create} disabled={!name.trim()}>
                Create token
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
