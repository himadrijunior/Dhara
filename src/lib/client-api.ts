"use client";

import { useStore } from "./store";

/** Dhara — client API helper with token refresh + usage tracking. */

const LS_ACCESS = "ikl_access";
const LS_REFRESH = "ikl_refresh";

export function getTokens() {
  if (typeof window === "undefined") return { access: null, refresh: null };
  return {
    access: localStorage.getItem(LS_ACCESS),
    refresh: localStorage.getItem(LS_REFRESH),
  };
}

export function setTokens(access: string | null, refresh?: string | null) {
  if (typeof window === "undefined") return;
  if (access) localStorage.setItem(LS_ACCESS, access);
  if (refresh) localStorage.setItem(LS_REFRESH, refresh);
  if (access === null) {
    localStorage.removeItem(LS_ACCESS);
    localStorage.removeItem(LS_REFRESH);
  }
}

let refreshing: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  if (!refreshing) {
    refreshing = (async () => {
      const { refresh } = getTokens();
      if (!refresh) return false;
      try {
        const res = await fetch("/api/auth/refresh", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ refreshToken: refresh }),
        });
        if (!res.ok) return false;
        const data = await res.json();
        setTokens(data.accessToken, data.refreshToken);
        useStore.getState().setUser(data.user);
        return true;
      } catch {
        return false;
      } finally {
        setTimeout(() => (refreshing = null), 100);
      }
    })();
  }
  return refreshing;
}

export async function api<T = unknown>(
  path: string,
  opts: RequestInit & { skipAuth?: boolean } = {}
): Promise<T> {
  const { access } = getTokens();
  const headers = new Headers(opts.headers);
  if (access && !opts.skipAuth) headers.set("authorization", `Bearer ${access}`);
  if (opts.body && !headers.has("content-type") && !(opts.body instanceof FormData)) {
    headers.set("content-type", "application/json");
  }
  let res = await fetch(path, { ...opts, headers });
  if (res.status === 401 && !opts.skipAuth) {
    const okRefresh = await tryRefresh();
    if (okRefresh) {
      const retryHeaders = new Headers(opts.headers);
      const { access: a2 } = getTokens();
      if (a2) retryHeaders.set("authorization", `Bearer ${a2}`);
      if (opts.body && !retryHeaders.has("content-type") && !(opts.body instanceof FormData)) {
        retryHeaders.set("content-type", "application/json");
      }
      res = await fetch(path, { ...opts, headers: retryHeaders });
    } else {
      setTokens(null);
      useStore.getState().setUser(null);
    }
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new Error(data?.error ?? `Request failed (${res.status})`);
  }
  return data;
}

/** Fire-and-forget usage tracking (AI auto-nav). */
export function track(feature: string) {
  void api("/api/usage", {
    method: "POST",
    body: JSON.stringify({ feature }),
  }).catch(() => undefined);
}

export function fmtBytes(n: number): string {
  if (!n) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  return `${(n / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function fmtNum(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return new Intl.NumberFormat("en-US").format(n);
}
