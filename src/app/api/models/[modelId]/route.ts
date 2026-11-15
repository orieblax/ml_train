import { NextRequest, NextResponse } from "next/server";
import { requireWorkspaceAuth } from "@/lib/auth";
import { getModelById, listModelDeployments } from "@/lib/aws/dynamo";
import { getModelMetricsFromS3 } from "@/lib/aws/s3";

export async function GET(
  _req: NextRequest,
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

    const [metrics, rawDeployments] = await Promise.all([
      getModelMetricsFromS3(model.s3MetricsKey),
      listModelDeployments(modelId),
    ]);

    const deployments = rawDeployments.map((d) => {
      const safe = { ...d };
      delete safe.apiKeyEncrypted;
      return safe;
    });

    return NextResponse.json({ model, metrics, deployments });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load model" },
      { status: 500 }
    );
  }
}
