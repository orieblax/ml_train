"use client";

import {
  Award,
  BarChart3,
  Loader2,
  Rocket,
  Sparkles,
} from "lucide-react";
import { useEffect, useState } from "react";
import { formatBytes, formatPct } from "@/lib/dataset-utils";
import type { ModelMetrics, ModelVersionRecord } from "@/lib/types";

interface EvaluateTabProps {
  models: ModelVersionRecord[];
  selectedModelId: string;
  onSelectModel: (modelId: string) => void;
  onDeployClick: (modelId: string) => void;
}

export function EvaluateTab({
  models,
  selectedModelId,
  onSelectModel,
  onDeployClick,
}: EvaluateTabProps) {
  const [metrics, setMetrics] = useState<ModelMetrics | null>(null);
  const [loadedModelId, setLoadedModelId] = useState<string>("");
  const [error, setError] = useState("");
  const [activeFeatureClass, setActiveFeatureClass] = useState<string>("");
  const [errorsOnly, setErrorsOnly] = useState(false);

  const activeId = selectedModelId || models[0]?.modelId || "";
  const loading = Boolean(activeId) && loadedModelId !== activeId && !error;

  useEffect(() => {
    if (!activeId) return;
    let cancelled = false;

    fetch(`/api/models/${activeId}`, { cache: "no-store" })
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (cancelled) return;
        if (!ok) throw new Error(d.error || "Failed to load model metrics");
        setError("");
        setMetrics(d.metrics);
        setLoadedModelId(activeId);
        const classes = d.metrics?.classes || [];
        if (classes.length > 0) setActiveFeatureClass(classes[0]);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load metrics");
          setLoadedModelId(activeId);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeId]);

  if (models.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-zinc-300 bg-white p-12 text-center space-y-2">
        <BarChart3 className="h-8 w-8 text-zinc-400 mx-auto" />
        <h2 className="text-base font-semibold text-zinc-900">
          No trained models yet
        </h2>
        <p className="text-sm text-zinc-600">
          Run a training job in the Train Model tab to inspect accuracy,
          confusion matrices, and predictive tokens.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Version Switcher Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-xl border border-zinc-200 bg-white px-5 py-4 shadow-xs">
        <div className="flex items-center gap-3">
          <label
            htmlFor="select-eval-model"
            className="text-xs font-medium text-zinc-600"
          >
            Model Version
          </label>
          <select
            id="select-eval-model"
            value={activeId}
            onChange={(e) => onSelectModel(e.target.value)}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-mono text-zinc-900"
          >
            {models.map((m) => (
              <option key={m.modelId} value={m.modelId}>
                v{m.version} · {m.algorithm} ·{" "}
                {formatPct(m.metricsSummary?.macroF1)} F1 ({m.modelId})
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          onClick={() => onDeployClick(activeId)}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#0f766e] hover:bg-[#115e59] text-white px-4 py-2 text-xs font-medium transition-colors cursor-pointer"
        >
          <Rocket className="h-3.5 w-3.5" />
          <span>Deploy This Version to AWS Lambda</span>
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading || !metrics ? (
        <div className="h-64 rounded-xl border border-zinc-200 bg-white flex items-center justify-center gap-2 text-sm text-zinc-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Loading evaluation metrics from S3...</span>
        </div>
      ) : (
        <>
          {/* KPI Summary Strip */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-xs">
              <div className="text-xs text-zinc-500">Test Accuracy</div>
              <div className="text-2xl font-mono font-semibold text-zinc-950 mt-1">
                {formatPct(metrics.summary.accuracy)}
              </div>
            </div>
            <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-xs">
              <div className="text-xs text-zinc-500">Macro F1</div>
              <div className="text-2xl font-mono font-semibold text-[#0f766e] mt-1">
                {formatPct(metrics.summary.macroF1)}
              </div>
            </div>
            <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-xs">
              <div className="text-xs text-zinc-500">Weighted F1</div>
              <div className="text-2xl font-mono font-semibold text-zinc-950 mt-1">
                {formatPct(metrics.summary.weightedF1)}
              </div>
            </div>
            <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-xs">
              <div className="text-xs text-zinc-500">Split (Train / Test)</div>
              <div className="text-xl font-mono font-semibold text-zinc-950 mt-1">
                {metrics.trainCount} / {metrics.testCount}
              </div>
            </div>
            <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-xs">
              <div className="text-xs text-zinc-500">Artifact / Vocab</div>
              <div className="text-lg font-mono font-semibold text-zinc-950 mt-1">
                {formatBytes(metrics.artifactSizeBytes || 0)}
              </div>
              <div className="text-[11px] font-mono text-zinc-500">
                {metrics.vocabSize.toLocaleString()} n-grams
              </div>
            </div>
          </div>

          {/* AutoML Tournament Leaderboard */}
          {metrics.leaderboard && metrics.leaderboard.length > 1 && (
            <section className="rounded-xl border border-zinc-200 bg-white shadow-xs overflow-hidden">
              <div className="px-5 py-3.5 border-b border-zinc-200 flex items-center gap-2 text-sm font-semibold text-zinc-950">
                <Award className="h-4 w-4 text-[#0f766e]" />
                <span>AutoML Cross-Validation Leaderboard</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-zinc-50 border-b border-zinc-200 text-zinc-600">
                    <tr>
                      <th className="px-4 py-2.5">Candidate Algorithm</th>
                      <th className="px-4 py-2.5">CV Macro F1</th>
                      <th className="px-4 py-2.5">Test Macro F1</th>
                      <th className="px-4 py-2.5">Test Accuracy</th>
                      <th className="px-4 py-2.5">Fit Time</th>
                      <th className="px-4 py-2.5 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {metrics.leaderboard.map((row) => (
                      <tr
                        key={row.algorithm}
                        className={row.selected ? "bg-teal-50/40" : ""}
                      >
                        <td className="px-4 py-2.5 font-mono font-medium text-zinc-900">
                          {row.algorithm}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-zinc-700">
                          {row.cvMacroF1 !== null ? formatPct(row.cvMacroF1) : "—"}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-zinc-900">
                          {formatPct(row.testMacroF1)}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-zinc-700">
                          {formatPct(row.testAccuracy)}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-zinc-600">
                          {row.durationMs} ms
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          {row.selected ? (
                            <span className="rounded bg-[#0f766e] px-2 py-0.5 text-[11px] font-medium text-white">
                              Winner
                            </span>
                          ) : (
                            <span className="text-zinc-400">Evaluated</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Confusion Matrix & Per-Class Breakdown */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {metrics.confusionMatrix && (
              <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-xs space-y-3">
                <div>
                  <h3 className="text-sm font-semibold text-zinc-950">
                    Confusion Matrix (Held-out Test Set)
                  </h3>
                  <p className="text-xs text-zinc-500">
                    Rows represent actual labels; columns represent predicted labels.
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-xs">
                    <thead>
                      <tr>
                        <th className="p-2 text-left text-zinc-500 font-medium">
                          Actual \ Pred
                        </th>
                        {metrics.confusionMatrix.labels.map((lbl) => (
                          <th
                            key={lbl}
                            className="p-2 text-center font-medium text-zinc-700 max-w-[90px] truncate"
                          >
                            {lbl}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {metrics.confusionMatrix.matrix.map((row, rIdx) => {
                        const rowSum = row.reduce((a, b) => a + b, 0) || 1;
                        return (
                          <tr key={metrics.confusionMatrix!.labels[rIdx]}>
                            <td className="p-2 font-medium text-zinc-800 whitespace-nowrap">
                              {metrics.confusionMatrix!.labels[rIdx]}
                            </td>
                            {row.map((val, cIdx) => {
                              const intensity = val / rowSum;
                              const isDiag = rIdx === cIdx;
                              return (
                                <td
                                  key={cIdx}
                                  className="p-2 text-center font-mono border border-zinc-100"
                                  style={{
                                    backgroundColor: isDiag
                                      ? `rgba(15, 118, 110, ${0.12 + intensity * 0.65})`
                                      : val > 0
                                        ? `rgba(220, 38, 38, ${0.08 + intensity * 0.4})`
                                        : "#ffffff",
                                    color:
                                      isDiag && intensity > 0.55
                                        ? "#ffffff"
                                        : "#18181b",
                                  }}
                                >
                                  {val}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            <section
              className={`rounded-xl border border-zinc-200 bg-white p-5 shadow-xs space-y-3 ${
                metrics.confusionMatrix ? "" : "lg:col-span-2"
              }`}
            >
              <h3 className="text-sm font-semibold text-zinc-950">
                Per-Class Precision, Recall &amp; F1
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-zinc-50 border-b border-zinc-200 text-zinc-600">
                    <tr>
                      <th className="px-3 py-2">Class</th>
                      <th className="px-3 py-2">Precision</th>
                      <th className="px-3 py-2">Recall</th>
                      <th className="px-3 py-2">F1</th>
                      <th className="px-3 py-2 text-right">Support</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {metrics.perClass.map((row) => (
                      <tr key={row.label}>
                        <td className="px-3 py-2 font-medium text-zinc-900">
                          {row.label}
                        </td>
                        <td className="px-3 py-2 font-mono text-zinc-700">
                          {formatPct(row.precision)}
                        </td>
                        <td className="px-3 py-2 font-mono text-zinc-700">
                          {formatPct(row.recall)}
                        </td>
                        <td className="px-3 py-2 font-mono font-semibold text-[#0f766e]">
                          {formatPct(row.f1)}
                        </td>
                        <td className="px-3 py-2 font-mono text-right text-zinc-600">
                          {row.support}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>

          {/* Top Predictive N-grams */}
          {Object.keys(metrics.topFeatures || {}).length > 0 && (
            <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-xs space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-[#0f766e]" />
                  <h3 className="text-sm font-semibold text-zinc-950">
                    Top Predictive Terms &amp; Phrases
                  </h3>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {metrics.classes.map((cls) => (
                    <button
                      key={cls}
                      type="button"
                      onClick={() => setActiveFeatureClass(cls)}
                      className={`px-2.5 py-1 rounded-md text-xs font-medium border cursor-pointer ${
                        activeFeatureClass === cls
                          ? "bg-[#0f766e] text-white border-[#0f766e]"
                          : "bg-zinc-50 text-zinc-700 border-zinc-200 hover:bg-zinc-100"
                      }`}
                    >
                      {cls}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                {(metrics.topFeatures[activeFeatureClass] || []).map((feat) => {
                  const maxW =
                    metrics.topFeatures[activeFeatureClass]?.[0]?.weight || 1;
                  const pct = Math.min(
                    100,
                    Math.max(8, Math.round((feat.weight / maxW) * 100))
                  );
                  return (
                    <div
                      key={feat.token}
                      className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 space-y-1"
                    >
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-mono font-medium text-zinc-900">
                          {feat.token}
                        </span>
                        <span className="font-mono text-zinc-500">
                          +{feat.weight.toFixed(3)}
                        </span>
                      </div>
                      <div className="h-1 w-full bg-zinc-200 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-[#0f766e]"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Error Analysis Table */}
          {metrics.samplePredictions && metrics.samplePredictions.length > 0 && (
            <section className="rounded-xl border border-zinc-200 bg-white shadow-xs overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-200">
                <h3 className="text-sm font-semibold text-zinc-950">
                  Held-out Test Predictions &amp; Error Analysis
                </h3>
                <label className="inline-flex items-center gap-2 text-xs text-zinc-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={errorsOnly}
                    onChange={(e) => setErrorsOnly(e.target.checked)}
                    className="accent-[#0f766e]"
                  />
                  <span>Misclassified only</span>
                </label>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-zinc-50 border-b border-zinc-200 text-zinc-600">
                    <tr>
                      <th className="px-4 py-2.5">Test Document Preview</th>
                      <th className="px-4 py-2.5">Actual</th>
                      <th className="px-4 py-2.5">Predicted</th>
                      <th className="px-4 py-2.5 text-right">Confidence</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {metrics.samplePredictions
                      .filter((s) => (errorsOnly ? !s.correct : true))
                      .map((sample, idx) => (
                        <tr key={idx}>
                          <td className="px-4 py-2.5 text-zinc-800 max-w-lg">
                            {sample.textPreview}
                          </td>
                          <td className="px-4 py-2.5 font-mono text-zinc-700">
                            {sample.actual.join(", ")}
                          </td>
                          <td className="px-4 py-2.5 font-mono">
                            <span
                              className={`rounded px-2 py-0.5 ${
                                sample.correct
                                  ? "bg-emerald-50 text-emerald-700"
                                  : "bg-red-50 text-red-700"
                              }`}
                            >
                              {sample.predicted.join(", ")}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 font-mono text-right text-zinc-600">
                            {formatPct(sample.confidence)}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
