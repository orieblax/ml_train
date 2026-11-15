import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { LambdaClient } from "@aws-sdk/client-lambda";
import { S3Client } from "@aws-sdk/client-s3";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { getAwsEnv } from "@/lib/env";

interface AwsClientBundle {
  region: string;
  s3: S3Client;
  ddb: DynamoDBDocumentClient;
  rawDdb: DynamoDBClient;
  lambda: LambdaClient;
}

const globalForAws = globalThis as unknown as {
  __mltrainAwsClients?: AwsClientBundle;
};

export function getAwsClients(): AwsClientBundle {
  const env = getAwsEnv();
  if (
    globalForAws.__mltrainAwsClients &&
    globalForAws.__mltrainAwsClients.region === env.AWS_REGION
  ) {
    return globalForAws.__mltrainAwsClients;
  }

  const credentials = {
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
  };

  const rawDdb = new DynamoDBClient({ region: env.AWS_REGION, credentials });
  const ddb = DynamoDBDocumentClient.from(rawDdb, {
    marshallOptions: { removeUndefinedValues: true },
  });
  const s3 = new S3Client({ region: env.AWS_REGION, credentials });
  const lambda = new LambdaClient({ region: env.AWS_REGION, credentials });

  const bundle: AwsClientBundle = {
    region: env.AWS_REGION,
    s3,
    ddb,
    rawDdb,
    lambda,
  };
  globalForAws.__mltrainAwsClients = bundle;
  return bundle;
}
