import { NextResponse } from "next/server";
import { requireWorkspaceAuth } from "@/lib/auth";
import { listDeployments, listProjects } from "@/lib/aws/dynamo";
import { isAwsConfigured } from "@/lib/env";

export async function GET() {
  const authErr = await requireWorkspaceAuth();
  if (authErr) return authErr;

  if (!isAwsConfigured()) {
    return NextResponse.json({ configured: false, deployments: [] });
  }

  try {
    const [deployments, projects] = await Promise.all([
      listDeployments(),
      listProjects(),
    ]);
    const projectMap = new Map(projects.map((p) => [p.projectId, p.name]));

    const safe = deployments.map((d) => {
      const clean = { ...d };
      delete clean.apiKeyEncrypted;
      return {
        ...clean,
        projectName: projectMap.get(d.projectId) || d.projectId,
      };
    });

    return NextResponse.json({ configured: true, deployments: safe });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Failed to list deployments",
      },
      { status: 500 }
    );
  }
}
