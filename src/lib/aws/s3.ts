import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getAwsClients } from "@/lib/aws/clients";
import { getAwsEnv } from "@/lib/env";
import type { ModelMetrics } from "@/lib/types";

export function buildRawDocumentS3Key(
  projectId: string,
  docId: string,
  fileName: string
): string {
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `projects/${projectId}/raw/${docId}/${safeName}`;
}

export async function createDocumentUploadUrl(params: {
  projectId: string;
  docId: string;
  fileName: string;
  contentType: string;
}): Promise<{ uploadUrl: string; s3RawKey: string }> {
  const { s3 } = getAwsClients();
  const env = getAwsEnv();
  const s3RawKey = buildRawDocumentS3Key(
    params.projectId,
    params.docId,
    params.fileName
  );

  const command = new PutObjectCommand({
    Bucket: env.MLTRAIN_S3_BUCKET,
    Key: s3RawKey,
    ContentType: params.contentType || "application/octet-stream",
  });

  const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 300 });
  return { uploadUrl, s3RawKey };
}

export async function getS3Json<T = unknown>(key: string): Promise<T> {
  const { s3 } = getAwsClients();
  const env = getAwsEnv();
  const resp = await s3.send(
    new GetObjectCommand({ Bucket: env.MLTRAIN_S3_BUCKET, Key: key })
  );
  const text = await resp.Body?.transformToString("utf-8");
  if (!text) {
    throw new Error(`Empty S3 object at ${key}`);
  }
  return JSON.parse(text) as T;
}

export async function getS3Text(key: string): Promise<string> {
  const { s3 } = getAwsClients();
  const env = getAwsEnv();
  const resp = await s3.send(
    new GetObjectCommand({ Bucket: env.MLTRAIN_S3_BUCKET, Key: key })
  );
  return (await resp.Body?.transformToString("utf-8")) || "";
}

export async function getModelMetricsFromS3(
  s3MetricsKey: string
): Promise<ModelMetrics> {
  return getS3Json<ModelMetrics>(s3MetricsKey);
}

export async function deleteS3Prefix(prefix: string): Promise<void> {
  const { s3 } = getAwsClients();
  const env = getAwsEnv();
  let continuationToken: string | undefined;

  do {
    const listed = await s3.send(
      new ListObjectsV2Command({
        Bucket: env.MLTRAIN_S3_BUCKET,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      })
    );
    const objects = (listed.Contents || [])
      .filter((o) => o.Key)
      .map((o) => ({ Key: o.Key! }));
    if (objects.length > 0) {
      await s3.send(
        new DeleteObjectsCommand({
          Bucket: env.MLTRAIN_S3_BUCKET,
          Delete: { Objects: objects },
        })
      );
    }
    continuationToken = listed.IsTruncated
      ? listed.NextContinuationToken
      : undefined;
  } while (continuationToken);
}
