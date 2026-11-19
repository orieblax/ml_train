import { NextRequest, NextResponse } from "next/server";
import {
  createSessionCookieValue,
  getWorkspaceAuthStatus,
  SESSION_COOKIE_NAME,
  SESSION_TTL_MS,
  verifyWorkspaceCredentials,
} from "@/lib/auth";
import { getAuthConfig } from "@/lib/env";

function isSecureRequest(req: NextRequest): boolean {
  return (
    req.nextUrl.protocol === "https:" ||
    req.headers.get("x-forwarded-proto") === "https" ||
    Boolean(process.env.VERCEL)
  );
}

export async function GET() {
  const status = await getWorkspaceAuthStatus();
  return NextResponse.json(status, {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(req: NextRequest) {
  const cfg = getAuthConfig();

  if (!cfg.authRequired) {
    return NextResponse.json({
      authenticated: true,
      authRequired: false,
      configured: cfg.configured,
      username: cfg.username || "local",
    });
  }

  if (!cfg.configured || !cfg.username) {
    return NextResponse.json(
      {
        error:
          "Login credentials (APP_USERNAME and APP_PASSWORD) are not configured in Vercel environment variables.",
      },
      { status: 503 }
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    username?: unknown;
    password?: unknown;
  };
  const username = typeof body.username === "string" ? body.username : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!username.trim() || !password) {
    return NextResponse.json(
      { error: "Username and password are required." },
      { status: 400 }
    );
  }

  if (!verifyWorkspaceCredentials(username, password)) {
    return NextResponse.json(
      { error: "Invalid username or password." },
      { status: 401 }
    );
  }

  const resp = NextResponse.json({
    authenticated: true,
    authRequired: true,
    configured: true,
    username: cfg.username,
  });
  resp.cookies.set(SESSION_COOKIE_NAME, createSessionCookieValue(cfg.username), {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecureRequest(req),
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
  return resp;
}

export async function DELETE(req: NextRequest) {
  const resp = NextResponse.json({ authenticated: false });
  resp.cookies.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecureRequest(req),
    path: "/",
    maxAge: 0,
  });
  return resp;
}
