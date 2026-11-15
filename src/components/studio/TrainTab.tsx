"use client";

import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Loader2,
  Play,
  Sparkles,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { computeDatasetReadiness } from "@/lib/dataset-utils";
import type {
  AlgorithmChoice,
  DocumentRecord,
  ProjectRecord,
  TrainingConfig,
  TrainingJobRecord,
} from "@/lib/types";

interface TrainTabProps {
  project: ProjectRecord;
  documents: DocumentRecord[];
  jobs: TrainingJobRecord[];
  onRefresh: () => Promise<void>;
  onTrainingSucceeded: (modelId: string) => void;
}

const ALGORITHMS: Array<{
  id: AlgorithmChoice;
  label: string;
  desc: string;
  recommended?: boolean;
}> = [
  {
    id: "auto",
    label: "AutoML Tournament",
    desc: "Cross-validates Logistic Regression, LinearSVC, Naive Bayes & SGD and picks best Macro F1.",
    recommended: true,
  },
  {
    id: "logistic_regression",
    label: "Logistic Regression",
    desc: "Calibrated linear probabilities with strong L2 regularization and fast inference.",
  },
  {
    id: "linear_svc",
    label: "LinearSVC (Calibrated)",
    desc: "High-margin SVM wrapped in probability calibration; excels on long legal/technical text.",
  },
  {
    id: "naive_bayes",
    label: "Complement Naive Bayes",
    desc: "Fast probabilistic baseline tailored for imbalanced text classes.",
  },
  {
    id: "sgd_classifier",
    label: "SGD Log-Loss",
    desc: "Stochastic gradient classifier well-suited to large 10k+ row CSV corpora.",
  },
  {
    id: "random_forest",
    label: "Random Forest",
    desc: "Non-linear ensemble over TF-IDF features.",
  },
];

const STAGES = [
  { key: "queued", label: "Queued" },
  { key: "loading_documents", label: "Loading Docs from S3" },
  { key: "training_models", label: "Training & Cross-Validation" },
  { key: "saving_artifact", label: "Saving Model Artifact" },
  { key: "completed", label: "Completed" },
];

