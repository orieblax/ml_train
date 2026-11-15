import { NextRequest, NextResponse } from "next/server";
import { requireWorkspaceAuth } from "@/lib/auth";
import { getProject } from "@/lib/aws/dynamo";
import { createDocumentUploadUrl } from "@/lib/aws/s3";
import { generateId } from "@/lib/crypto";
import { PresignUploadSchema } from "@/lib/validation";

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

    const parsed = PresignUploadSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Invalid file metadata" },
        { status: 400 }
      );
    }

    const docId = generateId("doc");
    const { uploadUrl, s3RawKey } = await createDocumentUploadUrl({
      projectId,
      docId,
      fileName: parsed.data.fileName,
      contentType: parsed.data.contentType,
    });

    return NextResponse.json({ docId, uploadUrl, s3RawKey });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Failed to presign upload URL",
      },
      { status: 500 }
    );
  }
}
