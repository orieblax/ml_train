import fs from "fs";
import path from "path";
import {
  AddPermissionCommand,
  CreateFunctionCommand,
  CreateFunctionUrlConfigCommand,
  DeleteFunctionCommand,
  DeleteFunctionUrlConfigCommand,
  GetFunctionCommand,
  GetFunctionUrlConfigCommand,
  ResourceConflictException,
  ResourceNotFoundException,
  UpdateFunctionCodeCommand,
  UpdateFunctionConfigurationCommand,
} from "@aws-sdk/client-lambda";
import { zipSync } from "fflate";
import { getAwsClients } from "@/lib/aws/clients";
import {
  encryptSecret,
  generateModelApiKey,
  maskApiKey,
  sha256Hex,
} from "@/lib/crypto";
import { getAwsEnv, getSessionSecret } from "@/lib/env";

export function buildModelFunctionName(
  projectId: string,
  modelId: string
): string {
  const pClean = projectId.replace(/[^a-zA-Z0-9-]/g, "").slice(-8);
  const mClean = modelId.replace(/[^a-zA-Z0-9-]/g, "").slice(-12);
  return `mltrain-model-${pClean}-${mClean}`.toLowerCase();
}

export function buildInferenceZipBytes(): Uint8Array {
  const handlerPath = path.join(
    process.cwd(),
    "lambdas",
    "inference",
    "handler.py"
  );
  const source = fs.readFileSync(handlerPath);
  return zipSync({ "handler.py": new Uint8Array(source) }, { level: 9 });
}

