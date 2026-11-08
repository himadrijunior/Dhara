"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Database,
  Zap,
  ShieldCheck,
  Radio,
  KeyRound,
  Boxes,
  CircleCheck,
  CircleX,
  Mail,
  Upload,
  ArrowRight,
  Terminal,
  Lock,
  Github,
  Star,
  Table2,
} from "lucide-react";
import { api, setTokens } from "@/lib/client-api";
import { useStore, type SessionUser } from "@/lib/store";
import { DharaLogo, DharaLoader, DharaLayerPath } from "@/components/dhara/brand";

/**
 * Dhara — Landing + Setup Wizard.
 * Design language: minimal, mono-first developer tool (Linear/Vercel school).
 * Monochrome logo · teal reserved for actions/status · lines instead of cards ·
 * one animation: the three logo layers cascade on page load.
 */

interface SetupResponse {
  ok: boolean;
  banner?: string;
  error?: string;
}

/** Email-action / OAuth deep links captured by page.tsx before the hash-sync effect. */
export type LandingRoute =
  | { kind: "oauth"; code: string }
  | { kind: "reset"; token: string }
  | { kind: "verify"; token: string }
  | { kind: "signup"; invite: string; email: string };

type AuthTab = "connect" | "signup" | "login";
type SignupModeState = "open" | "invite" | "closed" | null;

/* Shared button styles (used by the wizard tabs and the reset/verify cards) */
const primaryBtn =
  "press h-11 w-full bg-primary text-[14px] font-semibold text-primary-foreground hover:bg-primary-hover";
const ghostBtn =
  "h-11 w-full border-border bg-card text-[14px] font-medium text-foreground hover:bg-accent";

const GENERIC_RESET_MSG =
  "If that email is registered, a password-reset link has been sent. Check your inbox (and spam folder).";

/* ── #/reset — set a new password (token already stripped from the URL) ── */
function ResetPasswordCard({ token, onDone }: { token: string; onDone: () => void }) {
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (pw.length < 12) return toast.error("Password must be at least 12 characters");
    if (pw !== confirm) return toast.error("Passwords do not match");
    setBusy(true);
    try {
      const data = await api<{ ok: boolean; message?: string }>("/api/auth/reset", {
        method: "POST",
        body: JSON.stringify({ token, newPassword: pw }),
        skipAuth: true,
      });
      toast.success(data.message ?? "Password updated — sign in with your new password.");
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Password reset failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <KeyRound className="h-4 w-4 text-brand" /> Set a new password
        </p>
        <p className="text-xs text-muted-foreground">
          Reset link accepted. Choose a strong password — 12+ characters. All other sessions will be signed out.
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="rp-new" className="text-xs font-medium text-muted-foreground">New password</Label>
        <Input
          id="rp-new"
          type="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          placeholder="••••••••••••"
          autoComplete="new-password"
          className="h-10"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="rp-confirm" className="text-xs font-medium text-muted-foreground">Confirm new password</Label>
        <Input
          id="rp-confirm"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="••••••••••••"
          autoComplete="new-password"
          className="h-10"
        />
      </div>
      <Button onClick={submit} disabled={busy || !pw || !confirm} className={primaryBtn}>
        {busy ? <DharaLoader size={18} className="mr-2 text-primary-foreground" label="Updating" /> : null}
        {busy ? "Updating…" : "Update password"}
      </Button>
      <button
        type="button"
        onClick={onDone}
        className="text-[11px] text-muted-foreground transition-colors hover:text-brand"
      >
        ← Back to sign in
      </button>
    </div>
  );
}

