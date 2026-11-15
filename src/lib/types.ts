export type TaskType = "multiclass" | "multilabel" | "sentiment";

export type AlgorithmChoice =
  | "auto"
  | "logistic_regression"
  | "linear_svc"
  | "naive_bayes"
  | "sgd_classifier"
  | "random_forest";

export interface ProjectRecord {
  projectId: string;
  name: string;
  description: string;
  taskType: TaskType;
  labels: string[];
  latestModelId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentRecord {
  docId: string;
  projectId: string;
  fileName: string;
  sourceType: "pdf" | "docx" | "txt" | "csv_dataset";
  s3RawKey: string;
  s3TextKey: string;
  textPreview: string;
  charCount: number;
  wordCount: number;
  pageCount?: number;
  rowCount?: number;
  labeledCount?: number;
  textColumn?: string;
  labelColumn?: string;
  labelCounts?: Record<string, number>;
  sampleRows?: Array<Record<string, string>>;
  labels: string[];
  warnings?: string[];
  status: "UPLOADED" | "EXTRACTED" | "FAILED";
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TrainingConfig {
  algorithm: AlgorithmChoice;
  ngramMin: 1 | 2;
  ngramMax: 1 | 2 | 3;
  maxFeatures: number;
  sublinearTf: boolean;
  lowercase: boolean;
  stopWords: "english" | "none";
  analyzer: "word" | "char_wb";
  testSplit: number;
  randomSeed: number;
}

export interface TrainingJobRecord {
  jobId: string;
  jobSk: string;
  projectId: string;
  status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED";
  stage: string;
  progress: number;
  config: TrainingConfig;
  datasetStats?: { labeledSamples?: number };
  modelId?: string;
  errorMessage?: string;
  durationMs?: number;
  startedAt?: string;
  finishedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ModelVersionRecord {
  modelId: string;
  projectId: string;
  jobId: string;
  version: number;
  taskType: TaskType;
  algorithm: string;
  classes: string[];
  s3ModelKey: string;
  s3MetricsKey: string;
  artifactSizeBytes: number;
  trainCount: number;
  testCount: number;
  vocabSize: number;
  metricsSummary: Record<string, string>;
  createdAt: string;
}

export interface LeaderboardEntry {
  algorithm: string;
  cvMacroF1: number | null;
  testMacroF1: number;
  testAccuracy: number;
  durationMs: number;
  selected: boolean;
}

export interface PerClassMetric {
  label: string;
  precision: number;
  recall: number;
  f1: number;
  support: number;
}

export interface SamplePrediction {
  textPreview: string;
  actual: string[];
  predicted: string[];
  confidence: number;
  correct: boolean;
}

export interface ModelMetrics {
  modelId: string;
  projectId: string;
  taskType: TaskType;
  algorithm: string;
  requestedAlgorithm: string;
  classes: string[];
  trainCount: number;
  testCount: number;
  vocabSize: number;
  artifactSizeBytes?: number;
  durationMs?: number;
  summary: {
    accuracy: number;
    macroF1: number;
    weightedF1: number;
    macroPrecision: number;
    macroRecall: number;
    hammingLoss?: number;
    jaccardMacro?: number;
  };
  perClass: PerClassMetric[];
  confusionMatrix: {
    labels: string[];
    matrix: number[][];
  } | null;
  topFeatures: Record<string, Array<{ token: string; weight: number }>>;
  leaderboard: LeaderboardEntry[];
  samplePredictions: SamplePrediction[];
  config: TrainingConfig;
}

export interface DeploymentRecord {
  deploymentId: string;
  projectId: string;
  modelId: string;
  functionName: string;
  functionArn: string;
  functionUrl: string;
  memoryMb: number;
  timeoutSec: number;
  authEnabled: boolean;
  apiKeyMasked: string;
  apiKeyEncrypted?: string;
  status: "DEPLOYING" | "ACTIVE" | "UPDATING" | "FAILED" | "DELETED";
  lastDeployedAt: string;
  createdAt: string;
}

export interface PredictionSignal {
  token: string;
  score: number;
}

export interface PredictionItem {
  label: string;
  labels: string[];
  confidence: number;
  probabilities: Record<string, number>;
  topSignals: PredictionSignal[];
}

export interface PredictionResponse {
  modelId: string;
  taskType: TaskType;
  algorithm: string;
  coldStart: boolean;
  latencyMs: number;
  predictions: PredictionItem[];
}

export interface DiagnosticCheck {
  name: string;
  ok: boolean;
  detail: string;
}
