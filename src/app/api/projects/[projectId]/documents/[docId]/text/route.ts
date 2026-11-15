import { NextRequest, NextResponse } from "next/server";
import { requireWorkspaceAuth } from "@/lib/auth";
import { getDocument } from "@/lib/aws/dynamo";
import { getS3Text } from "@/lib/aws/s3";

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ projectId: string; docId: string }> }
) {
  const authErr = await requireWorkspaceAuth();
  if (authErr) return authErr;

  const { projectId, docId } = await context.params;
  try {
    const doc = await getDocument(projectId, docId);
    if (!doc) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    if (!doc.s3TextKey) {
      return NextResponse.json({ text: "", rows: [] });
    }

    const rawText = await getS3Text(doc.s3TextKey);
    if (doc.sourceType === "csv_dataset") {
      const rows = rawText
        .split("\n")
        .filter(Boolean)
        .slice(0, 100)
        .map((line) => JSON.parse(line) as { text: string; labels: string[] });
      return NextResponse.json({ sourceType: doc.sourceType, rows });
    }

    return NextResponse.json({ sourceType: doc.sourceType, text: rawText });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Failed to load document text",
      },
      { status: 500 }
    );
  }
}
