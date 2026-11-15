import crypto from "crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { signToken, verifySignedToken } from "@/lib/crypto";
import { getAccessPin, getSessionSecret } from "@/lib/env";

export const SESSION_COOKIE_NAME = "mltrain_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function createSessionCookieValue(): string {
  const exp = Date.now() + SESSION_TTL_MS;
  return signToken(`workspace:${exp}`, getSessionSecret());
}

export function isSessionTokenValid(token: string | undefined): boolean {
  const pin = getAccessPin();
  if (!pin) return true;
  if (!token) return false;
  const payload = verifySignedToken(token, getSessionSecret());
  if (!payload || !payload.startsWith("workspace:")) return false;
  const exp = Number(payload.split(":")[1]);
  return Number.isFinite(exp) && exp > Date.now();
}

export function verifyAccessPin(candidate: string): boolean {
  const expected = getAccessPin();
  if (!expected) return true;
  const a = Buffer.from(candidate, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export async function isWorkspaceAuthenticated(): Promise<{
  authenticated: boolean;
  pinRequired: boolean;
}> {
  const pin = getAccessPin();
  if (!pin) {
    return { authenticated: true, pinRequired: false };
  }
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  return {
    authenticated: isSessionTokenValid(token),
    pinRequired: true,
  };
}

export async function requireWorkspaceAuth(): Promise<NextResponse | null> {
  const status = await isWorkspaceAuthenticated();
  if (!status.authenticated) {
    return NextResponse.json(
      { error: "Workspace authentication required" },
      { status: 401 }
    );
  }
  return null;
}
