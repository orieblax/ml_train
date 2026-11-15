import { NextRequest, NextResponse } from "next/server";
import { requireWorkspaceAuth } from "@/lib/auth";
import { deleteModelLambda } from "@/lib/aws/deployer";
import {
  deleteDeploymentRecord,
  deleteProjectCascadeFromDb,
  getProject,
  listDeployments,
  listProjectDocuments,
  listProjectJobs,
  listProjectModels,
  updateProject,
} from "@/lib/aws/dynamo";
import { deleteS3Prefix } from "@/lib/aws/s3";
import { UpdateProjectSchema } from "@/lib/validation";

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) {
  const authErr = await requireWorkspaceAuth();
  if (authErr) return authErr;

  const { projectId } = await context.params;
  try {
    const project = await getProject(projectId);
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const [documents, jobs, models, allDeployments] = await Promise.all([
      listProjectDocuments(projectId),
      listProjectJobs(projectId),
      listProjectModels(projectId),
      listDeployments(),
    ]);

    const deployments = allDeployments
      .filter((d) => d.projectId === projectId)
      .map((d) => {
        const safe = { ...d };
        delete safe.apiKeyEncrypted;
        return safe;
      });

    return NextResponse.json({
      project,
      documents,
      jobs,
      models,
      deployments,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load project" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) {
  const authErr = await requireWorkspaceAuth();
  if (authErr) return authErr;

  const { projectId } = await context.params;
  try {
    const parsed = UpdateProjectSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Invalid update payload" },
        { status: 400 }
      );
    }

    const updated = await updateProject(projectId, parsed.data);
    if (!updated) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    return NextResponse.json({ project: updated });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to update project" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) {
  const authErr = await requireWorkspaceAuth();
  if (authErr) return authErr;

  const { projectId } = await context.params;
  try {
    const [models, deployments] = await Promise.all([
      listProjectModels(projectId),
      listDeployments(),
    ]);

    for (const dep of deployments.filter((d) => d.projectId === projectId)) {
      await deleteModelLambda(dep.functionName);
      await deleteDeploymentRecord(dep.deploymentId);
    }

    await deleteS3Prefix(`projects/${projectId}/`);
    for (const model of models) {
      await deleteS3Prefix(`models/${model.modelId}/`);
    }

    await deleteProjectCascadeFromDb(projectId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to delete project" },
      { status: 500 }
    );
  }
}
