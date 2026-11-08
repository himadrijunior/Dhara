"use client";

import { useState } from "react";
import { useStore } from "@/lib/store";
import { api } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { FolderPlus } from "lucide-react";
import { DharaLoader } from "@/components/dhara/brand";

const PROJECT_COLORS = ["#14B8A6", "#F5A623", "#A78BFA", "#38BDF8", "#F472B6", "#F87171"];

/** Proper project-creation dialog (replaces the old window.prompt). */
export function NewProjectDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const store = useStore();
  const [name, setName] = useState("");
  const [color, setColor] = useState(PROJECT_COLORS[0]);
  const [busy, setBusy] = useState(false);

  async function create() {
    if (!name.trim()) return toast.error("Project name is required");
    setBusy(true);
    try {
      const d = await api<{ project: { ID: string } }>("/api/projects", {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), color }),
      });
      const list = await api<{ projects: never[] }>("/api/projects");
      store.setProjects(list.projects);
      store.setActiveProject(d.project.ID);
      toast.success(`Project "${name.trim()}" created`);
      setName("");
      setColor(PROJECT_COLORS[0]);
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create project");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="panel max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-soft">
              <FolderPlus className="h-4 w-4 text-brand" />
            </span>
            New project
          </DialogTitle>
          <DialogDescription>
            Each project gets isolated tables, keys, policies and realtime config.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="np-name" className="text-xs font-medium text-muted-foreground">
              Project name
            </Label>
            <Input
              id="np-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-app"
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && create()}
              className="h-10"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Color tag</Label>
            <div className="flex gap-2">
              {PROJECT_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Color ${c}`}
                  onClick={() => setColor(c)}
                  className={`h-7 w-7 rounded-full press transition-transform ${
                    color === c ? "ring-2 ring-ring ring-offset-2 ring-offset-background scale-110" : ""
                  }`}
                  style={{ background: c }}
                />
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={create} disabled={busy} className="gap-1.5 font-medium">
            {busy ? <DharaLoader size={16} label="Creating project" /> : <FolderPlus className="h-4 w-4" />}
            Create project
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
