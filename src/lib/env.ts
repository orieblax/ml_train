import { z } from "zod";

const AwsEnvSchema = z.object({
  AWS_REGION: z.string().min(1),
  AWS_ACCESS_KEY_ID: z.string().min(1),
  AWS_SECRET_ACCESS_KEY: z.string().min(1),
  MLTRAIN_S3_BUCKET: z.string().min(1),
  MLTRAIN_DDB_TABLE: z.string().min(1),
  MLTRAIN_TRAINER_LAMBDA_ARN: z.string().min(1),
  MLTRAIN_ML_LAYER_ARN: z.string().min(1),
  MLTRAIN_INFERENCE_ROLE_ARN: z.string().min(1),
});

export type AwsEnvConfig = z.infer<typeof AwsEnvSchema>;

export const REQUIRED_AWS_ENV_KEYS = [
  "AWS_REGION",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "MLTRAIN_S3_BUCKET",
  "MLTRAIN_DDB_TABLE",
  "MLTRAIN_TRAINER_LAMBDA_ARN",
  "MLTRAIN_ML_LAYER_ARN",
  "MLTRAIN_INFERENCE_ROLE_ARN",
] as const;

export function getEnvMissingKeys(): string[] {
  return REQUIRED_AWS_ENV_KEYS.filter((k) => !process.env[k]?.trim());
}

export function isAwsConfigured(): boolean {
  return getEnvMissingKeys().length === 0;
}

export function getAwsEnv(): AwsEnvConfig {
  const parsed = AwsEnvSchema.safeParse({
    AWS_REGION: process.env.AWS_REGION,
    AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
    MLTRAIN_S3_BUCKET: process.env.MLTRAIN_S3_BUCKET,
    MLTRAIN_DDB_TABLE: process.env.MLTRAIN_DDB_TABLE,
    MLTRAIN_TRAINER_LAMBDA_ARN: process.env.MLTRAIN_TRAINER_LAMBDA_ARN,
    MLTRAIN_ML_LAYER_ARN: process.env.MLTRAIN_ML_LAYER_ARN,
    MLTRAIN_INFERENCE_ROLE_ARN: process.env.MLTRAIN_INFERENCE_ROLE_ARN,
  });

  if (!parsed.success) {
    const missing = getEnvMissingKeys();
    throw new Error(
      `AWS studio environment is not fully configured. Missing: ${missing.join(", ")}`
    );
  }
  return parsed.data;
}

export function getSessionSecret(): string {
  const secret = process.env.MLTRAIN_SESSION_SECRET?.trim();
  if (secret && secret.length >= 16) {
    return secret;
  }
  // Deterministic development fallback when optional secret isn't set
  const accessKey = process.env.AWS_SECRET_ACCESS_KEY?.trim() || "mltrain-local-dev";
  return `mltrain-fallback-secret:${accessKey}`;
}

export interface WorkspaceAuthConfig {
  authRequired: boolean;
  configured: boolean;
  username: string | null;
  password: string | null;
}

export function getAuthConfig(): WorkspaceAuthConfig {
  const disabled =
    process.env.APP_AUTH_DISABLED?.trim().toLowerCase() === "true";
  const rawUser =
    process.env.APP_USERNAME?.trim() ||
    process.env.MLTRAIN_USERNAME?.trim() ||
    process.env.AUTH_USERNAME?.trim() ||
    "";
  const rawPass =
    process.env.APP_PASSWORD?.trim() ||
    process.env.MLTRAIN_PASSWORD?.trim() ||
    process.env.AUTH_PASSWORD?.trim() ||
    "";
  const legacyPin = process.env.APP_ACCESS_PIN?.trim() || "";

  const username = rawUser || (legacyPin ? "admin" : null);
  const password = rawPass || (legacyPin ? legacyPin : null);
  const configured = Boolean(username && password);

  return {
    authRequired: !disabled,
    configured,
    username: configured ? username : null,
    password: configured ? password : null,
  };
}