async function waitForLambdaReady(functionName: string): Promise<void> {
  const { lambda } = getAwsClients();
  for (let attempt = 0; attempt < 30; attempt++) {
    const info = await lambda.send(
      new GetFunctionCommand({ FunctionName: functionName })
    );
    const state = info.Configuration?.State;
    const updateStatus = info.Configuration?.LastUpdateStatus;
    if (
      (state === "Active" || !state) &&
      (updateStatus === "Successful" || !updateStatus)
    ) {
      return;
    }
    if (state === "Failed" || updateStatus === "Failed") {
      throw new Error(
        `Lambda ${functionName} entered failed state: ${info.Configuration?.StateReason || info.Configuration?.LastUpdateStatusReason}`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  throw new Error(`Timed out waiting for Lambda ${functionName} to become Active`);
}

async function ensurePublicUrlPermissions(functionName: string): Promise<void> {
  const { lambda } = getAwsClients();

  const statements = [
    {
      StatementId: "FunctionURLAllowPublicAccess",
      Action: "lambda:InvokeFunctionUrl",
      Principal: "*",
      FunctionUrlAuthType: "NONE" as const,
    },
    {
      StatementId: "FunctionURLInvokeAllowPublicAccess",
      Action: "lambda:InvokeFunction",
      Principal: "*",
      InvokedViaFunctionUrl: true,
    },
  ];

  for (const stmt of statements) {
    try {
      await lambda.send(
        new AddPermissionCommand({
          FunctionName: functionName,
          ...stmt,
        })
      );
    } catch (err) {
      if (!(err instanceof ResourceConflictException)) {
        throw err;
      }
    }
  }
}

export async function deployModelLambda(params: {
  projectId: string;
  modelId: string;
  s3ModelKey: string;
  memoryMb: number;
  timeoutSec: number;
  authEnabled: boolean;
}): Promise<{
  functionName: string;
  functionArn: string;
  functionUrl: string;
  apiKeyPlaintext: string | null;
  apiKeyMasked: string;
  apiKeyEncrypted?: string;
}> {
  const { lambda } = getAwsClients();
  const env = getAwsEnv();
  const functionName = buildModelFunctionName(params.projectId, params.modelId);
  const zipBytes = buildInferenceZipBytes();

  const apiKeyPlaintext = params.authEnabled ? generateModelApiKey() : null;
  const apiKeyHash = apiKeyPlaintext ? sha256Hex(apiKeyPlaintext) : "";
  const apiKeyMasked = apiKeyPlaintext ? maskApiKey(apiKeyPlaintext) : "Disabled";
  const apiKeyEncrypted = apiKeyPlaintext
    ? encryptSecret(apiKeyPlaintext, getSessionSecret())
    : undefined;

  const envVars = {
    MODEL_BUCKET: env.MLTRAIN_S3_BUCKET,
    MODEL_KEY: params.s3ModelKey,
    MODEL_ID: params.modelId,
    API_KEY_HASH: apiKeyHash,
  };

  let functionArn = "";
  let exists = true;
  try {
    const existing = await lambda.send(
      new GetFunctionCommand({ FunctionName: functionName })
    );
    functionArn = existing.Configuration?.FunctionArn || "";
  } catch (err) {
    if (err instanceof ResourceNotFoundException) {
      exists = false;
    } else {
      throw err;
    }
  }

  if (!exists) {
    const created = await lambda.send(
      new CreateFunctionCommand({
        FunctionName: functionName,
        Runtime: "python3.12",
        Architectures: ["x86_64"],
        Role: env.MLTRAIN_INFERENCE_ROLE_ARN,
        Handler: "handler.lambda_handler",
        Code: { ZipFile: zipBytes },
        Layers: [env.MLTRAIN_ML_LAYER_ARN],
        MemorySize: params.memoryMb,
        Timeout: params.timeoutSec,
        Description: `ml_train model ${params.modelId} for project ${params.projectId}`,
        Environment: { Variables: envVars },
        Tags: {
          App: "ml_train",
          ProjectId: params.projectId,
          ModelId: params.modelId,
        },
      })
    );
    functionArn = created.FunctionArn || "";
    await waitForLambdaReady(functionName);
  } else {
    await lambda.send(
      new UpdateFunctionCodeCommand({
        FunctionName: functionName,
        ZipFile: zipBytes,
      })
    );
    await waitForLambdaReady(functionName);
    const updated = await lambda.send(
      new UpdateFunctionConfigurationCommand({
        FunctionName: functionName,
        Layers: [env.MLTRAIN_ML_LAYER_ARN],
        MemorySize: params.memoryMb,
        Timeout: params.timeoutSec,
        Environment: { Variables: envVars },
      })
    );
    functionArn = updated.FunctionArn || functionArn;
    await waitForLambdaReady(functionName);
  }

  let functionUrl = "";
  try {
    const urlCfg = await lambda.send(
      new GetFunctionUrlConfigCommand({ FunctionName: functionName })
    );
    functionUrl = urlCfg.FunctionUrl || "";
  } catch (err) {
    if (err instanceof ResourceNotFoundException) {
      const createdUrl = await lambda.send(
        new CreateFunctionUrlConfigCommand({
          FunctionName: functionName,
          AuthType: "NONE",
          Cors: {
            AllowOrigins: ["*"],
            AllowMethods: ["GET", "POST"],
            AllowHeaders: ["content-type", "authorization", "x-api-key"],
            MaxAge: 3600,
          },
        })
      );
      functionUrl = createdUrl.FunctionUrl || "";
    } else {
      throw err;
    }
  }

  await ensurePublicUrlPermissions(functionName);

  return {
    functionName,
    functionArn,
    functionUrl,
    apiKeyPlaintext,
    apiKeyMasked,
    apiKeyEncrypted,
  };
}

export async function deleteModelLambda(functionName: string): Promise<void> {
  const { lambda } = getAwsClients();
  try {
    await lambda.send(
      new DeleteFunctionUrlConfigCommand({ FunctionName: functionName })
    );
  } catch (err) {
    if (!(err instanceof ResourceNotFoundException)) {
      throw err;
    }
  }

  try {
    await lambda.send(
      new DeleteFunctionCommand({ FunctionName: functionName })
    );
  } catch (err) {
    if (!(err instanceof ResourceNotFoundException)) {
      throw err;
    }
  }
}
