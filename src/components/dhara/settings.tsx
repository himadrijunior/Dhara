"use client";

import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { api, track } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Settings2, Sparkles, Plug, AlertTriangle, RefreshCw } from "lucide-react";

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

  useEffect(() => {
    track("settings.view");
    api<{ config: { storage?: { driver?: string; oci?: Record<string, string | boolean | null> } | null } | null }>("/api/setup")
      .then((d) => {
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
          Instance preferences — AI experience, storage drivers, and project options.
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
