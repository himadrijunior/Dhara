"use client";

import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { api, track } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Users, ShieldCheck, Plus, Trash2, UserPlus, Copy, Mail } from "lucide-react";

interface U { id: string; email: string; name: string; role: string; avatarColor: string | null }

export default function AuthUsers() {
  const store = useStore();
  const [users, setUsers] = useState<U[]>([]);
  const [googleId, setGoogleId] = useState("");
  const [googleSecret, setGoogleSecret] = useState("");
  const [saving, setSaving] = useState(false);

  // invites (admin only — H5 invite-only signup)
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"member" | "admin">("member");
  const [inviting, setInviting] = useState(false);
  const [inviteResult, setInviteResult] = useState<{ link: string; token: string } | null>(null);
  const isAdmin = store.user?.role === "owner" || store.user?.role === "admin";

  async function sendInvite() {
    setInviting(true);
    try {
      const d = await api<{ ok: boolean; inviteToken: string; link: string }>("/api/auth/invite", {
        method: "POST",
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });
      setInviteResult({ link: d.link, token: d.inviteToken });
      setInviteEmail("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Invite failed");
    } finally {
      setInviting(false);
    }
  }

  useEffect(() => {
    track("auth.view");
    api<{ users: U[] }>("/api/auth/users").then((d) => setUsers(d.users ?? [])).catch(() => undefined);
    api<{ config: { oauth?: { google?: { clientId?: string } | null } } | null }>("/api/setup")
      .then((d) => setGoogleId(d.config?.oauth?.google?.clientId ?? ""))
      .catch(() => undefined);
  }, []);

  return (
    <div className="stagger mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
      <div>
        <h1 className="flex items-center gap-2.5 font-display text-2xl font-bold tracking-tight">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-brand-soft"><Users className="h-4 w-4 text-brand" /></span>
          Authentication
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Email+password · JWT (24h access / 30d refresh) · Google OAuth · API keys · PATs — Supabase-style
        </p>
      </div>

      <Card className="panel border-border shadow-none">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm tabular">Platform users ({users.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-xs">
              <thead className="bg-secondary/40">
                <tr className="text-left text-muted-foreground">
                  <th className="px-3 py-2.5">User</th>
                  <th className="px-3 py-2.5">Role</th>
                  <th className="px-3 py-2.5">Provider</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-t border-border/60 transition-colors hover:bg-accent/30">
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold text-zinc-950" style={{ background: u.avatarColor ?? "var(--brand)" }}>
                          {u.name.slice(0, 1).toUpperCase()}
                        </span>
                        <div>
                          <p className="text-foreground">{u.name}</p>
                          <p className="text-[10px] text-muted-foreground">{u.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant="outline" className={`text-[10px] ${u.role === "owner" ? "border-brand/25 bg-brand-soft text-brand" : "border-border text-muted-foreground"}`}>{u.role}</Badge>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">password</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Invite user (admin only) */}
      {isAdmin && (
        <Card className="panel border-border shadow-none">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-brand-soft"><UserPlus className="h-3.5 w-3.5 text-brand" /></span> Invite user
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Sends a single-use, 7-day invite bound to the email. Needed for signup when the instance is invite-only.
            </p>
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-56 flex-1">
                <Label className="text-xs">Email</Label>
                <Input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="newmember@example.com"
                  className="h-10 border-border bg-secondary/50 text-xs"
                />
              </div>
              <div>
                <Label className="text-xs">Role</Label>
                <div className="flex gap-1.5">
                  {(["member", "admin"] as const).map((r) => (
                    <button
                      key={r}
                      onClick={() => setInviteRole(r)}
                      className={`press rounded-lg border px-3 py-2 text-xs capitalize transition-colors ${
                        inviteRole === r ? "border-brand/40 bg-brand-soft text-brand" : "border-border text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                      }`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>
              <Button
                onClick={sendInvite}
                disabled={inviting || !inviteEmail}
                className="press h-10 gap-1.5 bg-gradient-to-r from-[#14B8A6] to-[#0d9488] text-sm font-medium text-zinc-950 shadow-[0_0_16px_-4px_rgba(20,184,166,0.5)] hover:from-[#2DD4BF] hover:to-[#14B8A6]"
              >
                <UserPlus className="h-4 w-4" /> Invite user
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="panel border-border shadow-none">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-brand-soft"><ShieldCheck className="h-3.5 w-3.5 text-brand" /></span> Google OAuth configuration
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Google Cloud Console → Credentials → OAuth Client ID. Redirect URI:{" "}
            <code className="text-brand">{typeof window !== "undefined" ? `${window.location.origin}/api/auth/oauth/google/callback` : ""}</code>
          </p>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Client ID</Label>
              <Input value={googleId} onChange={(e) => setGoogleId(e.target.value)} placeholder="xxxx.apps.googleusercontent.com" className="h-10 border-border bg-secondary/50 text-sm" />
            </div>
            <div>
              <Label className="text-xs">Client secret</Label>
              <Input type="password" value={googleSecret} onChange={(e) => setGoogleSecret(e.target.value)} placeholder={googleId ? "saved (type to replace)" : "GOCSPX-…"} className="h-10 border-border bg-secondary/50 text-sm" />
            </div>
          </div>
          <Button
            className="press bg-gradient-to-r from-[#14B8A6] to-[#0d9488] font-medium text-zinc-950 shadow-[0_0_16px_-4px_rgba(20,184,166,0.5)] hover:from-[#2DD4BF] hover:to-[#14B8A6]"
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              try {
                await api("/api/settings", {
                  method: "POST",
                  body: JSON.stringify({ oauth: { google: { ...(googleId ? { clientId: googleId } : {}), ...(googleSecret ? { clientSecret: googleSecret } : {}) } } }),
                });
                toast.success("OAuth config saved");
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Failed");
              } finally {
                setSaving(false);
              }
            }}
          >
            <Plus className="w-4 h-4 mr-1" /> Save OAuth config
          </Button>
        </CardContent>
      </Card>

      {/* Invite result — share the link manually when no mail provider is configured */}
      <Dialog open={!!inviteResult} onOpenChange={(v) => (!v ? setInviteResult(null) : undefined)}>
        <DialogContent className="max-w-md border-border bg-popover">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-brand-soft"><Mail className="h-3.5 w-3.5 text-brand" /></span>
              Invitation ready
            </DialogTitle>
            <DialogDescription className="text-xs leading-relaxed text-muted-foreground">
              The invitation email is sent automatically when a mail provider is configured (Settings → Email).
              Otherwise share the link below manually — it is single-use and expires in 7 days.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Input
              readOnly
              value={inviteResult?.link ?? ""}
              className="h-9 flex-1 border-border bg-secondary/50 font-mono text-[11px]"
              onFocus={(e) => e.target.select()}
            />
            <Button
              size="sm"
              variant="outline"
              className="h-9 shrink-0 gap-1.5 border-border bg-secondary/50 hover:bg-accent/60"
              onClick={() => {
                if (!inviteResult) return;
                navigator.clipboard.writeText(inviteResult.link).then(
                  () => toast.success("Invite link copied"),
                  () => toast.error("Copy failed")
                );
              }}
            >
              <Copy className="h-3.5 w-3.5" /> Copy
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
