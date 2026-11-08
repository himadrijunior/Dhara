"use client";

import { useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { api, track, fmtBytes } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { HardDrive, Upload, Trash2, FolderPlus, FolderOpen, Copy, Clock } from "lucide-react";

interface Bucket { ID: string; NAME: string; IS_PUBLIC: number; DRIVER: string; CREATED_AT?: string }
interface Obj { name: string; size: number; timeCreated?: string; url?: string }

export default function StorageView() {
  const store = useStore();
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [objects, setObjects] = useState<Obj[]>([]);
  const [newBucket, setNewBucket] = useState("");
  const [uploadPath, setUploadPath] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const loadBuckets = async () => {
    try {
      const d = await api<{ buckets: Bucket[] }>(`/api/projects/${store.activeProjectId}/storage?buckets=1`);
      setBuckets(d.buckets ?? []);
      if (!active && d.buckets?.length) setActive(d.buckets[0].NAME);
    } catch {
      setBuckets([]);
    }
  };

  const loadObjects = async () => {
    if (!active) return;
    try {
      const d = await api<{ objects: Obj[] }>(`/api/projects/${store.activeProjectId}/storage?bucket=${active}`);
      setObjects(d.objects ?? []);
    } catch {
      setObjects([]);
    }
  };

  useEffect(() => {
    track("storage.view");
    void loadBuckets();
     
  }, [store.activeProjectId]);

  useEffect(() => {
    void loadObjects();
     
  }, [active]);

  async function upload(file: File) {
    if (!active) return toast.error("Create/select a bucket first");
    const form = new FormData();
    form.append("bucket", active);
    form.append("path", uploadPath ? `${uploadPath}/${file.name}` : file.name);
    form.append("file", file);
    try {
      const res = await fetch(`/api/projects/${store.activeProjectId}/storage`, { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Upload failed");
      toast.success(`Uploaded (${data.driver})`);
      setUploadPath("");
      await loadObjects();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    }
  }

  return (
    <div className="stagger mx-auto w-full max-w-6xl space-y-5 p-4 sm:p-6 lg:p-8">
      <div className="flex flex-wrap items-center gap-2">
        <div>
          <h1 className="flex items-center gap-2.5 font-display text-2xl font-bold tracking-tight">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-brand-soft"><HardDrive className="h-4 w-4 text-brand" /></span> Storage
            <Badge variant="outline" className="border-warning/30 bg-warning/10 text-[10px] text-warning">Beta · OCI upcoming</Badge>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Backend fully wired: local driver active now, <strong>OCI Object Storage</strong> driver ready (signed
            requests) — flip the driver in Settings → Storage when your Oracle Cloud bucket is ready.
          </p>
        </div>
      </div>

      {/* Buckets */}
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <Label className="text-xs">New bucket</Label>
          <Input value={newBucket} onChange={(e) => setNewBucket(e.target.value)} placeholder="uploads" className="h-10 w-48 border-border bg-secondary/50" />
        </div>
        <Button
          className="press h-10 gap-1 bg-gradient-to-r from-[#14B8A6] to-[#0d9488] font-medium text-zinc-950 shadow-[0_0_16px_-4px_rgba(20,184,166,0.5)] hover:from-[#2DD4BF] hover:to-[#14B8A6]"
          onClick={async () => {
            try {
              await api(`/api/projects/${store.activeProjectId}/storage`, {
                method: "POST",
                body: JSON.stringify({ action: "createBucket", name: newBucket }),
              });
              toast.success("Bucket created");
              setNewBucket("");
              await loadBuckets();
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Failed");
            }
          }}
        >
          <FolderPlus className="w-4 h-4" /> Create
        </Button>
        <div className="flex gap-1.5 flex-wrap">
          {buckets.map((b) => (
            <button
              key={b.ID}
              onClick={() => setActive(b.NAME)}
              className={`press min-h-[32px] rounded-full border px-3 py-1.5 text-xs transition-colors ${
                active === b.NAME ? "border-brand/40 bg-brand-soft text-brand" : "border-border text-muted-foreground hover:bg-accent/60 hover:text-foreground"
              }`}
            >
              {b.NAME} {Number(b.IS_PUBLIC) === 1 ? "· public" : ""}
            </button>
          ))}
        </div>
      </div>

      {/* Upload */}
      {active && (
        <div className="panel flex flex-wrap items-end gap-2 p-4">
          <div className="flex-1 min-w-40">
            <Label className="text-xs">Path prefix (optional)</Label>
            <Input value={uploadPath} onChange={(e) => setUploadPath(e.target.value)} placeholder="images/2026" className="h-10 border-border bg-secondary/50" />
          </div>
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
              e.target.value = "";
            }}
          />
          <Button className="press h-10 gap-1.5 bg-gradient-to-r from-[#14B8A6] to-[#0d9488] font-medium text-zinc-950 shadow-[0_0_16px_-4px_rgba(20,184,166,0.5)] hover:from-[#2DD4BF] hover:to-[#14B8A6]" onClick={() => fileRef.current?.click()}>
            <Upload className="w-4 h-4" /> Upload file
          </Button>
        </div>
      )}

      {/* Objects */}
      <div className="panel overflow-hidden">
        {objects.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-dashed border-border bg-secondary/40">
              <FolderOpen className="h-6 w-6 text-muted-foreground" />
            </span>
            <p className="text-sm font-medium">{active ? "Bucket is empty." : "Select or create a bucket."}</p>
            <p className="text-xs text-muted-foreground">{active ? "Upload your first file to see it listed here." : "Create a bucket above, then select it to browse its objects."}</p>
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-secondary/40">
              <tr className="text-left text-muted-foreground">
                <th className="px-3 py-2.5">Object</th>
                <th className="px-3 py-2.5">Size</th>
                <th className="px-3 py-2.5">Created</th>
                <th className="px-3 py-2.5 w-20" />
              </tr>
            </thead>
            <tbody>
              {objects.map((o) => (
                <tr key={o.name} className="border-t border-border/60 transition-colors hover:bg-accent/30">
                  <td className="max-w-72 truncate px-3 py-2 font-mono text-foreground/90">{o.name}</td>
                  <td className="px-3 py-2 text-muted-foreground tabular">{fmtBytes(o.size)}</td>
                  <td className="flex items-center gap-1 px-3 py-2 text-muted-foreground tabular">
                    <Clock className="w-3 h-3" /> {o.timeCreated ? new Date(o.timeCreated).toLocaleDateString() : "—"}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {o.url && (
                      <button className="press p-1.5 text-muted-foreground transition-colors hover:text-brand" aria-label="Copy URL" onClick={() => { navigator.clipboard.writeText(`${window.location.origin}${o.url}`); toast.success("Signed URL copied"); }}>
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button
                      className="press p-1.5 text-muted-foreground transition-colors hover:text-danger"
                      aria-label="Delete object"
                      onClick={async () => {
                        if (!confirm(`Delete ${o.name}?`)) return;
                        await api(`/api/projects/${store.activeProjectId}/storage?bucket=${active}&path=${encodeURIComponent(o.name)}`, { method: "DELETE" });
                        toast.success("Deleted");
                        await loadObjects();
                      }}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
