"use client";

import { useStore } from "./store";

/**
 * Dhara — client API helper (H7, M13).
 *
 * The refresh token never touches localStorage: it lives in an HttpOnly cookie
 * scoped to /api/auth. The access token is held in module memory only (dies
 * with the tab). Silent refresh runs on 401 and on a 14-minute timer so the
 * 15-minute access TTL is invisible to the user.
 */

let accessToken: string | null = null;

const LEGACY_KEYS = ["ikl_access", "ikl_refresh"];

function purgeLegacy(): void {
  if (typeof window === "undefined") return;
  for (const k of LEGACY_KEYS) window.localStorage.removeItem(k);
}
purgeLegacy();

export function getTokens() {
  // refresh is cookie-held now; only the in-memory access token exists here
  return { access: accessToken, refresh: null };
}

/** Store the access token in memory. `null` signs the client out. */
export function setTokens(access: string | null): void {
  accessToken = access;
  if (!access) purgeLegacy();
}

export function clearAuth(): void {
  accessToken = null;
  purgeLegacy();
}

let refreshing: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  if (!refreshing) {
    refreshing = (async () => {
      try {
        // cookie carries the refresh token (HttpOnly) — no body needed
        const res = await fetch("/api/auth/refresh", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        });
        if (!res.ok) return false;
        const data = await res.json();
        accessToken = data.accessToken;
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

// M13: access TTL is 15 min — refresh proactively every 14 min while alive
if (typeof window !== "undefined") {
  setInterval(() => {
    if (accessToken) void tryRefresh();
  }, 14 * 60_000).unref?.();
}

export async function api<T = unknown>(
  path: string,
  opts: RequestInit & { skipAuth?: boolean } = {}
): Promise<T> {
  const buildHeaders = (): Headers => {
    const headers = new Headers(opts.headers);
    if (accessToken && !opts.skipAuth) headers.set("authorization", `Bearer ${accessToken}`);
    if (opts.body && !headers.has("content-type") && !(opts.body instanceof FormData)) {
      headers.set("content-type", "application/json");
    }
    return headers;
  };
  let res = await fetch(path, { ...opts, headers: buildHeaders() });
  if (res.status === 401 && !opts.skipAuth) {
    const okRefresh = await tryRefresh();
    if (okRefresh) {
      res = await fetch(path, { ...opts, headers: buildHeaders() });
    } else {
      clearAuth();
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
