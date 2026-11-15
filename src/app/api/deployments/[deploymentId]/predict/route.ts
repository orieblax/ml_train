import { NextRequest, NextResponse } from "next/server";
import { requireWorkspaceAuth } from "@/lib/auth";
import { getDeployment } from "@/lib/aws/dynamo";
import { decryptSecret } from "@/lib/crypto";
import { getSessionSecret } from "@/lib/env";
import { PlaygroundPredictSchema } from "@/lib/validation";

function joinEndpoint(baseUrl: string, path: string): string {
  const cleanBase = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return `${cleanBase}${cleanPath}`;
}

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ deploymentId: string }> }
) {
  const authErr = await requireWorkspaceAuth();
  if (authErr) return authErr;

  const { deploymentId } = await context.params;
  try {
    const dep = await getDeployment(deploymentId);
    if (!dep) {
      return NextResponse.json(
        { error: "Deployment not found" },
        { status: 404 }
      );
    }

    const t0 = Date.now();
    const res = await fetch(joinEndpoint(dep.functionUrl, "/health"), {
      method: "GET",
      cache: "no-store",
    });
    const elapsedMs = Date.now() - t0;
    const data = await res.json().catch(() => ({}));

    return NextResponse.json(
      { ok: res.ok, httpStatus: res.status, roundTripMs: elapsedMs, health: data },
      { status: res.ok ? 200 : 502 }
    );
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Failed to reach Lambda endpoint",
      },
      { status: 502 }
    );
  }
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ deploymentId: string }> }
) {
  const authErr = await requireWorkspaceAuth();
  if (authErr) return authErr;

  const { deploymentId } = await context.params;
  try {
    const dep = await getDeployment(deploymentId);
    if (!dep) {
      return NextResponse.json(
        { error: "Deployment not found" },
        { status: 404 }
      );
    }

    const parsed = PlaygroundPredictSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        {
          error:
            parsed.error.issues[0]?.message || "Invalid prediction request",
        },
        { status: 400 }
      );
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (dep.authEnabled && dep.apiKeyEncrypted) {
      const apiKey = decryptSecret(dep.apiKeyEncrypted, getSessionSecret());
      headers.Authorization = `Bearer ${apiKey}`;
    }

    const t0 = Date.now();
    const res = await fetch(joinEndpoint(dep.functionUrl, "/predict"), {
      method: "POST",
      headers,
      body: JSON.stringify(parsed.data),
      cache: "no-store",
    });
    const roundTripMs = Date.now() - t0;
    const data = await res.json().catch(() => ({
      error: "Invalid JSON response from Lambda",
    }));

    return NextResponse.json(
      { ...data, roundTripMs },
      { status: res.status }
    );
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Prediction proxy request failed",
      },
      { status: 502 }
    );
  }
}
