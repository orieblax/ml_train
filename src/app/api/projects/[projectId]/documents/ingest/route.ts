import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { NextRequest, NextResponse } from "next/server";
import { requireWorkspaceAuth } from "@/lib/auth";
import { getAwsClients } from "@/lib/aws/clients";
import {
  deleteDocumentRecord,
  getDocument,
  getProject,
  updateDocumentLabels,
  updateProject,
} from "@/lib/aws/dynamo";
import { invokeDocumentExtract } from "@/lib/aws/trainer-invoker";
import { getAwsEnv } from "@/lib/env";
import {
  IngestDocumentSchema,
  UpdateDocumentLabelsSchema,
} from "@/lib/validation";

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

    const parsed = IngestDocumentSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Invalid ingest payload" },
        { status: 400 }
      );
    }

    const result = await invokeDocumentExtract({
      projectId,
      docId: parsed.data.docId,
      fileName: parsed.data.fileName,
      mimeType: parsed.data.mimeType,
      s3RawKey: parsed.data.s3RawKey,
      taskType: project.taskType,
      labels: parsed.data.labels,
      textColumn: parsed.data.textColumn,
      labelColumn: parsed.data.labelColumn,
    });

    // Merge newly observed labels into project label palette
    const discoveredLabels = new Set(project.labels || []);
    for (const lbl of parsed.data.labels) {
      if (lbl.trim()) discoveredLabels.add(lbl.trim());
    }
    if (result.labelCounts && typeof result.labelCounts === "object") {
      for (const lbl of Object.keys(result.labelCounts as Record<string, number>)) {
        if (lbl.trim()) discoveredLabels.add(lbl.trim());
      }
    }

    const merged = Array.from(discoveredLabels);
    if (merged.length !== (project.labels || []).length) {
      await updateProject(projectId, { labels: merged });
    }

    const document = await getDocument(projectId, parsed.data.docId);
    return NextResponse.json({ result, document, labels: merged }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Document ingestion failed",
      },
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
    const project = await getProject(projectId);
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const parsed = UpdateDocumentLabelsSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Invalid labels payload" },
        { status: 400 }
      );
    }

    const cleanLabels = Array.from(
      new Set(parsed.data.labels.map((l) => l.trim()).filter(Boolean))
    );
    const updated = await updateDocumentLabels(
      projectId,
      parsed.data.docId,
      cleanLabels
    );
    if (!updated) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    const merged = Array.from(new Set([...(project.labels || []), ...cleanLabels]));
    if (merged.length !== (project.labels || []).length) {
      await updateProject(projectId, { labels: merged });
    }

    return NextResponse.json({ document: updated, labels: merged });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Failed to update document labels",
      },
      { status: 500 }
    );
  }
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) {
  const authErr = await requireWorkspaceAuth();
  if (authErr) return authErr;

  const { projectId } = await context.params;
  try {
    const docId = req.nextUrl.searchParams.get("docId");
    if (!docId) {
      return NextResponse.json(
        { error: "docId query parameter is required" },
        { status: 400 }
      );
    }

    const doc = await getDocument(projectId, docId);
    if (!doc) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    const { s3 } = getAwsClients();
    const bucket = getAwsEnv().MLTRAIN_S3_BUCKET;
    await Promise.all(
      [doc.s3RawKey, doc.s3TextKey]
        .filter(Boolean)
        .map((Key) =>
          s3.send(new DeleteObjectCommand({ Bucket: bucket, Key })).catch(() => null)
        )
    );

    await deleteDocumentRecord(projectId, docId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Failed to delete document",
      },
      { status: 500 }
    );
  }
}
