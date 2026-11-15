import { NextRequest, NextResponse } from "next/server";
import { requireWorkspaceAuth } from "@/lib/auth";
import { deleteModelLambda, deployModelLambda } from "@/lib/aws/deployer";
import {
  deleteDeploymentRecord,
  getModelById,
  listModelDeployments,
  putDeployment,
} from "@/lib/aws/dynamo";
import { generateId } from "@/lib/crypto";
import type { DeploymentRecord } from "@/lib/types";
import { DeployModelSchema } from "@/lib/validation";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ modelId: string }> }
) {
  const authErr = await requireWorkspaceAuth();
  if (authErr) return authErr;

  const { modelId } = await context.params;
  try {
    const model = await getModelById(modelId);
    if (!model) {
      return NextResponse.json({ error: "Model not found" }, { status: 404 });
    }

    const parsed = DeployModelSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Invalid deployment options" },
        { status: 400 }
      );
    }

    const existingList = await listModelDeployments(modelId);
    const existing = existingList[0];
    const now = new Date().toISOString();

    const deployed = await deployModelLambda({
      projectId: model.projectId,
      modelId: model.modelId,
      s3ModelKey: model.s3ModelKey,
      memoryMb: parsed.data.memoryMb,
      timeoutSec: parsed.data.timeoutSec,
      authEnabled: parsed.data.authEnabled,
    });

    const record: DeploymentRecord = {
      deploymentId: existing?.deploymentId || generateId("dep"),
      projectId: model.projectId,
      modelId: model.modelId,
      functionName: deployed.functionName,
      functionArn: deployed.functionArn,
      functionUrl: deployed.functionUrl,
      memoryMb: parsed.data.memoryMb,
      timeoutSec: parsed.data.timeoutSec,
      authEnabled: parsed.data.authEnabled,
      apiKeyMasked: deployed.apiKeyMasked,
      apiKeyEncrypted: deployed.apiKeyEncrypted,
      status: "ACTIVE",
      lastDeployedAt: now,
      createdAt: existing?.createdAt || now,
    };

    await putDeployment(record);
    const safeDeployment = { ...record };
    delete safeDeployment.apiKeyEncrypted;

    return NextResponse.json(
      {
        deployment: safeDeployment,
        apiKey: deployed.apiKeyPlaintext,
      },
      { status: existing ? 200 : 201 }
    );
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Failed to deploy model Lambda",
      },
      { status: 500 }
    );
  }
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ modelId: string }> }
) {
  const authErr = await requireWorkspaceAuth();
  if (authErr) return authErr;

  const { modelId } = await context.params;
  try {
    const deploymentIdParam = req.nextUrl.searchParams.get("deploymentId");
    const existingList = await listModelDeployments(modelId);
    const targets = deploymentIdParam
      ? existingList.filter((d) => d.deploymentId === deploymentIdParam)
      : existingList;

    if (targets.length === 0) {
      return NextResponse.json(
        { error: "No active deployment found for model" },
        { status: 404 }
      );
    }

    for (const target of targets) {
      await deleteModelLambda(target.functionName);
      await deleteDeploymentRecord(target.deploymentId);
    }

    return NextResponse.json({ ok: true, deletedCount: targets.length });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Failed to teardown deployment",
      },
      { status: 500 }
    );
  }
}
