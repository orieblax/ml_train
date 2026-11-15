import { DescribeTableCommand } from "@aws-sdk/client-dynamodb";
import { GetFunctionCommand, GetLayerVersionCommand } from "@aws-sdk/client-lambda";
import { HeadBucketCommand } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { getAwsClients } from "@/lib/aws/clients";
import { getAwsEnv, getEnvMissingKeys, isAwsConfigured } from "@/lib/env";
import type { DiagnosticCheck } from "@/lib/types";

function parseLayerArn(arn: string): { layerName: string; version: number } | null {
  const parts = arn.split(":");
  if (parts.length < 2) return null;
  const version = Number(parts[parts.length - 1]);
  const layerName = parts[parts.length - 2];
  if (!layerName || !Number.isInteger(version)) return null;
  return { layerName, version };
}

export async function GET() {
  const missingKeys = getEnvMissingKeys();
  if (!isAwsConfigured()) {
    return NextResponse.json({
      configured: false,
      healthy: false,
      missingKeys,
      checks: missingKeys.map((k) => ({
        name: `ENV:${k}`,
        ok: false,
        detail: "Environment variable not set",
      })),
    });
  }

  const env = getAwsEnv();
  const { s3, rawDdb, lambda } = getAwsClients();
  const checks: DiagnosticCheck[] = [];

  try {
    await s3.send(new HeadBucketCommand({ Bucket: env.MLTRAIN_S3_BUCKET }));
    checks.push({
      name: "S3 Bucket",
      ok: true,
      detail: `Connected to s3://${env.MLTRAIN_S3_BUCKET}`,
    });
  } catch (err) {
    checks.push({
      name: "S3 Bucket",
      ok: false,
      detail: err instanceof Error ? err.message : "S3 check failed",
    });
  }

  try {
    const tbl = await rawDdb.send(
      new DescribeTableCommand({ TableName: env.MLTRAIN_DDB_TABLE })
    );
    checks.push({
      name: "DynamoDB Table",
      ok: tbl.Table?.TableStatus === "ACTIVE",
      detail: `${env.MLTRAIN_DDB_TABLE} (${tbl.Table?.TableStatus || "UNKNOWN"})`,
    });
  } catch (err) {
    checks.push({
      name: "DynamoDB Table",
      ok: false,
      detail: err instanceof Error ? err.message : "DynamoDB check failed",
    });
  }

  try {
    const fn = await lambda.send(
      new GetFunctionCommand({ FunctionName: env.MLTRAIN_TRAINER_LAMBDA_ARN })
    );
    checks.push({
      name: "Trainer Lambda",
      ok: fn.Configuration?.State === "Active",
      detail: `${fn.Configuration?.FunctionName} (${fn.Configuration?.Runtime}, ${fn.Configuration?.MemorySize} MB)`,
    });
  } catch (err) {
    checks.push({
      name: "Trainer Lambda",
      ok: false,
      detail: err instanceof Error ? err.message : "Trainer Lambda check failed",
    });
  }

  const layerParts = parseLayerArn(env.MLTRAIN_ML_LAYER_ARN);
  if (layerParts) {
    try {
      const layer = await lambda.send(
        new GetLayerVersionCommand({
          LayerName: layerParts.layerName,
          VersionNumber: layerParts.version,
        })
      );
      checks.push({
        name: "Shared ML Layer",
        ok: Boolean(layer.LayerVersionArn),
        detail: `${layerParts.layerName}:v${layerParts.version} (${Math.round((layer.Content?.CodeSize || 0) / 1024 / 1024)} MB zipped)`,
      });
    } catch (err) {
      checks.push({
        name: "Shared ML Layer",
        ok: false,
        detail: err instanceof Error ? err.message : "ML Layer check failed",
      });
    }
  }

  return NextResponse.json({
    configured: true,
    healthy: checks.every((c) => c.ok),
    missingKeys: [],
    region: env.AWS_REGION,
    checks,
  });
}
