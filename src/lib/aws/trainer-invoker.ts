import { InvokeCommand } from "@aws-sdk/client-lambda";
import { getAwsClients } from "@/lib/aws/clients";
import { getAwsEnv } from "@/lib/env";
import type { TaskType, TrainingConfig } from "@/lib/types";

export async function invokeDocumentExtract(params: {
  projectId: string;
  docId: string;
  fileName: string;
  mimeType?: string;
  s3RawKey: string;
  taskType: TaskType;
  labels: string[];
  textColumn?: string;
  labelColumn?: string;
}): Promise<Record<string, unknown>> {
  const { lambda } = getAwsClients();
  const env = getAwsEnv();

  const resp = await lambda.send(
    new InvokeCommand({
      FunctionName: env.MLTRAIN_TRAINER_LAMBDA_ARN,
      InvocationType: "RequestResponse",
      Payload: Buffer.from(
        JSON.stringify({
          action: "extract",
          bucket: env.MLTRAIN_S3_BUCKET,
          ...params,
        })
      ),
    })
  );

  const rawText = resp.Payload
    ? Buffer.from(resp.Payload).toString("utf-8")
    : "{}";
  const parsed = JSON.parse(rawText) as Record<string, unknown>;

  if (resp.FunctionError) {
    const errMsg =
      (parsed.errorMessage as string) ||
      (parsed.error as string) ||
      "Document extraction failed in Lambda worker";
    throw new Error(errMsg);
  }

  return parsed;
}

export async function invokeTrainingAsync(params: {
  projectId: string;
  jobId: string;
  jobSk: string;
  taskType: TaskType;
  nextVersion: number;
  config: TrainingConfig;
}): Promise<void> {
  const { lambda } = getAwsClients();
  const env = getAwsEnv();

  const resp = await lambda.send(
    new InvokeCommand({
      FunctionName: env.MLTRAIN_TRAINER_LAMBDA_ARN,
      InvocationType: "Event",
      Payload: Buffer.from(
        JSON.stringify({
          action: "train",
          bucket: env.MLTRAIN_S3_BUCKET,
          ...params,
        })
      ),
    })
  );

  if (resp.StatusCode && resp.StatusCode >= 300) {
    throw new Error(
      `Unexpected AWS Lambda Event invocation status: ${resp.StatusCode}`
    );
  }
}