export function TrainTab({
  project,
  documents,
  jobs,
  onRefresh,
  onTrainingSucceeded,
}: TrainTabProps) {
  const readiness = useMemo(
    () => computeDatasetReadiness(documents, project.taskType),
    [documents, project.taskType]
  );

  const [config, setConfig] = useState<TrainingConfig>({
    algorithm: "auto",
    ngramMin: 1,
    ngramMax: 2,
    maxFeatures: 15000,
    sublinearTf: true,
    lowercase: true,
    stopWords: "english",
    analyzer: "word",
    testSplit: 0.2,
    randomSeed: 42,
  });

  const [submitting, setSubmitting] = useState(false);
  const [polledJob, setPolledJob] = useState<TrainingJobRecord | null>(null);
  const [error, setError] = useState("");

  const activeJob = useMemo(() => {
    const runningFromProps = jobs.find(
      (j) => j.status === "QUEUED" || j.status === "RUNNING"
    );
    if (runningFromProps) {
      if (polledJob && polledJob.jobId === runningFromProps.jobId) {
        return polledJob.progress >= runningFromProps.progress
          ? polledJob
          : runningFromProps;
      }
      return runningFromProps;
    }
    if (polledJob) {
      const matchingProp = jobs.find((j) => j.jobId === polledJob.jobId);
      return matchingProp || polledJob;
    }
    return jobs[0] || null;
  }, [jobs, polledJob]);

  useEffect(() => {
    if (
      !activeJob ||
      (activeJob.status !== "QUEUED" && activeJob.status !== "RUNNING")
    ) {
      return;
    }

    const timer = setInterval(async () => {
      try {
        const resp = await fetch(`/api/jobs/${activeJob.jobId}`, {
          cache: "no-store",
        });
        if (!resp.ok) return;
        const data = await resp.json();
        if (data.job) {
          setPolledJob(data.job);
          if (
            data.job.status === "SUCCEEDED" ||
            data.job.status === "FAILED"
          ) {
            await onRefresh();
          }
        }
      } catch {
        // Keep polling gracefully on transient hiccups
      }
    }, 2000);

    return () => clearInterval(timer);
  }, [activeJob, onRefresh]);

  async function handleStartTraining() {
    setSubmitting(true);
    setError("");
    try {
      const resp = await fetch(`/api/projects/${project.projectId}/train`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.error || "Failed to launch training job");
      }
      setPolledJob(data.job);
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start training");
    } finally {
      setSubmitting(false);
    }
  }

  const isRunning =
    activeJob?.status === "QUEUED" || activeJob?.status === "RUNNING";

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Readiness Checklist */}
      <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-xs space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-950">
            Dataset Readiness Gate
          </h2>
          <span className="font-mono text-xs text-zinc-600">
            {readiness.labeledSamples} samples · {readiness.distinctClasses}{" "}
            classes
          </span>
        </div>

        {readiness.blockers.length > 0 && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700 space-y-1">
            {readiness.blockers.map((b, i) => (
              <div key={i} className="flex items-start gap-2">
                <XCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{b}</span>
              </div>
            ))}
          </div>
        )}

        {readiness.warnings.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 space-y-1">
            {readiness.warnings.map((w, i) => (
              <div key={i} className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{w}</span>
              </div>
            ))}
          </div>
        )}

        {readiness.ready && readiness.warnings.length === 0 && (
          <div className="flex items-center gap-2 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>
              Dataset passes all checks for stratified training and held-out evaluation.
            </span>
          </div>
        )}
      </section>

      {/* Active Job Progress */}
      {activeJob && (
        <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-xs space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              {isRunning ? (
                <Loader2 className="h-5 w-5 text-[#0f766e] animate-spin" />
              ) : activeJob.status === "SUCCEEDED" ? (
                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              ) : (
                <XCircle className="h-5 w-5 text-red-600" />
              )}
              <div>
                <h3 className="text-sm font-semibold text-zinc-950">
                  Training Job{" "}
                  <span className="font-mono text-xs text-zinc-500">
                    {activeJob.jobId}
                  </span>
                </h3>
                <p className="text-xs text-zinc-600">
                  Status: <strong>{activeJob.status}</strong> ·{" "}
                  {activeJob.progress}%
                  {activeJob.durationMs
                    ? ` · ${(activeJob.durationMs / 1000).toFixed(1)}s`
                    : ""}
                </p>
              </div>
            </div>

            {activeJob.status === "SUCCEEDED" && activeJob.modelId && (
              <button
                type="button"
                onClick={() => onTrainingSucceeded(activeJob.modelId!)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#0f766e] hover:bg-[#115e59] text-white px-3.5 py-2 text-xs font-medium cursor-pointer"
              >
                <span>Inspect Evaluation Metrics</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div className="h-2 w-full rounded-full bg-zinc-100 overflow-hidden">
            <div
              className={`h-full transition-all duration-500 ${
                activeJob.status === "FAILED"
                  ? "bg-red-500"
                  : activeJob.status === "SUCCEEDED"
                    ? "bg-emerald-600"
                    : "bg-[#0f766e]"
              }`}
              style={{ width: `${activeJob.progress}%` }}
            />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-[11px]">
            {STAGES.map((st) => {
              const reached =
                activeJob.stage === st.key ||
                activeJob.status === "SUCCEEDED" ||
                (st.key === "queued" && activeJob.progress >= 5) ||
                (st.key === "loading_documents" && activeJob.progress >= 15) ||
                (st.key === "training_models" && activeJob.progress >= 45) ||
                (st.key === "saving_artifact" && activeJob.progress >= 85);
              return (
                <div
                  key={st.key}
                  className={`rounded-md px-2.5 py-1.5 border ${
                    reached
                      ? "bg-teal-50 border-teal-200 text-[#0f766e] font-medium"
                      : "bg-zinc-50 border-zinc-200 text-zinc-500"
                  }`}
                >
                  {st.label}
                </div>
              );
            })}
          </div>

          {activeJob.errorMessage && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 font-mono text-xs text-red-700">
              {activeJob.errorMessage}
            </div>
          )}
        </section>
      )}

      {/* Training Configurator */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <section className="lg:col-span-2 rounded-xl border border-zinc-200 bg-white p-6 shadow-xs space-y-4">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-[#0f766e]" />
            <h2 className="text-base font-semibold text-zinc-950">
              Select Algorithm
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {ALGORITHMS.map((algo) => {
              const selected = config.algorithm === algo.id;
              return (
                <button
                  key={algo.id}
                  type="button"
                  onClick={() => setConfig({ ...config, algorithm: algo.id })}
                  className={`text-left rounded-lg border p-3.5 transition-colors cursor-pointer ${
                    selected
                      ? "border-[#0f766e] bg-teal-50/60"
                      : "border-zinc-200 bg-white hover:border-zinc-300"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-zinc-950">
                      {algo.label}
                    </span>
                    {algo.recommended && (
                      <span className="rounded bg-teal-100 px-1.5 py-0.5 text-[10px] font-semibold text-[#0f766e]">
                        Recommended
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-zinc-600 mt-1">{algo.desc}</p>
                </button>
              );
            })}
          </div>
        </section>

        <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-xs space-y-4">
          <h2 className="text-base font-semibold text-zinc-950">
            TF-IDF &amp; Split Options
          </h2>

          <div className="space-y-3 text-sm">
            <div className="space-y-1">
              <label className="block text-xs font-medium text-zinc-700">
                Tokenizer &amp; N-gram Range
              </label>
              <select
                value={`${config.analyzer}:${config.ngramMin}-${config.ngramMax}`}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === "word:1-1") {
                    setConfig({ ...config, analyzer: "word", ngramMin: 1, ngramMax: 1 });
                  } else if (val === "word:1-2") {
                    setConfig({ ...config, analyzer: "word", ngramMin: 1, ngramMax: 2 });
                  } else if (val === "word:1-3") {
                    setConfig({ ...config, analyzer: "word", ngramMin: 1, ngramMax: 3 });
                  } else {
                    setConfig({
                      ...config,
                      analyzer: "char_wb",
                      ngramMin: 2,
                      ngramMax: 3,
                    });
                  }
                }}
                className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs"
              >
                <option value="word:1-1">Word Unigrams (1, 1)</option>
                <option value="word:1-2">Word Unigrams + Bigrams (1, 2)</option>
                <option value="word:1-3">Word up to Trigrams (1, 3)</option>
                <option value="char_wb:2-3">Character N-grams (noisy OCR/short text)</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-medium text-zinc-700">
                Max Vocabulary Features
              </label>
              <select
                value={config.maxFeatures}
                onChange={(e) =>
                  setConfig({ ...config, maxFeatures: Number(e.target.value) })
                }
                className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs"
              >
                <option value={5000}>5,000 features (compact)</option>
                <option value={15000}>15,000 features (balanced)</option>
                <option value={30000}>30,000 features (high recall)</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-medium text-zinc-700">
                Held-out Test Split ({Math.round(config.testSplit * 100)}%)
              </label>
              <input
                type="range"
                min={0.1}
                max={0.4}
                step={0.05}
                value={config.testSplit}
                onChange={(e) =>
                  setConfig({ ...config, testSplit: Number(e.target.value) })
                }
                className="w-full accent-[#0f766e]"
              />
            </div>

            <div className="flex items-center justify-between pt-1">
              <span className="text-xs font-medium text-zinc-700">
                English Stop Words
              </span>
              <select
                value={config.stopWords}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    stopWords: e.target.value as "english" | "none",
                  })
                }
                className="rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-xs"
              >
                <option value="english">Filter English</option>
                <option value="none">Keep All Words</option>
              </select>
            </div>

            <label className="flex items-center gap-2 text-xs text-zinc-700 pt-1 cursor-pointer">
              <input
                type="checkbox"
                checked={config.sublinearTf}
                onChange={(e) =>
                  setConfig({ ...config, sublinearTf: e.target.checked })
                }
                className="accent-[#0f766e]"
              />
              <span>Apply sublinear TF scaling (1 + log(tf))</span>
            </label>
          </div>

          <button
            id="btn-start-training"
            type="button"
            disabled={!readiness.ready || submitting || isRunning}
            onClick={handleStartTraining}
            className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-[#0f766e] hover:bg-[#115e59] text-white py-2.5 px-4 text-sm font-medium transition-colors disabled:opacity-50 cursor-pointer"
          >
            {submitting || isRunning ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            <span>
              {isRunning
                ? "Training on AWS Lambda..."
                : submitting
                  ? "Dispatching..."
                  : "Train Model on AWS Lambda"}
            </span>
          </button>
        </section>
      </div>

      {/* Job History */}
      {jobs.length > 0 && (
        <section className="rounded-xl border border-zinc-200 bg-white shadow-xs overflow-hidden">
          <div className="px-5 py-3.5 border-b border-zinc-200 text-sm font-semibold text-zinc-950 flex items-center gap-2">
            <Clock className="h-4 w-4 text-zinc-500" />
            <span>Training Job History</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-zinc-50 border-b border-zinc-200 text-zinc-600">
                <tr>
                  <th className="px-4 py-2.5">Job ID</th>
                  <th className="px-4 py-2.5">Algorithm</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5">Duration</th>
                  <th className="px-4 py-2.5">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {jobs.map((job) => (
                  <tr key={job.jobId}>
                    <td className="px-4 py-2.5 font-mono text-zinc-800">
                      {job.jobId}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-zinc-700">
                      {job.config?.algorithm || "auto"}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`rounded px-2 py-0.5 font-medium ${
                          job.status === "SUCCEEDED"
                            ? "bg-emerald-50 text-emerald-700"
                            : job.status === "FAILED"
                              ? "bg-red-50 text-red-700"
                              : "bg-amber-50 text-amber-800"
                        }`}
                      >
                        {job.status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-zinc-600">
                      {job.durationMs
                        ? `${(job.durationMs / 1000).toFixed(1)}s`
                        : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-zinc-500">
                      {new Date(job.createdAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
