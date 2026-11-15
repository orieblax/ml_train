import { NextRequest, NextResponse } from "next/server";
import { requireWorkspaceAuth } from "@/lib/auth";
import {
  listDeployments,
  listProjectDocuments,
  listProjectModels,
  listProjects,
  putProject,
} from "@/lib/aws/dynamo";
import { generateId } from "@/lib/crypto";
import { computeDatasetReadiness } from "@/lib/dataset-utils";
import { isAwsConfigured } from "@/lib/env";
import type { ProjectRecord } from "@/lib/types";
import { CreateProjectSchema } from "@/lib/validation";

export async function GET() {
  const authErr = await requireWorkspaceAuth();
  if (authErr) return authErr;

  if (!isAwsConfigured()) {
    return NextResponse.json({ configured: false, projects: [] });
  }

  try {
    const [projects, deployments] = await Promise.all([
      listProjects(),
      listDeployments(),
    ]);

    const enriched = await Promise.all(
      projects.map(async (project) => {
        const [docs, models] = await Promise.all([
          listProjectDocuments(project.projectId),
          listProjectModels(project.projectId),
        ]);
        const readiness = computeDatasetReadiness(docs, project.taskType);
        const activeDeploymentCount = deployments.filter(
          (d) => d.projectId === project.projectId && d.status === "ACTIVE"
        ).length;
        const latestModel = models[0] || null;

        return {
          ...project,
          totalSamples: readiness.totalSamples,
          labeledSamples: readiness.labeledSamples,
          modelCount: models.length,
          latestMacroF1: latestModel?.metricsSummary?.macroF1 || null,
          activeDeploymentCount,
        };
      })
    );

    return NextResponse.json({ configured: true, projects: enriched });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Failed to list projects",
      },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const authErr = await requireWorkspaceAuth();
  if (authErr) return authErr;

  if (!isAwsConfigured()) {
    return NextResponse.json(
      { error: "AWS environment variables are not configured yet." },
      { status: 503 }
    );
  }

  try {
    const raw = await req.json();
    const parsed = CreateProjectSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Invalid project payload" },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();
    let labels = Array.from(new Set(parsed.data.labels));
    if (labels.length === 0 && parsed.data.taskType === "sentiment") {
      labels = ["Positive", "Neutral", "Negative"];
    }

    const project: ProjectRecord = {
      projectId: generateId("prj"),
      name: parsed.data.name,
      description: parsed.data.description,
      taskType: parsed.data.taskType,
      labels,
      createdAt: now,
      updatedAt: now,
    };

    await putProject(project);
    return NextResponse.json({ project }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Failed to create project",
      },
      { status: 500 }
    );
  }
}
