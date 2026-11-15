import { NextRequest, NextResponse } from "next/server";
import {
  createSessionCookieValue,
  isWorkspaceAuthenticated,
  SESSION_COOKIE_NAME,
  verifyAccessPin,
} from "@/lib/auth";

export async function GET() {
  const status = await isWorkspaceAuthenticated();
  return NextResponse.json(status);
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { pin?: string };
  const candidate = String(body.pin || "");

  if (!verifyAccessPin(candidate)) {
    return NextResponse.json(
      { error: "Invalid workspace passcode." },
      { status: 401 }
    );
  }

  const resp = NextResponse.json({ authenticated: true });
  resp.cookies.set(SESSION_COOKIE_NAME, createSessionCookieValue(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 7 * 24 * 60 * 60,
  });
  return resp;
}

export async function DELETE() {
  const resp = NextResponse.json({ authenticated: false });
  resp.cookies.delete(SESSION_COOKIE_NAME);
  return resp;
}
