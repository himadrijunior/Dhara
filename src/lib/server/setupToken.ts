import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { IKL_DIR } from "./config";

/**
 * First-run setup token (R3) — closes the unauthenticated first-run window.
 *
 * Without a token, ANYONE who reaches an unconfigured (or DB-outage) instance
 * could complete setup / upload a wallet / claim the first owner slot.
 *
 * Bootstrapping (Jupyter-style):
 *  - On first need we generate a 32-byte token, store it in
 *    `.dhara/setup-token` (mode 0600) and print it ONCE to the server log.
 *  - The Setup Wizard, the wallet upload and the first owner signup must all
 *    present it via the `x-setup-token` header.
 *  - As soon as the first owner exists, `consumeIfOwnerExists()` deletes the
 *    file — the token is dead weight afterwards.
 *  - `DHARA_SETUP_TOKEN` env (if set) takes precedence for operators who want
 *    to pin the token.
 */

const TOKEN_FILE = path.join(IKL_DIR, "setup-token");

function envToken(): string | null {
  const t = process.env.DHARA_SETUP_TOKEN?.trim();
  return t || null;
}

/** Get the active setup token, bootstrapping one if neither env nor file has it. */
export async function getOrCreateSetupToken(): Promise<string> {
  const env = envToken();
  if (env) return env;
  try {
    const existing = (await fs.readFile(TOKEN_FILE, "utf8")).trim();
    if (existing) return existing;
  } catch {
    /* not generated yet */
  }
  const token = crypto.randomBytes(32).toString("base64url");
  await fs.mkdir(IKL_DIR, { recursive: true });
  await fs.writeFile(TOKEN_FILE, token + "\n", { mode: 0o600 });
  console.log(
    "──────────────────────────────────────────────────────────\n" +
      "  Dhara first-run setup token (shown once):\n\n" +
      `  ${token}\n\n` +
      `  Also saved to ${TOKEN_FILE} (0600).\n` +
      "  Required in the `x-setup-token` header for setup, wallet\n" +
      "  upload and the first owner signup.\n" +
      "──────────────────────────────────────────────────────────"
  );
  return token;
}

/** Timing-safe comparison of a presented token against the active one. */
export async function verifySetupToken(presented: string | null | undefined): Promise<boolean> {
  if (!presented) return false;
  const expected = await getOrCreateSetupToken();
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** Delete the token file once the instance has an owner (token no longer needed). */
export async function consumeSetupToken(): Promise<void> {
  try {
    await fs.rm(TOKEN_FILE, { force: true });
  } catch {
    /* noop */
  }
}
