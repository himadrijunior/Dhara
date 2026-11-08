"use client";

import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { api, clearAuth, track } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Settings2, Sparkles, Plug, AlertTriangle, RefreshCw, Mail, Send, KeyRound, Users } from "lucide-react";

/** Redacted admin config (GET /api/setup — platform admin only, config === null otherwise). */
interface AdminConfig {
  mail: {
    provider: "console" | "resend" | "smtp";
    from?: string;
    hasResendKey: boolean;
    hasSmtpCreds: boolean;
    smtpHost?: string;
    smtpPort?: number;
    smtpSecure?: boolean;
    smtpUser?: string;
  } | null;
  settings: { signup: "open" | "invite" | "closed" };
}

type MailProvider = "console" | "resend" | "smtp";
type SignupMode = "open" | "invite" | "closed";

export default function SettingsView() {
  const store = useStore();
  const [ociTenancy, setOciTenancy] = useState("");
  const [ociUser, setOciUser] = useState("");
  const [ociRegion, setOciRegion] = useState("");
  const [ociNamespace, setOciNamespace] = useState("");
  const [ociBucket, setOciBucket] = useState("");
  const [ociFingerprint, setOciFingerprint] = useState("");
  const [ociKey, setOciKey] = useState("");
  const [driver, setDriver] = useState<"local" | "oci">("local");
  const project = store.projects.find((p) => p.ID === store.activeProjectId);

  // email delivery (WS3) + signup policy — admin-only (config is null otherwise)
  const [adminConfig, setAdminConfig] = useState<AdminConfig | null>(null);
  const [mailProvider, setMailProvider] = useState<MailProvider>("console");
  const [mailFrom, setMailFrom] = useState("");
  const [resendKey, setResendKey] = useState("");
  const [hasResendKey, setHasResendKey] = useState(false);
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState("587");
  const [smtpSecure, setSmtpSecure] = useState(false);
  const [smtpUser, setSmtpUser] = useState("");
  const [smtpPass, setSmtpPass] = useState("");
  const [hasSmtpCreds, setHasSmtpCreds] = useState(false);
  const [testTo, setTestTo] = useState("");
  const [mailBusy, setMailBusy] = useState(false);
  const [signupMode, setSignupMode] = useState<SignupMode>("invite");

  // change password
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [pwBusy, setPwBusy] = useState(false);

  useEffect(() => {
    track("settings.view");
    api<{ config: (AdminConfig & { storage?: { driver?: string; oci?: Record<string, string | boolean | null> } | null }) | null }>("/api/setup")
      .then((d) => {
        setAdminConfig(d.config);
        const s = d.config?.storage;
        if (s?.driver) setDriver(s.driver as "local" | "oci");
        const oci = s?.oci as Record<string, string> | null;
        if (oci) {
          setOciTenancy(oci.tenancy ?? "");
          setOciUser(oci.user ?? "");
          setOciRegion(oci.region ?? "");
          setOciNamespace(oci.namespace ?? "");
          setOciBucket(oci.bucket ?? "");
        }
        const mail = d.config?.mail;
        if (mail) {
          setMailProvider(mail.provider ?? "console");
          setMailFrom(mail.from ?? "");
          setHasResendKey(!!mail.hasResendKey);
          setHasSmtpCreds(!!mail.hasSmtpCreds);
          setSmtpHost(mail.smtpHost ?? "");
          setSmtpPort(String(mail.smtpPort ?? 587));
          setSmtpSecure(!!mail.smtpSecure);
          setSmtpUser(mail.smtpUser ?? "");
        }
        if (d.config?.settings?.signup) setSignupMode(d.config.settings.signup);
      })
      .catch(() => undefined);
  }, []);

  return (
    <div className="stagger mx-auto w-full max-w-4xl space-y-5 p-4 sm:p-6 lg:p-8">
      <div>
        <h1 className="flex items-center gap-2.5 font-display text-2xl font-bold tracking-tight">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-brand-soft"><Settings2 className="h-4 w-4 text-brand" /></span> Settings
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Instance preferences — AI experience, email delivery, signup policy, storage drivers, and project options.
        </p>
      </div>

      {/* AI preferences */}
      <Card className="panel border-border shadow-none">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-ai/10"><Sparkles className="h-3.5 w-3.5 text-ai" /></span> AI Preferences
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Auto-organize navigation</p>
              <p className="text-xs text-muted-foreground">
                The sidebar re-orders itself and shows &quot;For you&quot; chips based on the features you use most.
              </p>
            </div>
            <Switch
              checked={store.autoOrganize}
              onCheckedChange={async (v) => {
                store.setAutoOrganize(v);
                try {
                  await api("/api/settings", { method: "POST", body: JSON.stringify({ autoOrganize: v }) });
                  toast.success(v ? "Auto-organize on" : "Auto-organize off");
                } catch {
                  toast.error("Failed to save");
                }
              }}
            />
          </div>
          <Button
            size="sm"
            variant="outline"
            className="press gap-1.5 border-border bg-secondary/50 hover:bg-accent/60"
            onClick={async () => {
              try {
                await api("/api/usage/reset", { method: "POST" });
                store.setUsage({});
                toast.success("Usage data reset");
              } catch {
                toast.error("Failed");
              }
            }}
          >
            <RefreshCw className="w-3.5 h-3.5" /> Reset usage data
          </Button>
        </CardContent>
      </Card>

      {/* Email delivery (WS3) — admin only */}
      {adminConfig && (
        <Card className="panel border-border shadow-none">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-brand-soft"><Mail className="h-3.5 w-3.5 text-brand" /></span> Email delivery
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs leading-relaxed text-muted-foreground">
              Transactional email (verification, password reset, invites). Add SPF + DKIM + DMARC records for
              your domain — see <code className="font-mono text-brand">docs/08-email.md</code>. Free tiers:
              Resend 3,000/mo · OCI Email Delivery 1,000/day (SMTP).
            </p>
            <div className="flex flex-wrap gap-2">
              {(["console", "resend", "smtp"] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => setMailProvider(p)}
                  className={`press rounded-lg border px-4 py-2 text-sm transition-colors ${
                    mailProvider === p ? "border-brand/40 bg-brand-soft text-brand" : "border-border text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                  }`}
                >
                  {p === "console" ? "Console (log only)" : p === "resend" ? "Resend API" : "SMTP"}
                </button>
              ))}
            </div>
            <div>
              <Label className="text-xs">From</Label>
              <Input
                value={mailFrom}
                onChange={(e) => setMailFrom(e.target.value)}
                placeholder="Dhara <no-reply@yourdomain.com>"
                className="h-10 border-border bg-secondary/50 text-xs"
              />
            </div>
            {mailProvider === "resend" && (
              <div>
                <Label className="text-xs">Resend API key</Label>
                <Input
                  type="password"
                  value={resendKey}
                  onChange={(e) => setResendKey(e.target.value)}
                  placeholder={hasResendKey ? "[stored]" : "re_…"}
                  autoComplete="off"
                  className="h-10 border-border bg-secondary/50 text-xs"
                />
              </div>
            )}
            {mailProvider === "smtp" && (
              <>
                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">SMTP host</Label>
                    <Input value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} placeholder="smtp.email.us-ashburn-1.oci.oraclecloud.com" className="h-10 border-border bg-secondary/50 text-xs" />
                  </div>
                  <div>
                    <Label className="text-xs">Port</Label>
                    <Input value={smtpPort} onChange={(e) => setSmtpPort(e.target.value)} inputMode="numeric" placeholder="587" className="h-10 border-border bg-secondary/50 text-xs" />
                  </div>
                  <div>
                    <Label className="text-xs">SMTP user</Label>
                    <Input value={smtpUser} onChange={(e) => setSmtpUser(e.target.value)} placeholder="ocid1.user.oc1..…/youruser@tenancy" className="h-10 border-border bg-secondary/50 text-xs" />
                  </div>
                  <div>
                    <Label className="text-xs">SMTP password</Label>
                    <Input
                      type="password"
                      value={smtpPass}
                      onChange={(e) => setSmtpPass(e.target.value)}
                      placeholder={hasSmtpCreds ? "[stored]" : "SMTP auth password"}
                      autoComplete="new-password"
                      className="h-10 border-border bg-secondary/50 text-xs"
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium">Use TLS/SSL (implicit, port 465)</p>
                    <p className="text-xs text-muted-foreground">Off = STARTTLS upgrade on a plain connection (587).</p>
                  </div>
                  <Switch checked={smtpSecure} onCheckedChange={setSmtpSecure} />
                </div>
              </>
            )}
            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
              <Button
                size="sm"
                disabled={mailBusy}
                className="press bg-gradient-to-r from-[#14B8A6] to-[#0d9488] font-medium text-zinc-950 shadow-[0_0_16px_-4px_rgba(20,184,166,0.5)] hover:from-[#2DD4BF] hover:to-[#14B8A6]"
                onClick={async () => {
                  setMailBusy(true);
                  try {
                    const d = await api<{ ok: boolean; config: AdminConfig | null }>("/api/setup", {
                      method: "PATCH",
                      body: JSON.stringify({
                        mail: {
                          provider: mailProvider,
                          from: mailFrom || undefined,
                          ...(mailProvider === "resend" && resendKey ? { resendApiKey: resendKey } : {}),
                          ...(mailProvider === "smtp"
                            ? {
                                smtp: {
                                  host: smtpHost,
                                  port: Number(smtpPort) || 587,
                                  secure: smtpSecure,
                                  user: smtpUser || undefined,
                                  ...(smtpPass ? { pass: smtpPass } : {}),
                                },
                              }
                            : {}),
                        },
                      }),
                    });
                    setHasResendKey(!!d.config?.mail?.hasResendKey);
                    setHasSmtpCreds(!!d.config?.mail?.hasSmtpCreds);
                    setResendKey("");
                    setSmtpPass("");
                    toast.success("Email settings saved");
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "Failed");
                  } finally {
                    setMailBusy(false);
                  }
                }}
              >
                Save email settings
              </Button>
              <Input
                value={testTo}
                onChange={(e) => setTestTo(e.target.value)}
                placeholder="you@example.com"
                className="h-9 w-44 border-border bg-secondary/50 text-xs"
                aria-label="Test email recipient"
              />
              <Button
                size="sm"
                variant="outline"
                disabled={mailBusy || !testTo}
                className="press gap-1.5 border-border bg-secondary/50 hover:bg-accent/60"
                onClick={async () => {
                  try {
                    await api("/api/setup/mail/test", { method: "POST", body: JSON.stringify({ to: testTo }) });
                    toast.success(`Test email sent to ${testTo}`);
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "Test email failed");
                  }
                }}
              >
                <Send className="h-3.5 w-3.5" /> Send test email
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Signup policy — admin only */}
      {adminConfig && (
        <Card className="panel border-border shadow-none">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-brand-soft"><Users className="h-3.5 w-3.5 text-brand" /></span> Signup policy
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {(["open", "invite", "closed"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setSignupMode(m)}
                  className={`press rounded-lg border px-4 py-2 text-sm capitalize transition-colors ${
                    signupMode === m ? "border-brand/40 bg-brand-soft text-brand" : "border-border text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {signupMode === "open"
                ? "Open — anyone can register on the landing page."
                : signupMode === "invite"
                  ? "Invite — only users with an emailed invite token can register."
                  : "Closed — no new signups; existing users only."}
            </p>
            <Button
              size="sm"
              variant="outline"
              className="press border-border bg-secondary/50 hover:bg-accent/60"
              onClick={async () => {
                try {
                  await api("/api/setup", { method: "PATCH", body: JSON.stringify({ settings: { signup: signupMode } }) });
                  toast.success(`Signup policy set to ${signupMode}`);
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Failed");
                }
              }}
            >
              Save signup policy
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Storage driver */}
      <Card className="panel border-border shadow-none">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-brand-soft"><Plug className="h-3.5 w-3.5 text-brand" /></span> Storage driver
            <Badge variant="outline" className="text-[10px] border-warning/30 bg-warning/10 text-warning">OCI upcoming</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            {(["local", "oci"] as const).map((d) => (
              <button
                key={d}
                onClick={() => setDriver(d)}
                className={`press rounded-lg border px-4 py-2 text-sm transition-colors ${
                  driver === d ? "border-brand/40 bg-brand-soft text-brand" : "border-border text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                }`}
              >
                {d === "local" ? "Local disk (active)" : "OCI Object Storage"}
              </button>
            ))}
          </div>
          {driver === "oci" && (
            <div className="grid sm:grid-cols-2 gap-3">
              <div><Label className="text-xs">Tenancy OCID</Label><Input value={ociTenancy} onChange={(e) => setOciTenancy(e.target.value)} className="h-10 border-border bg-secondary/50 text-xs" placeholder="ocid1.tenancy.oc1.." /></div>
              <div><Label className="text-xs">User OCID</Label><Input value={ociUser} onChange={(e) => setOciUser(e.target.value)} className="h-10 border-border bg-secondary/50 text-xs" placeholder="ocid1.user.oc1.." /></div>
              <div><Label className="text-xs">Region</Label><Input value={ociRegion} onChange={(e) => setOciRegion(e.target.value)} className="h-10 border-border bg-secondary/50 text-xs" placeholder="us-ashburn-1" /></div>
              <div><Label className="text-xs">Namespace</Label><Input value={ociNamespace} onChange={(e) => setOciNamespace(e.target.value)} className="h-10 border-border bg-secondary/50 text-xs" /></div>
              <div><Label className="text-xs">Bucket</Label><Input value={ociBucket} onChange={(e) => setOciBucket(e.target.value)} className="h-10 border-border bg-secondary/50 text-xs" /></div>
              <div><Label className="text-xs">Fingerprint</Label><Input value={ociFingerprint} onChange={(e) => setOciFingerprint(e.target.value)} className="h-10 border-border bg-secondary/50 text-xs" placeholder="aa:bb:…" /></div>
              <div className="sm:col-span-2">
                <Label className="text-xs">Private key (PEM)</Label>
                <textarea value={ociKey} onChange={(e) => setOciKey(e.target.value)} rows={3} className="w-full rounded-md border border-border bg-secondary/50 p-2 font-mono text-[10px]" placeholder="-----BEGIN PRIVATE KEY-----" />
              </div>
              <Button
                className="press bg-gradient-to-r from-[#14B8A6] to-[#0d9488] font-medium text-zinc-950 shadow-[0_0_16px_-4px_rgba(20,184,166,0.5)] hover:from-[#2DD4BF] hover:to-[#14B8A6] sm:col-span-2"
                onClick={async () => {
                  try {
                    await api("/api/settings/storage", {
                      method: "POST",
                      body: JSON.stringify({
                        driver: "oci",
                        oci: {
                          tenancy: ociTenancy, user: ociUser, region: ociRegion, namespace: ociNamespace,
                          bucket: ociBucket, fingerprint: ociFingerprint, ...(ociKey ? { privateKey: ociKey } : {}),
                        },
                      }),
                    });
                    toast.success("OCI storage config saved");
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "Failed");
                  }
                }}
              >
                Save OCI config
              </Button>
            </div>
          )}
          {driver === "local" && (
            <Button
              size="sm"
              variant="outline"
              className="press border-border bg-secondary/50 hover:bg-accent/60"
              onClick={async () => {
                try {
                  await api("/api/settings/storage", { method: "POST", body: JSON.stringify({ driver: "local" }) });
                  toast.success("Driver set to local");
                } catch {
                  toast.error("Failed");
                }
              }}
            >
              Use local driver
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Change password (local accounts) */}
      <Card className="panel border-border shadow-none">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-brand-soft"><KeyRound className="h-3.5 w-3.5 text-brand" /></span> Change password
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-xs">Current password</Label>
              <Input
                type="password"
                value={currentPw}
                onChange={(e) => setCurrentPw(e.target.value)}
                autoComplete="current-password"
                className="h-10 border-border bg-secondary/50 text-xs"
              />
            </div>
            <div>
              <Label className="text-xs">New password <span className="text-muted-foreground">(min 12 chars)</span></Label>
              <Input
                type="password"
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
                autoComplete="new-password"
                className="h-10 border-border bg-secondary/50 text-xs"
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              size="sm"
              variant="outline"
              disabled={pwBusy || !currentPw || newPw.length < 12}
              className="press border-border bg-secondary/50 hover:bg-accent/60"
              onClick={async () => {
                setPwBusy(true);
                try {
                  await api("/api/auth/change-password", {
                    method: "POST",
                    body: JSON.stringify({ currentPassword: currentPw, newPassword: newPw }),
                  });
                  toast.success("Password changed — sign in again");
                  clearAuth();
                  store.setUser(null);
                  window.location.reload();
                } catch (e) {
                  // Google-only accounts have no password to change — the server explains
                  toast.error(e instanceof Error ? e.message : "Failed");
                } finally {
                  setPwBusy(false);
                }
              }}
            >
              Update password
            </Button>
            <p className="text-[11px] text-muted-foreground">
              Changing your password signs out every session. Google-only accounts have no password to change.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Project settings */}
      {project && (
        <Card className="panel border-border shadow-none">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Project: {project.NAME}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Auto table creation</p>
                <p className="text-xs text-muted-foreground">POST JSON to the Data API and the table is created automatically (Firebase-style).</p>
              </div>
              <Switch
                checked={Number(project.AUTO_CREATE_TABLES) === 1}
                onCheckedChange={async (v) => {
                  try {
                    await api(`/api/projects/${project.ID}`, { method: "PATCH", body: JSON.stringify({ autoCreateTables: v }) });
                    const list = await api<{ projects: never[] }>("/api/projects");
                    store.setProjects(list.projects);
                    toast.success(v ? "Auto table creation on" : "off");
                  } catch {
                    toast.error("Failed");
                  }
                }}
              />
            </div>
            <div className="border-t border-border pt-3">
              <p className="flex items-center gap-1.5 text-sm font-medium text-danger">
                <AlertTriangle className="w-4 h-4" /> Danger zone
              </p>
              <div className="flex flex-wrap gap-2 mt-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="press border-danger/30 text-danger hover:bg-danger/10"
                  onClick={async () => {
                    if (!confirm(`Delete project "${project.NAME}" and ALL its tables? This cannot be undone.`)) return;
                    try {
                      await api(`/api/projects/${project.ID}`, { method: "DELETE" });
                      const list = await api<{ projects: never[] }>("/api/projects");
                      store.setProjects(list.projects);
                      store.navigate("home");
                      toast.success("Project deleted");
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : "Failed");
                    }
                  }}
                >
                  Delete project
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="press border-danger/30 text-danger hover:bg-danger/10"
                  onClick={async () => {
                    if (!confirm("Disconnect Oracle and wipe stored credentials?")) return;
                    try {
                      await api("/api/setup", { method: "DELETE" });
                      window.location.reload();
                    } catch {
                      toast.error("Failed");
                    }
                  }}
                >
                  Disconnect Oracle
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