/* ── #/verify — confirm an email address (token already stripped from the URL) ── */
function VerifyEmailCard({ token, onDone }: { token: string; onDone: () => void }) {
  const [state, setState] = useState<"pending" | "ok" | "error">("pending");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let alive = true;
    api<{ ok: boolean; message?: string }>("/api/auth/verify-email", {
      method: "POST",
      body: JSON.stringify({ token }),
      skipAuth: true,
    })
      .then((d) => {
        if (!alive) return;
        setState("ok");
        setMessage(d.message ?? "Email verified. Thank you!");
      })
      .catch((e) => {
        if (!alive) return;
        setState("error");
        setMessage(e instanceof Error ? e.message : "Invalid or expired verification link");
      });
    return () => {
      alive = false;
    };
  }, [token]);

  return (
    <div className="space-y-4">
      {state === "pending" && (
        <div className="flex flex-col items-center gap-3 py-8">
          <DharaLoader size={36} className="text-foreground" label="Verifying email" />
          <p className="text-xs text-muted-foreground">Verifying your email…</p>
        </div>
      )}
      {state === "ok" && (
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-lg border border-[#22C55E]/30 bg-[#22C55E]/10 p-4">
            <CircleCheck className="mt-0.5 h-5 w-5 shrink-0 text-[#22C55E]" />
            <div>
              <p className="text-sm font-medium">Email verified</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{message}</p>
            </div>
          </div>
          <Button onClick={onDone} className={primaryBtn}>Sign in</Button>
        </div>
      )}
      {state === "error" && (
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-lg border border-danger/30 bg-danger/10 p-4">
            <CircleX className="mt-0.5 h-5 w-5 shrink-0 text-danger" />
            <div>
              <p className="text-sm font-medium">Verification failed</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{message}</p>
            </div>
          </div>
          <Button onClick={onDone} className={ghostBtn}>Back to sign in</Button>
        </div>
      )}
    </div>
  );
}

/* Feature sections — colored top rule instead of boxes (per brand spec) */
const FEATURES = [
  { icon: Zap, label: "Auto Table Creation", desc: "POST JSON — the table designs itself.", rule: "var(--brand)" },
  { icon: ShieldCheck, label: "RLS + JWT + PAT", desc: "Deny-by-default row security.", rule: "var(--info)" },
  { icon: Radio, label: "Realtime, per table", desc: "One toggle per table. Nothing else.", rule: "var(--border)" },
  { icon: KeyRound, label: "API Keys & Scopes", desc: "anon / service / scoped PATs.", rule: "var(--border)" },
  { icon: Boxes, label: "Host Storage", desc: "Uses your host's disk. No vendor lock.", rule: "var(--info)" },
  { icon: Terminal, label: "MCP + REST v1", desc: "PostgREST-style API, AI-ready.", rule: "var(--brand)" },
];

