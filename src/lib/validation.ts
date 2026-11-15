import { z } from "zod";

export const CreateProjectSchema = z.object({
  name: z.string().trim().min(2, "Project name must be at least 2 characters").max(80),
  description: z.string().trim().max(400).optional().default(""),
  taskType: z.enum(["multiclass", "multilabel", "sentiment"]),
  labels: z.array(z.string().trim().min(1).max(40)).max(50).optional().default([]),
});

export const UpdateProjectSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  description: z.string().trim().max(400).optional(),
  labels: z.array(z.string().trim().min(1).max(40)).max(50).optional(),
});

export const PresignUploadSchema = z.object({
  fileName: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .refine(
      (name) => /\.(pdf|docx|txt|md|csv)$/i.test(name),
      "Supported extensions are .pdf, .docx, .txt, .md, and .csv"
    ),
  contentType: z.string().trim().max(160).optional().default("application/octet-stream"),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(25 * 1024 * 1024, "Maximum document size is 25 MB"),
});

export const IngestDocumentSchema = z.object({
  docId: z.string().trim().min(4).max(64),
  fileName: z.string().trim().min(1).max(200),
  mimeType: z.string().trim().max(160).optional(),
  s3RawKey: z.string().trim().min(5).max(500),
  labels: z.array(z.string().trim().min(1).max(40)).max(30).optional().default([]),
  textColumn: z.string().trim().min(1).max(120).optional(),
  labelColumn: z.string().trim().max(120).optional(),
});

export const UpdateDocumentLabelsSchema = z.object({
  docId: z.string().trim().min(4).max(64),
  labels: z.array(z.string().trim().min(1).max(40)).max(30),
});

export const StartTrainingSchema = z.object({
  algorithm: z
    .enum([
      "auto",
      "logistic_regression",
      "linear_svc",
      "naive_bayes",
      "sgd_classifier",
      "random_forest",
    ])
    .default("auto"),
  ngramMin: z.union([z.literal(1), z.literal(2)]).default(1),
  ngramMax: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(2),
  maxFeatures: z.number().int().min(500).max(50000).default(15000),
  sublinearTf: z.boolean().default(true),
  lowercase: z.boolean().default(true),
  stopWords: z.enum(["english", "none"]).default("english"),
  analyzer: z.enum(["word", "char_wb"]).default("word"),
  testSplit: z.number().min(0.1).max(0.4).default(0.2),
  randomSeed: z.number().int().min(0).max(999999).default(42),
});

export const DeployModelSchema = z.object({
  memoryMb: z
    .union([z.literal(256), z.literal(512), z.literal(1024)])
    .default(512),
  timeoutSec: z.number().int().min(5).max(60).default(15),
  authEnabled: z.boolean().default(true),
});

export const PlaygroundPredictSchema = z
  .object({
    text: z.string().trim().min(1).max(100000).optional(),
    texts: z.array(z.string().trim().min(1).max(50000)).min(1).max(50).optional(),
    fileBase64: z.string().min(4).max(12 * 1024 * 1024).optional(),
    fileName: z.string().trim().min(1).max(200).optional(),
  })
  .refine(
    (v) => Boolean(v.text || v.texts || (v.fileBase64 && v.fileName)),
    "Provide text, texts, or fileBase64 + fileName"
  );
