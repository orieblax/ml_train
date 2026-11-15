import { NextRequest, NextResponse } from "next/server";
import { requireWorkspaceAuth } from "@/lib/auth";
import { getJobById } from "@/lib/aws/dynamo";

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ jobId: string }> }
) {
  const authErr = await requireWorkspaceAuth();
  if (authErr) return authErr;

  const { jobId } = await context.params;
  try {
    const job = await getJobById(jobId);
    if (!job) {
      return NextResponse.json({ error: "Training job not found" }, { status: 404 });
    }
    return NextResponse.json({ job });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch job" },
      { status: 500 }
    );
  }
}
