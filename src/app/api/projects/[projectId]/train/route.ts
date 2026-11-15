import { NextRequest, NextResponse } from "next/server";
import { requireWorkspaceAuth } from "@/lib/auth";
import {
  createTrainingJob,
  getProject,
  listProjectDocuments,
  listProjectModels,
} from "@/lib/aws/dynamo";
import { invokeTrainingAsync } from "@/lib/aws/trainer-invoker";
import { generateId } from "@/lib/crypto";
import { computeDatasetReadiness } from "@/lib/dataset-utils";
import type { TrainingJobRecord } from "@/lib/types";
import { StartTrainingSchema } from "@/lib/validation";

export async function POST(
  req: NextRequest,
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

    const parsed = StartTrainingSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Invalid training config" },
        { status: 400 }
      );
    }

    const [documents, existingModels] = await Promise.all([
      listProjectDocuments(projectId),
      listProjectModels(projectId),
    ]);

    const readiness = computeDatasetReadiness(documents, project.taskType);
    if (!readiness.ready) {
      return NextResponse.json(
        { error: readiness.blockers.join(" ") },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();
    const jobId = generateId("job");
    const jobSk = `JOB#${now}#${jobId}`;
    const nextVersion =
      existingModels.reduce((max, m) => Math.max(max, m.version || 0), 0) + 1;

    const job: TrainingJobRecord = {
      jobId,
      jobSk,
      projectId,
      status: "QUEUED",
      stage: "queued",
      progress: 5,
      config: parsed.data,
      datasetStats: { labeledSamples: readiness.labeledSamples },
      createdAt: now,
      updatedAt: now,
    };

    await createTrainingJob(job);
    await invokeTrainingAsync({
      projectId,
      jobId,
      jobSk,
      taskType: project.taskType,
      nextVersion,
      config: parsed.data,
    });

    return NextResponse.json({ job }, { status: 202 });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Failed to start training job",
      },
      { status: 500 }
    );
  }
}
