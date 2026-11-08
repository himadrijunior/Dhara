"use client";

import { create } from "zustand";

/** Dhara — client-side SPA state (zustand). */

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: string;
  avatarColor: string | null;
}

export interface Project {
  ID: string;
  NAME: string;
  DESCRIPTION: string | null;
  COLOR: string | null;
  AUTO_CREATE_TABLES: number;
  CREATED_AT?: string;
}

export interface TableMeta {
  ID: string;
  PROJECT_ID: string;
  NAME: string;
  PHYSICAL: string;
  columns: {
    name: string;
    type: string;
    pk?: boolean;
    required?: boolean;
    unique?: boolean;
    defaultValue?: string | null;
  }[];
  REALTIME: number;
  REALTIME_EVENTS: string;
  CREATED_AT?: string;
  rowCount?: number | null;
}

export type ViewId =
  | "home"
  | "tables"
  | "table"
  | "sql"
  | "auth"
  | "api"
  | "storage"
  | "mcp"
  | "pats"
  | "settings";

interface DharaState {
  booted: boolean;
  configured: boolean;
  connected: boolean;
  banner: string;
  hasUsers: boolean;
  user: SessionUser | null;
  projects: Project[];
  activeProjectId: string | null;
  view: ViewId;
  activeTable: string | null;
  autoOrganize: boolean;
  usage: Record<string, number>;
  sidebarOpen: boolean;

  setBoot: (v: Partial<DharaState>) => void;
  setUser: (u: SessionUser | null) => void;
  setProjects: (p: Project[]) => void;
  setActiveProject: (id: string | null) => void;
  navigate: (view: ViewId, table?: string | null) => void;
  setAutoOrganize: (v: boolean) => void;
  setUsage: (u: Record<string, number>) => void;
  toggleSidebar: () => void;
}

export const useStore = create<DharaState>((set) => ({
  booted: false,
  configured: false,
  connected: false,
  banner: "",
  hasUsers: false,
  user: null,
  projects: [],
  activeProjectId: null,
  view: "home",
  activeTable: null,
  autoOrganize: true,
  usage: {},
  sidebarOpen: false,

  setBoot: (v) => set({ ...v, booted: true }),
  setUser: (u) => set({ user: u }),
  setProjects: (p) =>
    set((s) => ({
      projects: p,
      activeProjectId:
        s.activeProjectId && p.some((x) => x.ID === s.activeProjectId)
          ? s.activeProjectId
          : (p[0]?.ID ?? null),
    })),
  setActiveProject: (id) => set({ activeProjectId: id }),
  navigate: (view, table) =>
    set((s) => ({
      view,
      activeTable: table !== undefined ? table : view === "table" ? s.activeTable : null,
      sidebarOpen: false,
    })),
  setAutoOrganize: (v) => set({ autoOrganize: v }),
  setUsage: (u) => set({ usage: u }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
}));
