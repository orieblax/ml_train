import crypto from "crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { signToken, verifySignedToken } from "@/lib/crypto";
import { getAuthConfig, getSessionSecret } from "@/lib/env";

export const SESSION_COOKIE_NAME = "mltrain_session";
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface WorkspaceAuthStatus {
  authenticated: boolean;
  authRequired: boolean;
  configured: boolean;
  username: string | null;
}

function timingSafeEqualString(a: string, b: string): boolean {
  const hashA = crypto.createHash("sha256").update(a, "utf8").digest();
  const hashB = crypto.createHash("sha256").update(b, "utf8").digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

/**
 * Bind session signatures to the active username/password fingerprint so rotating
 * APP_USERNAME or APP_PASSWORD in Vercel immediately invalidates old cookies.
 */
function deriveAuthSigningKey(): string {
  const cfg = getAuthConfig();
  const baseSecret = getSessionSecret();
  const credFingerprint = crypto
    .createHash("sha256")
    .update(`${cfg.username ?? ""}\0${cfg.password ?? ""}`, "utf8")
    .digest("hex");
  return `${baseSecret}:${credFingerprint}`;
}

export function createSessionCookieValue(username?: string): string {
  const cfg = getAuthConfig();
  const resolvedUser = username ?? cfg.username ?? "admin";
  const userB64 = Buffer.from(resolvedUser, "utf8").toString("base64url");
  const exp = Date.now() + SESSION_TTL_MS;
  return signToken(`v2:${userB64}:${exp}`, deriveAuthSigningKey());
}

export function parseSessionToken(
  token: string | undefined
): { username: string; exp: number } | null {
  if (!token) return null;
  const payload = verifySignedToken(token, deriveAuthSigningKey());
  if (!payload) return null;

  const parts = payload.split(":");
  if (parts.length !== 3 || parts[0] !== "v2") return null;

  const [, userB64, expRaw] = parts;
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp <= Date.now()) return null;

  const username = Buffer.from(userB64, "base64url").toString("utf8");
  if (!username) return null;

  const cfg = getAuthConfig();
  if (cfg.configured && cfg.username && !timingSafeEqualString(username, cfg.username)) {
    return null;
  }

  return { username, exp };
}

export function isSessionTokenValid(token: string | undefined): boolean {
  const cfg = getAuthConfig();
  if (!cfg.authRequired) return true;
  if (!cfg.configured) return false;
  return parseSessionToken(token) !== null;
}

export function verifyWorkspaceCredentials(
  candidateUser: string,
  candidatePassword: string
): boolean {
  const cfg = getAuthConfig();
  if (!cfg.authRequired) return true;
  if (!cfg.configured || !cfg.username || !cfg.password) return false;

  const userOk = timingSafeEqualString(candidateUser.trim(), cfg.username);
  const passOk = timingSafeEqualString(candidatePassword, cfg.password);
  return userOk && passOk;
}

export async function getWorkspaceAuthStatus(): Promise<WorkspaceAuthStatus> {
  const cfg = getAuthConfig();
  if (!cfg.authRequired) {
    return {
      authenticated: true,
      authRequired: false,
      configured: cfg.configured,
      username: cfg.username || "local",
    };
  }
  if (!cfg.configured) {
    return {
      authenticated: false,
      authRequired: true,
      configured: false,
      username: null,
    };
  }

  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const session = parseSessionToken(token);
  return {
    authenticated: session !== null,
    authRequired: true,
    configured: true,
    username: session?.username || null,
  };
}

export async function isWorkspaceAuthenticated(): Promise<WorkspaceAuthStatus> {
  return getWorkspaceAuthStatus();
}

export async function requireWorkspaceAuth(): Promise<NextResponse | null> {
  const status = await getWorkspaceAuthStatus();
  if (!status.authenticated) {
    return NextResponse.json(
      { error: "Workspace authentication required" },
      { status: 401 }
    );
  }
  return null;
}
