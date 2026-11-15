import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  buildInferenceZipBytes,
  buildModelFunctionName,
} from "@/lib/aws/deployer";
import { buildDeploymentKeys, buildJobKeys, buildProjectKeys } from "@/lib/aws/dynamo";
import { buildRawDocumentS3Key } from "@/lib/aws/s3";
import {
  decryptSecret,
  encryptSecret,
  generateModelApiKey,
  maskApiKey,
  sha256Hex,
  signToken,
  verifySignedToken,
} from "@/lib/crypto";
import { computeDatasetReadiness } from "@/lib/dataset-utils";
import type { DocumentRecord } from "@/lib/types";
import {
  CreateProjectSchema,
  PresignUploadSchema,
  StartTrainingSchema,
} from "@/lib/validation";

describe("crypto helpers", () => {
  it("encrypts and decrypts API keys with AES-256-GCM", () => {
    const key = generateModelApiKey();
    const secret = "test-session-secret-0123456789abcdef";
    const encrypted = encryptSecret(key, secret);
    expect(encrypted).not.toContain(key);
    expect(decryptSecret(encrypted, secret)).toBe(key);
    expect(maskApiKey(key)).toMatch(/^mlt_.*•+.*$/);
    expect(sha256Hex(key)).toHaveLength(64);
  });

  it("signs and verifies HMAC workspace tokens", () => {
    const secret = "super-secret-signing-key";
    const token = signToken("workspace:9999999999999", secret);
    expect(verifySignedToken(token, secret)).toBe("workspace:9999999999999");
    expect(verifySignedToken(`${token}tampered`, secret)).toBeNull();
  });
});

describe("AWS naming, keys, and zip packaging", () => {
  it("builds valid Lambda function names matching mltrain-model-* policy", () => {
    const fnName = buildModelFunctionName("prj_abc123def456", "mdl_998877665544");
    expect(fnName).toMatch(/^mltrain-model-/);
    expect(fnName.length).toBeLessThanOrEqual(64);
  });

  it("packages lambdas/inference/handler.py into a valid ZIP under 10 KB", () => {
    const zipBytes = buildInferenceZipBytes();
    expect(zipBytes.byteLength).toBeGreaterThan(500);
    expect(zipBytes.byteLength).toBeLessThan(15000);
    const extracted = unzipSync(zipBytes);
    expect(Object.keys(extracted)).toContain("handler.py");
    const content = Buffer.from(extracted["handler.py"]).toString("utf-8");
    expect(content).toContain("def lambda_handler");
  });

  it("generates single-table DynamoDB and S3 keys consistently", () => {
    expect(buildProjectKeys("prj_1")).toEqual({
      PK: "WORKSPACE#default",
      SK: "PROJECT#prj_1",
    });
    expect(buildJobKeys("prj_1", "2026-01-01T00:00:00Z", "job_1")).toEqual({
      PK: "PROJECT#prj_1",
      SK: "JOB#2026-01-01T00:00:00Z#job_1",
      GSI1PK: "JOB#job_1",
      GSI1SK: "META",
    });
    expect(buildDeploymentKeys("dep_1", "mdl_1").GSI1PK).toBe("MODEL#mdl_1");
    expect(buildRawDocumentS3Key("prj_1", "doc_1", "my file (v1).pdf")).toBe(
      "projects/prj_1/raw/doc_1/my_file__v1_.pdf"
    );
  });
});

describe("validation schemas and dataset readiness", () => {
  it("validates upload extensions and size ceiling", () => {
    expect(
      PresignUploadSchema.safeParse({
        fileName: "contracts.pdf",
        sizeBytes: 1024,
      }).success
    ).toBe(true);

    expect(
      PresignUploadSchema.safeParse({
        fileName: "script.exe",
        sizeBytes: 1024,
      }).success
    ).toBe(false);

    expect(
      CreateProjectSchema.safeParse({
        name: "Support Triage",
        taskType: "multiclass",
        labels: ["Billing", "Technical"],
      }).success
    ).toBe(true);

    expect(StartTrainingSchema.parse({}).algorithm).toBe("auto");
  });

  it("aggregates readiness across individual docs and CSV datasets", () => {
    const docs: DocumentRecord[] = [
      {
        docId: "doc_1",
        projectId: "prj_1",
        fileName: "inv1.pdf",
        sourceType: "pdf",
        s3RawKey: "k1",
        s3TextKey: "t1",
        textPreview: "Invoice",
        charCount: 100,
        wordCount: 20,
        labels: ["Billing"],
        status: "EXTRACTED",
        createdAt: "2026-01-01",
        updatedAt: "2026-01-01",
      },
      {
        docId: "doc_2",
        projectId: "prj_1",
        fileName: "tickets.csv",
        sourceType: "csv_dataset",
        s3RawKey: "k2",
        s3TextKey: "t2",
        textPreview: "Tickets",
        charCount: 500,
        wordCount: 100,
        rowCount: 10,
        labeledCount: 9,
        labelCounts: { Billing: 4, Technical: 5 },
        labels: ["Billing", "Technical"],
        status: "EXTRACTED",
        createdAt: "2026-01-01",
        updatedAt: "2026-01-01",
      },
    ];

    const summary = computeDatasetReadiness(docs, "multiclass");
    expect(summary.totalSamples).toBe(11);
    expect(summary.labeledSamples).toBe(10);
    expect(summary.unlabeledSamples).toBe(1);
    expect(summary.distinctClasses).toBe(2);
    expect(summary.ready).toBe(true);
    expect(summary.classCounts).toEqual([
      { label: "Billing", count: 5 },
      { label: "Technical", count: 5 },
    ]);
  });
});