/* ── Table-editor mock window — the real product, statically rendered ── */
function MockTableWindow() {
  const rows = [
    ["8f3c…9e21", "Ship v1.0", "5", "false", "2 min ago"],
    ["b7d1…44c8", "Write docs", "3", "false", "9 min ago"],
    ["1a09…f7b2", "Add webhooks", "4", "true", "1 hr ago"],
    ["c2e4…08aa", "Rotate keys", "2", "true", "3 hr ago"],
  ];
  return (
    <div className="surface overflow-hidden rounded-xl">
      {/* window chrome */}
      <div className="flex h-9 items-center gap-2 border-b border-border bg-popover/60 px-3">
        <span className="h-2.5 w-2.5 rounded-full bg-[#EF4444]/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#F59E0B]/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#22C55E]/70" />
        <span className="ml-2 flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
          <Table2 className="h-3 w-3" /> dhra8f2c1e_TASKS · realtime
          <span className="live-dot ml-1" />
        </span>
      </div>
      {/* header row */}
      <div className="grid grid-cols-[1.1fr_1.6fr_0.5fr_0.6fr_0.9fr] border-b border-border bg-popover/40 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        <span>id</span><span>title</span><span>priority</span><span>done</span><span>created_at</span>
      </div>
      {/* data rows — mono, tabular */}
      {rows.map((r, i) => (
        <div
          key={i}
          className="grid grid-cols-[1.1fr_1.6fr_0.5fr_0.6fr_0.9fr] items-center px-3 py-2 font-mono text-[11px] leading-none tabular"
        >
          <span className="text-muted-foreground">{r[0]}</span>
          <span className="truncate text-foreground">{r[1]}</span>
          <span className="text-foreground">{r[2]}</span>
          <span>
            <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] ${r[3] === "true" ? "bg-[#22C55E]/15 text-[#22C55E]" : "bg-muted-foreground/10 text-muted-foreground"}`}>
              {r[3]}
            </span>
          </span>
          <span className="text-muted-foreground">{r[4]}</span>
        </div>
      ))}
      {/* insert hint */}
      <div className="border-t border-border bg-popover/40 px-3 py-2 font-mono text-[10px] text-muted-foreground">
        <span className="text-[#14B8A6]">POST</span> /api/v1/project/tasks <span className="text-muted-foreground/60">— auto-created this table</span>
      </div>
    </div>
  );
}

export default function Landing({
  onDone,
  initialRoute = null,
}: {
  onDone: () => void;
  initialRoute?: LandingRoute | null;
}) {
  const setBoot = useStore((s) => s.setBoot);
  const [mode, setMode] = useState<"tls" | "wallet">("tls");
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [connectString, setConnectString] = useState("");
  const [walletPassword, setWalletPassword] = useState("");
  const [walletFile, setWalletFile] = useState<File | null>(null);
  const [walletAliases, setWalletAliases] = useState<string[]>([]);
  const [connecting, setConnecting] = useState(false);

  // auth forms
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const hasUsers = useStore((s) => s.hasUsers);
  const connected = useStore((s) => s.connected);
  const [tab, setTab] = useState<AuthTab>(() => (connected || !hasUsers ? "connect" : "login"));

  // signup policy (GET /api/auth/signup — public)
  const [signupMode, setSignupMode] = useState<SignupModeState>(null);
  const [ownerExists, setOwnerExists] = useState(true);
  const [inviteToken, setInviteToken] = useState("");
  const [setupToken, setSetupToken] = useState("");
  const [inviteHint, setInviteHint] = useState(false);

  // forgot password (inline card under the login form)
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotMsg, setForgotMsg] = useState<string | null>(null);
  const [forgotBusy, setForgotBusy] = useState(false);

  // email-action deep links (#/reset, #/verify — token stripped from the URL by page.tsx)
  const [hashRoute, setHashRoute] = useState<Extract<LandingRoute, { kind: "reset" | "verify" }> | null>(null);
  const routeHandled = useRef(false);

  async function uploadWallet() {
    if (!walletFile) return toast.error("Choose your wallet zip first");
    const form = new FormData();
    form.append("wallet", walletFile);
    try {
      const res = await fetch("/api/setup/wallet", { method: "POST", body: form });
      const data = (await res.json()) as { ok?: boolean; aliases?: string[]; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Wallet upload failed");
      setWalletAliases(data.aliases ?? []);
      toast.success(`Wallet extracted. TNS aliases: ${(data.aliases ?? []).join(", ")}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Wallet upload failed");
    }
  }

  async function connectOracle() {
    if (!user || !password || !connectString) {
      return toast.error("Username, password and connection string are required");
    }
    setConnecting(true);
    try {
      const data = await api<SetupResponse>("/api/setup", {
        method: "POST",
        body: JSON.stringify({ user, password, connectString, walletPassword }),
      });
      if (!data.ok) throw new Error(data.error ?? "Connection failed");
      toast.success(`Connected: ${data.banner ?? "Oracle Autonomous AI DB"}`);
      setBoot({ configured: true, connected: true, banner: data.banner ?? "" });
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Connection failed");
    } finally {
      setConnecting(false);
    }
  }

  async function doSignup() {
    setAuthBusy(true);
    setInviteHint(false);
    try {
      const data = await api<{ ok: boolean; accessToken: string; user: SessionUser }>(
        "/api/auth/signup",
        {
          method: "POST",
          body: JSON.stringify({
            name,
            email,
            password: authPassword,
            ...(inviteToken ? { inviteToken } : {}),
            ...(setupToken ? { setupToken } : {}),
          }),
        }
      );
      setTokens(data.accessToken);
      useStore.getState().setUser(data.user);
      toast.success("Welcome to Dhara 🎉");
      onDone();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Signup failed";
      // server error code `invite_required` → surface a friendly hint on the token field
      if (/invite/i.test(msg)) setInviteHint(true);
      toast.error(msg);
    } finally {
      setAuthBusy(false);
    }
  }

  async function doLogin() {
    setAuthBusy(true);
    try {
      const data = await api<{ ok: boolean; accessToken: string; user: SessionUser }>(
        "/api/auth/login",
        { method: "POST", body: JSON.stringify({ email, password: authPassword }) }
      );
      setTokens(data.accessToken);
      useStore.getState().setUser(data.user);
      toast.success("Signed in");
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Login failed");
    } finally {
      setAuthBusy(false);
    }
  }

  async function doForgot() {
    if (!forgotEmail) return toast.error("Enter your account email first");
    setForgotBusy(true);
    try {
      const data = await api<{ ok: boolean; message?: string }>("/api/auth/forgot", {
        method: "POST",
        body: JSON.stringify({ email: forgotEmail }),
        skipAuth: true,
      });
      // enumeration-proof: the same generic answer for existing and unknown emails
      setForgotMsg(data.message ?? GENERIC_RESET_MSG);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Request failed");
    } finally {
      setForgotBusy(false);
    }
  }

  // Public signup policy → render the Owner tab accordingly (open / invite / closed / owner boot)
  useEffect(() => {
    api<{ mode: "open" | "invite" | "closed"; ownerExists: boolean }>("/api/auth/signup", {
      skipAuth: true,
    })
      .then((d) => {
        setSignupMode(d.mode);
        setOwnerExists(d.ownerExists);
      })
      .catch(() => setSignupMode("open"));
  }, []);

  // Deep links passed down from page.tsx (parsed + sanitized before the hash-sync effect).
  // One-time OAuth codes must be exchanged exactly once — guarded by ref.
  useEffect(() => {
    if (routeHandled.current || !initialRoute) return;
    routeHandled.current = true;

    if (initialRoute.kind === "oauth") {
      void (async () => {
        try {
          const data = await api<{ ok: boolean; accessToken: string; user: SessionUser }>(
            "/api/auth/oauth/google/exchange",
            { method: "POST", body: JSON.stringify({ code: initialRoute.code }), skipAuth: true }
          );
          setTokens(data.accessToken);
          useStore.getState().setUser(data.user);
          toast.success("Signed in with Google");
          onDone();
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Google sign-in failed");
        }
      })();
      return;
    }

    if (initialRoute.kind === "reset") {
      setHashRoute({ kind: "reset", token: initialRoute.token });
      return;
    }

    if (initialRoute.kind === "verify") {
      setHashRoute({ kind: "verify", token: initialRoute.token });
      return;
    }

    if (initialRoute.kind === "signup") {
      if (initialRoute.invite) setInviteToken(initialRoute.invite);
      if (initialRoute.email) setEmail(initialRoute.email);
      setTab("signup");
    }
  }, [initialRoute, onDone]);

  /* ONE animation: logo layers cascade on page load (Framer Motion). */
  const layerMotion = (i: number) => ({
    initial: { opacity: 0, y: 14 - i * 2 },
    animate: { opacity: 1, y: 0 },
    transition: { delay: 0.12 + i * 0.13, duration: 0.55, ease: [0.16, 1, 0.3, 1] as const },
  });

  return (
    <div className="relative min-h-screen overflow-x-clip bg-background text-foreground">
      {/* ── Top bar ── */}
      <header className="relative z-10 mx-auto flex w-full max-w-7xl items-center justify-between px-6 py-5 sm:px-10">
        <a href="/" className="flex items-center gap-2.5" aria-label="Dhara home">
          <DharaLogo size={30} className="text-foreground" />
          <span className="font-display text-[17px]">Dhara</span>
        </a>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="hidden border-border bg-card text-muted-foreground sm:inline-flex">
            MIT · open source
          </Badge>
          <a
            href="https://github.com/himadrijunior/Dhara"
            target="_blank"
            rel="noreferrer"
            className="press inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-[13px] font-medium text-foreground transition-colors hover:bg-accent"
          >
            <Github className="h-3.5 w-3.5" /> Star <Star className="h-3 w-3 text-[#F59E0B]" />
          </a>
        </div>
      </header>

      <div className="relative mx-auto grid w-full max-w-7xl grid-cols-1 gap-10 px-6 pb-20 sm:px-10 lg:grid-cols-[1.15fr_0.85fr] lg:gap-14">
        {/* ── Hero ── */}
        <div className="flex flex-col justify-center pt-6 lg:pt-14">
          {/* cascade logo — outer g holds the static offset, motion.g only animates */}
          <svg viewBox="0 0 380 380" width={64} height={64} className="mb-7 text-foreground" role="img" aria-label="Dhara logo">
            <g fill="currentColor" transform="translate(0,-6)">
              <g>
                <motion.g {...layerMotion(0)}><DharaLayerPath /></motion.g>
              </g>
              <g transform="translate(0,62)">
                <motion.g {...layerMotion(1)}><DharaLayerPath /></motion.g>
              </g>
              <g transform="translate(0,124)">
                <motion.g {...layerMotion(2)}><DharaLayerPath /></motion.g>
              </g>
            </g>
          </svg>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="mb-4 inline-flex w-fit items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-[11px] text-muted-foreground">
              <span className="live-dot" />
              Self-hosted · Oracle Always Free ready
            </div>

            <h1 className="font-display max-w-2xl text-4xl leading-[1.05] sm:text-5xl lg:text-[3.4rem]">
              Supabase + Firebase power,
              <br />
              <span className="text-gradient-brand">on your free Oracle AI&nbsp;DB.</span>
            </h1>
            <p className="mt-5 mb-8 max-w-xl text-[15px] leading-relaxed text-muted-foreground sm:text-base">
              Auto table creation, auth with JWT &amp; API keys, RLS policies, realtime, webhooks,
              storage, SQL console, MCP — one open-source backend that talks straight to your
              database. No demo mode. Ever.
            </p>

            <div className="flex flex-wrap items-center gap-2.5">
              <Button
                onClick={() => document.getElementById("dhara-setup")?.scrollIntoView({ behavior: "smooth", block: "center" })}
                className="press h-11 bg-primary px-5 text-[14px] font-semibold text-primary-foreground hover:bg-primary-hover"
              >
                Connect your database <ArrowRight className="ml-1.5 h-4 w-4" />
              </Button>
              <a
                href="https://github.com/himadrijunior/Dhara#readme"
                target="_blank"
                rel="noreferrer"
                className="press inline-flex h-11 items-center rounded-lg border border-border bg-card px-5 text-[14px] font-medium hover:bg-accent"
              >
                Read the docs
              </a>
            </div>
          </motion.div>

          {/* real product, below hero */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.62, duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
            className="mt-10"
            aria-hidden
          >
            <MockTableWindow />
          </motion.div>

          {/* features — top rules, no boxes */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.8, duration: 0.5 }}
            className="mt-12 grid grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-3"
          >
            {FEATURES.map((f) => (
              <div key={f.label} className="rule-card pt-4" style={{ ["--rule-color" as string]: f.rule }}>
                <f.icon className="mb-2 h-4 w-4 text-muted-foreground" strokeWidth={1.8} />
                <p className="text-[13.5px] font-semibold">{f.label}</p>
                <p className="mt-0.5 text-[12.5px] leading-snug text-muted-foreground">{f.desc}</p>
              </div>
            ))}
          </motion.div>

          <div className="mt-10 flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5"><Lock className="h-3 w-3 text-[#14B8A6]" /> bind-variable safe</span>
            <span className="text-border">·</span>
            <span>node-oracledb thin mode</span>
            <span className="text-border">·</span>
            <span>multi-project</span>
            <span className="text-border">·</span>
            <span>mTLS wallet</span>
          </div>
        </div>

        {/* ── Setup / Auth panel ── */}
        <div id="dhara-setup" className="flex items-start justify-center pt-2 lg:sticky lg:top-8 lg:pt-14">
          <div className="panel w-full max-w-md p-6 sm:p-7">
            {hashRoute?.kind === "reset" ? (
              <ResetPasswordCard
                token={hashRoute.token}
                onDone={() => {
                  setHashRoute(null);
                  setTab("login");
                }}
              />
            ) : hashRoute?.kind === "verify" ? (
              <VerifyEmailCard
                token={hashRoute.token}
                onDone={() => {
                  setHashRoute(null);
                  setTab("login");
                }}
              />
            ) : (
            <Tabs
              value={tab}
              onValueChange={(v) => setTab(v as AuthTab)}
            >
              <TabsList className="mb-6 grid h-11 w-full grid-cols-3 rounded-lg border border-border bg-secondary/60 p-1">
                <TabsTrigger
                  value="connect"
                  className="rounded-md text-[13px] font-medium data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-none data-[state=active]:border data-[state=active]:border-border"
                >
                  <span className="mr-1.5 flex h-4.5 w-4.5 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground">
                    1
                  </span>
                  Connect
                </TabsTrigger>
                <TabsTrigger
                  value="signup"
                  className="rounded-md text-[13px] font-medium data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-none data-[state=active]:border data-[state=active]:border-border"
                >
                  <span className="mr-1.5 flex h-4.5 w-4.5 items-center justify-center rounded-full bg-info text-[9px] font-bold text-[#06231f]">
                    2
                  </span>
                  Owner
                </TabsTrigger>
                <TabsTrigger
                  value="login"
                  className="rounded-md text-[13px] font-medium data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-none data-[state=active]:border data-[state=active]:border-border"
                >
                  Sign in
                </TabsTrigger>
              </TabsList>

              {/* CONNECT TAB */}
              <TabsContent value="connect" className="mt-1 space-y-4">
                {connected ? (
                  <div className="flex items-start gap-3 rounded-lg border border-[#22C55E]/30 bg-[#22C55E]/10 p-4">
                    <CircleCheck className="mt-0.5 h-5 w-5 shrink-0 text-[#22C55E]" />
                    <div>
                      <p className="text-sm font-medium">Oracle connected</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Metadata tables are ready. Switch to the <b>Owner</b> tab to create your account.
                      </p>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="rounded-lg border border-border bg-secondary/40 p-4 text-xs leading-relaxed text-muted-foreground">
                      <p className="mb-1.5 flex items-center gap-1.5 font-medium text-foreground">
                        <Database className="h-3.5 w-3.5 text-brand" /> From the Oracle Cloud console you need:
                      </p>
                      <ol className="ml-4 list-decimal space-y-0.5">
                        <li>
                          DB username (e.g. <code className="rounded bg-secondary px-1 font-mono text-brand">ADMIN</code>)
                        </li>
                        <li>DB password</li>
                        <li>
                          TLS connection string — <em>Database connection → TLS</em>
                        </li>
                        <li>(mTLS only) Wallet zip — <em>Download wallet</em></li>
                      </ol>
                    </div>

                    <RadioGroup
                      value={mode}
                      onValueChange={(v) => setMode(v as "tls" | "wallet")}
                      className="flex gap-2"
                    >
                      {(["tls", "wallet"] as const).map((m) => (
                        <Label
                          key={m}
                          htmlFor={m}
                          className={`flex min-h-[44px] flex-1 cursor-pointer items-center gap-2 rounded-lg border px-3 text-[13px] transition-colors ${
                            mode === m
                              ? "border-brand/50 bg-brand-soft text-foreground"
                              : "border-border bg-card text-muted-foreground hover:bg-accent"
                          }`}
                        >
                          <RadioGroupItem value={m} id={m} className="border-muted-foreground" />
                          {m === "tls" ? "TLS (easy)" : "Wallet (mTLS)"}
                        </Label>
                      ))}
                    </RadioGroup>

                    {mode === "wallet" && (
                      <div className="space-y-2">
                        <Label className="text-xs font-medium text-muted-foreground">Wallet zip</Label>
                        <div className="flex gap-2">
                          <Input
                            type="file"
                            accept=".zip"
                            onChange={(e) => setWalletFile(e.target.files?.[0] ?? null)}
                            className="h-10 text-xs file:mr-2 file:rounded-md file:border-0 file:bg-secondary file:px-2 file:text-xs file:text-foreground"
                          />
                          <Button type="button" variant="secondary" size="sm" onClick={uploadWallet} className="h-10 shrink-0 gap-1.5">
                            <Upload className="h-3.5 w-3.5" /> Upload
                          </Button>
                        </div>
                        {walletAliases.length > 0 && (
                          <p className="rounded-lg border border-brand/25 bg-brand-soft px-2.5 py-1.5 font-mono text-[11px] text-brand">
                            {walletAliases.join(" · ")} — use e.g. <b>yourname_low</b>
                          </p>
                        )}
                      </div>
                    )}

                    <div className="space-y-1.5">
                      <Label htmlFor="db-user" className="text-xs font-medium text-muted-foreground">
                        DB username
                      </Label>
                      <Input
                        id="db-user"
                        value={user}
                        onChange={(e) => setUser(e.target.value)}
                        placeholder="ADMIN"
                        autoCapitalize="characters"
                        className="h-10 font-mono"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="db-pass" className="text-xs font-medium text-muted-foreground">
                        DB password
                      </Label>
                      <Input
                        id="db-pass"
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="••••••••••••"
                        className="h-10"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="db-cs" className="text-xs font-medium text-muted-foreground">
                        Connection string {mode === "wallet" ? "(TNS alias)" : "(host:port/service)"}
                      </Label>
                      <Input
                        id="db-cs"
                        value={connectString}
                        onChange={(e) => setConnectString(e.target.value)}
                        placeholder={
                          mode === "wallet"
                            ? "yourdb_low"
                            : "adb.us-ashburn-1.oraclecloud.com:1521/xxx_low.adb.oraclecloud.com"
                        }
                        className="h-10 font-mono text-[13px]"
                      />
                    </div>
                    {mode === "wallet" && (
                      <div className="space-y-1.5">
                        <Label htmlFor="db-wp" className="text-xs font-medium text-muted-foreground">
                          Wallet password{" "}
                          <span className="font-normal text-muted-foreground/60">(optional — not needed for cwallet.sso)</span>
                        </Label>
                        <Input
                          id="db-wp"
                          type="password"
                          value={walletPassword}
                          onChange={(e) => setWalletPassword(e.target.value)}
                          className="h-10"
                        />
                      </div>
                    )}

                    <Button onClick={connectOracle} disabled={connecting} className={primaryBtn}>
                      {connecting ? (
                        <DharaLoader size={18} className="mr-2 text-primary-foreground" label="Connecting" />
                      ) : (
                        <ArrowRight className="mr-2 h-4 w-4" />
                      )}
                      {connecting ? "Connecting…" : "Test & Connect"}
                    </Button>
                    <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
                      <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand" />
                      Credentials are stored server-side in{" "}
                      <code className="font-mono">.dhara/config.json</code> (chmod 0600) — never exposed
                      to the browser.
                    </p>
                  </>
                )}
              </TabsContent>

              {/* SIGNUP TAB */}
              <TabsContent value="signup" className="mt-1 space-y-4">
                {signupMode === "closed" ? (
                  <div className="rounded-lg border border-border bg-secondary/40 p-4">
                    <p className="flex items-center gap-2 text-sm font-medium">
                      <Lock className="h-4 w-4 text-muted-foreground" /> Signup is disabled on this instance
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      The owner has turned off new registrations. Ask an admin to send you an invitation
                      when the policy changes.
                    </p>
                  </div>
                ) : (
                  <>
                <div className="space-y-1.5">
                  <Label htmlFor="su-name" className="text-xs font-medium text-muted-foreground">Name</Label>
                  <Input id="su-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" className="h-10" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="su-email" className="text-xs font-medium text-muted-foreground">Email</Label>
                  <Input id="su-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" className="h-10" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="su-pass" className="text-xs font-medium text-muted-foreground">
                    Password <span className="font-normal text-muted-foreground/60">(min 8 chars)</span>
                  </Label>
                  <Input id="su-pass" type="password" value={authPassword} onChange={(e) => setAuthPassword(e.target.value)} autoComplete="new-password" className="h-10" />
                </div>
                {ownerExists === false && (
                  <div className="space-y-1.5">
                    <Label htmlFor="su-setup" className="text-xs font-medium text-muted-foreground">Setup token</Label>
                    <Input
                      id="su-setup"
                      value={setupToken}
                      onChange={(e) => setSetupToken(e.target.value)}
                      placeholder="paste the first-run token"
                      className="h-10 font-mono text-xs"
                    />
                    <p className="text-[11px] leading-relaxed text-muted-foreground">
                      First-run token — printed once in the server log (docker logs / server console) and
                      saved in <code className="font-mono text-brand">.dhara/setup-token</code>.
                    </p>
                  </div>
                )}
                {ownerExists && signupMode === "invite" && (
                  <div className="space-y-1.5">
                    <Label htmlFor="su-invite" className="text-xs font-medium text-muted-foreground">Invitation token</Label>
                    <Input
                      id="su-invite"
                      value={inviteToken}
                      onChange={(e) => setInviteToken(e.target.value)}
                      placeholder="paste the token from your invite email"
                      className="h-10 font-mono text-xs"
                    />
                    {inviteHint && (
                      <p className="text-[11px] leading-relaxed text-warning">
                        This instance is invite-only — ask an admin for an invitation, then paste the token
                        from the email link here.
                      </p>
                    )}
                  </div>
                )}
                <Button onClick={doSignup} disabled={authBusy || !connected} className={primaryBtn}>
                  {authBusy ? <DharaLoader size={18} className="mr-2 text-primary-foreground" label="Creating account" /> : null}
                  {hasUsers ? "Create member account" : "Create owner account"}
                </Button>
                <p className="text-[11px] text-muted-foreground">
                  {connected
                    ? ownerExists === false
                      ? "The first account becomes the platform owner."
                      : signupMode === "invite"
                        ? "Signups need a valid invitation token."
                        : "Signup is open — anyone can create an account."
                    : "Connect Oracle first (tab 1)."}
                </p>
                  </>
                )}
              </TabsContent>

              {/* LOGIN TAB */}
              <TabsContent value="login" className="mt-1 space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="li-email" className="text-xs font-medium text-muted-foreground">Email</Label>
                  <Input id="li-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" className="h-10" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="li-pass" className="text-xs font-medium text-muted-foreground">Password</Label>
                  <Input id="li-pass" type="password" value={authPassword} onChange={(e) => setAuthPassword(e.target.value)} autoComplete="current-password" className="h-10" />
                </div>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      setForgotOpen((v) => !v);
                      setForgotMsg(null);
                    }}
                    className="text-[11px] text-muted-foreground underline-offset-2 transition-colors hover:text-brand hover:underline"
                  >
                    Forgot password?
                  </button>
                </div>
                {forgotOpen && (
                  <div className="space-y-2 rounded-lg border border-border bg-secondary/40 p-3">
                    <Label htmlFor="li-forgot" className="text-xs font-medium text-muted-foreground">Account email</Label>
                    <div className="flex gap-2">
                      <Input
                        id="li-forgot"
                        type="email"
                        value={forgotEmail}
                        onChange={(e) => setForgotEmail(e.target.value)}
                        placeholder="you@example.com"
                        className="h-9 flex-1 text-xs"
                      />
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={doForgot}
                        disabled={forgotBusy || !forgotEmail}
                        className="h-9 shrink-0 gap-1.5 text-xs"
                      >
                        {forgotBusy ? (
                          <DharaLoader size={14} label="Sending" />
                        ) : (
                          <Mail className="h-3.5 w-3.5" />
                        )}
                        Send link
                      </Button>
                    </div>
                    {forgotMsg && <p className="text-[11px] leading-relaxed text-brand">{forgotMsg}</p>}
                  </div>
                )}
                <Button onClick={doLogin} disabled={authBusy || !connected} className={primaryBtn}>
                  {authBusy ? <DharaLoader size={18} className="mr-2 text-primary-foreground" label="Signing in" /> : null}
                  Sign in
                </Button>
                <div className="relative py-1 text-center">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t border-border" />
                  </div>
                  <span className="relative bg-card px-2 text-[11px] text-muted-foreground">or continue with</span>
                </div>
                <Button
                  variant="outline"
                  onClick={() => {
                    window.location.href = "/api/auth/oauth/google";
                  }}
                  disabled={!connected}
                  className={ghostBtn}
                >
                  <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24" aria-hidden>
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"/>
                  </svg>
                  Continue with Google
                </Button>
                <p className="text-[11px] text-muted-foreground">
                  Google OAuth works after you add Client ID + Secret in Settings → Auth.
                </p>
              </TabsContent>
            </Tabs>
            )}
          </div>
        </div>
      </div>

      {/* footer */}
      <footer className="relative border-t border-border py-6">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-6 sm:px-10">
          <p className="font-mono text-[11px] text-muted-foreground">
            Dhara · your data, your credentials, your server
          </p>
          <p className="font-mono text-[11px] text-muted-foreground">MIT © 2026</p>
        </div>
      </footer>
    </div>
  );
}
