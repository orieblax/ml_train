import {
  BatchWriteCommand,
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { getAwsClients } from "@/lib/aws/clients";
import { getAwsEnv } from "@/lib/env";
import type {
  DeploymentRecord,
  DocumentRecord,
  ModelVersionRecord,
  ProjectRecord,
  TrainingJobRecord,
} from "@/lib/types";

const WORKSPACE_PK = "WORKSPACE#default";

export function buildProjectKeys(projectId: string) {
  return { PK: WORKSPACE_PK, SK: `PROJECT#${projectId}` };
}

export function buildDocumentKeys(projectId: string, docId: string) {
  return { PK: `PROJECT#${projectId}`, SK: `DOC#${docId}` };
}

export function buildJobKeys(projectId: string, createdAt: string, jobId: string) {
  return {
    PK: `PROJECT#${projectId}`,
    SK: `JOB#${createdAt}#${jobId}`,
    GSI1PK: `JOB#${jobId}`,
    GSI1SK: "META",
  };
}

export function buildDeploymentKeys(deploymentId: string, modelId: string) {
  return {
    PK: WORKSPACE_PK,
    SK: `DEPLOY#${deploymentId}`,
    GSI1PK: `MODEL#${modelId}`,
    GSI1SK: `DEPLOY#${deploymentId}`,
  };
}

function tableName(): string {
  return getAwsEnv().MLTRAIN_DDB_TABLE;
}

export async function listProjects(): Promise<ProjectRecord[]> {
  const { ddb } = getAwsClients();
  const resp = await ddb.send(
    new QueryCommand({
      TableName: tableName(),
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      ExpressionAttributeValues: {
        ":pk": WORKSPACE_PK,
        ":sk": "PROJECT#",
      },
    })
  );
  const items = (resp.Items || []) as ProjectRecord[];
  return items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getProject(projectId: string): Promise<ProjectRecord | null> {
  const { ddb } = getAwsClients();
  const resp = await ddb.send(
    new GetCommand({
      TableName: tableName(),
      Key: buildProjectKeys(projectId),
    })
  );
  return (resp.Item as ProjectRecord) || null;
}

export async function putProject(project: ProjectRecord): Promise<void> {
  const { ddb } = getAwsClients();
  await ddb.send(
    new PutCommand({
      TableName: tableName(),
      Item: {
        ...buildProjectKeys(project.projectId),
        entityType: "PROJECT",
        ...project,
      },
    })
  );
}

export async function updateProject(
  projectId: string,
  updates: Partial<Pick<ProjectRecord, "name" | "description" | "labels">>
): Promise<ProjectRecord | null> {
  const { ddb } = getAwsClients();
  const parts: string[] = ["updatedAt = :updatedAt"];
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {
    ":updatedAt": new Date().toISOString(),
  };

  if (updates.name !== undefined) {
    names["#name"] = "name";
    values[":name"] = updates.name;
    parts.push("#name = :name");
  }
  if (updates.description !== undefined) {
    names["#desc"] = "description";
    values[":desc"] = updates.description;
    parts.push("#desc = :desc");
  }
  if (updates.labels !== undefined) {
    names["#labels"] = "labels";
    values[":labels"] = updates.labels;
    parts.push("#labels = :labels");
  }

  const resp = await ddb.send(
    new UpdateCommand({
      TableName: tableName(),
      Key: buildProjectKeys(projectId),
      UpdateExpression: `SET ${parts.join(", ")}`,
      ExpressionAttributeNames: Object.keys(names).length ? names : undefined,
      ExpressionAttributeValues: values,
      ConditionExpression: "attribute_exists(PK)",
      ReturnValues: "ALL_NEW",
    })
  );
  return (resp.Attributes as ProjectRecord) || null;
}

export async function listProjectDocuments(
  projectId: string
): Promise<DocumentRecord[]> {
  const { ddb } = getAwsClients();
  const items: DocumentRecord[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const resp = await ddb.send(
      new QueryCommand({
        TableName: tableName(),
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
        ExpressionAttributeValues: {
          ":pk": `PROJECT#${projectId}`,
          ":sk": "DOC#",
        },
        ExclusiveStartKey: exclusiveStartKey,
      })
    );
    items.push(...((resp.Items || []) as DocumentRecord[]));
    exclusiveStartKey = resp.LastEvaluatedKey;
  } while (exclusiveStartKey);

  return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getDocument(
  projectId: string,
  docId: string
): Promise<DocumentRecord | null> {
  const { ddb } = getAwsClients();
  const resp = await ddb.send(
    new GetCommand({
      TableName: tableName(),
      Key: buildDocumentKeys(projectId, docId),
    })
  );
  return (resp.Item as DocumentRecord) || null;
}

export async function updateDocumentLabels(
  projectId: string,
  docId: string,
  labels: string[]
): Promise<DocumentRecord | null> {
  const { ddb } = getAwsClients();
  const resp = await ddb.send(
    new UpdateCommand({
      TableName: tableName(),
      Key: buildDocumentKeys(projectId, docId),
      UpdateExpression: "SET labels = :labels, updatedAt = :updatedAt",
      ExpressionAttributeValues: {
        ":labels": labels,
        ":updatedAt": new Date().toISOString(),
      },
      ConditionExpression: "attribute_exists(PK)",
      ReturnValues: "ALL_NEW",
    })
  );
  return (resp.Attributes as DocumentRecord) || null;
}

export async function deleteDocumentRecord(
  projectId: string,
  docId: string
): Promise<void> {
  const { ddb } = getAwsClients();
  await ddb.send(
    new DeleteCommand({
      TableName: tableName(),
      Key: buildDocumentKeys(projectId, docId),
    })
  );
}

export async function createTrainingJob(job: TrainingJobRecord): Promise<void> {
  const { ddb } = getAwsClients();
  const keys = buildJobKeys(job.projectId, job.createdAt, job.jobId);
  await ddb.send(
    new PutCommand({
      TableName: tableName(),
      Item: {
        ...keys,
        entityType: "JOB",
        ...job,
        jobSk: keys.SK,
      },
    })
  );
}

export async function listProjectJobs(
  projectId: string
): Promise<TrainingJobRecord[]> {
  const { ddb } = getAwsClients();
  const resp = await ddb.send(
    new QueryCommand({
      TableName: tableName(),
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      ExpressionAttributeValues: {
        ":pk": `PROJECT#${projectId}`,
        ":sk": "JOB#",
      },
      ScanIndexForward: false,
      Limit: 25,
    })
  );
  return (resp.Items || []) as TrainingJobRecord[];
}

export async function getJobById(jobId: string): Promise<TrainingJobRecord | null> {
  const { ddb } = getAwsClients();
  const resp = await ddb.send(
    new QueryCommand({
      TableName: tableName(),
      IndexName: "GSI1",
      KeyConditionExpression: "GSI1PK = :pk AND GSI1SK = :sk",
      ExpressionAttributeValues: {
        ":pk": `JOB#${jobId}`,
        ":sk": "META",
      },
      Limit: 1,
    })
  );
  return ((resp.Items || [])[0] as TrainingJobRecord) || null;
}

export async function listProjectModels(
  projectId: string
): Promise<ModelVersionRecord[]> {
  const { ddb } = getAwsClients();
  const resp = await ddb.send(
    new QueryCommand({
      TableName: tableName(),
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      ExpressionAttributeValues: {
        ":pk": `PROJECT#${projectId}`,
        ":sk": "MODEL#",
      },
      ScanIndexForward: false,
      Limit: 30,
    })
  );
  return (resp.Items || []) as ModelVersionRecord[];
}

export async function getModelById(
  modelId: string
): Promise<ModelVersionRecord | null> {
  const { ddb } = getAwsClients();
  const resp = await ddb.send(
    new QueryCommand({
      TableName: tableName(),
      IndexName: "GSI1",
      KeyConditionExpression: "GSI1PK = :pk AND GSI1SK = :sk",
      ExpressionAttributeValues: {
        ":pk": `MODEL#${modelId}`,
        ":sk": "META",
      },
      Limit: 1,
    })
  );
  return ((resp.Items || [])[0] as ModelVersionRecord) || null;
}

export async function putDeployment(deployment: DeploymentRecord): Promise<void> {
  const { ddb } = getAwsClients();
  const keys = buildDeploymentKeys(deployment.deploymentId, deployment.modelId);
  await ddb.send(
    new PutCommand({
      TableName: tableName(),
      Item: {
        ...keys,
        entityType: "DEPLOYMENT",
        ...deployment,
      },
    })
  );
}

export async function getDeployment(
  deploymentId: string
): Promise<DeploymentRecord | null> {
  const { ddb } = getAwsClients();
  const resp = await ddb.send(
    new GetCommand({
      TableName: tableName(),
      Key: { PK: WORKSPACE_PK, SK: `DEPLOY#${deploymentId}` },
    })
  );
  return (resp.Item as DeploymentRecord) || null;
}

export async function listDeployments(): Promise<DeploymentRecord[]> {
  const { ddb } = getAwsClients();
  const resp = await ddb.send(
    new QueryCommand({
      TableName: tableName(),
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      ExpressionAttributeValues: {
        ":pk": WORKSPACE_PK,
        ":sk": "DEPLOY#",
      },
    })
  );
  const items = (resp.Items || []) as DeploymentRecord[];
  return items
    .filter((d) => d.status !== "DELETED")
    .sort((a, b) => b.lastDeployedAt.localeCompare(a.lastDeployedAt));
}

export async function listModelDeployments(
  modelId: string
): Promise<DeploymentRecord[]> {
  const { ddb } = getAwsClients();
  const resp = await ddb.send(
    new QueryCommand({
      TableName: tableName(),
      IndexName: "GSI1",
      KeyConditionExpression: "GSI1PK = :pk AND begins_with(GSI1SK, :sk)",
      ExpressionAttributeValues: {
        ":pk": `MODEL#${modelId}`,
        ":sk": "DEPLOY#",
      },
    })
  );
  return ((resp.Items || []) as DeploymentRecord[]).filter(
    (d) => d.status !== "DELETED"
  );
}

export async function deleteDeploymentRecord(
  deploymentId: string
): Promise<void> {
  const { ddb } = getAwsClients();
  await ddb.send(
    new DeleteCommand({
      TableName: tableName(),
      Key: { PK: WORKSPACE_PK, SK: `DEPLOY#${deploymentId}` },
    })
  );
}

export async function deleteProjectCascadeFromDb(
  projectId: string
): Promise<void> {
  const { ddb } = getAwsClients();
  const keysToDelete: Array<{ PK: string; SK: string }> = [
    buildProjectKeys(projectId),
  ];

  let exclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const resp = await ddb.send(
      new QueryCommand({
        TableName: tableName(),
        KeyConditionExpression: "PK = :pk",
        ExpressionAttributeValues: { ":pk": `PROJECT#${projectId}` },
        ProjectionExpression: "PK, SK",
        ExclusiveStartKey: exclusiveStartKey,
      })
    );
    for (const item of resp.Items || []) {
      keysToDelete.push({ PK: String(item.PK), SK: String(item.SK) });
    }
    exclusiveStartKey = resp.LastEvaluatedKey;
  } while (exclusiveStartKey);

  // BatchWrite supports up to 25 requests per batch
  for (let i = 0; i < keysToDelete.length; i += 25) {
    const batch = keysToDelete.slice(i, i + 25).map((Key) => ({
      DeleteRequest: { Key },
    }));
    await ddb.send(
      new BatchWriteCommand({
        RequestItems: { [tableName()]: batch },
      })
    );
  }
}
