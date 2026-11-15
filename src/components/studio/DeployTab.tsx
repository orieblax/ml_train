"use client";

import {
  Activity,
  Check,
  Copy,
  FileUp,
  KeyRound,
  Loader2,
  Play,
  Rocket,
  Shield,
  Terminal,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { formatPct } from "@/lib/dataset-utils";
import type {
  DeploymentRecord,
  ModelVersionRecord,
  PredictionResponse,
} from "@/lib/types";

interface DeployTabProps {
  models: ModelVersionRecord[];
  deployments: DeploymentRecord[];
  selectedModelId: string;
  onSelectModel: (modelId: string) => void;
  onRefresh: () => Promise<void>;
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const commaIdx = result.indexOf(",");
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

export function DeployTab({
  models,
  deployments,
  selectedModelId,
  onSelectModel,
  onRefresh,
}: DeployTabProps) {
  const activeModelId = selectedModelId || models[0]?.modelId || "";
  const activeDeployment =
    deployments.find((d) => d.modelId === activeModelId) ||
    deployments[0] ||
    null;

  const [memoryMb, setMemoryMb] = useState<256 | 512 | 1024>(512);
  const [timeoutSec, setTimeoutSec] = useState<number>(15);
  const [authEnabled, setAuthEnabled] = useState<boolean>(true);
  const [deploying, setDeploying] = useState(false);
  const [freshApiKey, setFreshApiKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const [snippetLang, setSnippetLang] = useState<"curl" | "python" | "ts">("curl");
  const [pingResult, setPingResult] = useState<{
    loading: boolean;
    text?: string;
    ok?: boolean;
  } | null>(null);

  const [inputMode, setInputMode] = useState<"text" | "file">("text");
  const [testText, setTestText] = useState("");
  const [testFile, setTestFile] = useState<File | null>(null);
  const [predicting, setPredicting] = useState(false);
  const [prediction, setPrediction] = useState<
    (PredictionResponse & { roundTripMs?: number }) | null
  >(null);
  const [error, setError] = useState("");

  async function handleDeploy() {
    if (!activeModelId) return;
    setDeploying(true);
    setError("");
    setFreshApiKey(null);
    try {
      const resp = await fetch(`/api/models/${activeModelId}/deploy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memoryMb, timeoutSec, authEnabled }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.error || "Failed to deploy AWS Lambda");
      }
      if (data.apiKey) {
        setFreshApiKey(data.apiKey);
      }
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Deployment failed");
    } finally {
      setDeploying(false);
    }
  }

  async function handleUndeploy(dep: DeploymentRecord) {
    if (
      !window.confirm(
        `Delete AWS Lambda "${dep.functionName}" and deactivate its endpoint URL?`
      )
    ) {
      return;
    }
    setError("");
    const resp = await fetch(
      `/api/models/${dep.modelId}/deploy?deploymentId=${dep.deploymentId}`,
      { method: "DELETE" }
    );
    if (!resp.ok) {
      const d = await resp.json().catch(() => ({}));
      setError(d.error || "Failed to undeploy Lambda");
      return;
    }
    setFreshApiKey(null);
    setPrediction(null);
    await onRefresh();
  }

  async function handlePing(dep: DeploymentRecord) {
    setPingResult({ loading: true });
    try {
      const resp = await fetch(`/api/deployments/${dep.deploymentId}/predict`, {
        method: "GET",
      });
      const data = await resp.json();
      setPingResult({
        loading: false,
        ok: Boolean(data.ok),
        text: data.ok
          ? `Healthy · ${data.roundTripMs} ms${data.health?.coldStart ? " (cold start)" : " (warm)"}`
          : data.error || "Health check failed",
      });
    } catch (err) {
      setPingResult({
        loading: false,
        ok: false,
        text: err instanceof Error ? err.message : "Ping failed",
      });
    }
  }

  async function handlePredict(e: React.FormEvent) {
    e.preventDefault();
    if (!activeDeployment) return;
    setPredicting(true);
    setError("");
    setPrediction(null);
    try {
      let payload: Record<string, unknown>;
      if (inputMode === "file") {
        if (!testFile) throw new Error("Choose a .pdf, .docx, or .txt file");
        const fileBase64 = await readFileAsBase64(testFile);
        payload = { fileBase64, fileName: testFile.name };
      } else {
        if (!testText.trim()) throw new Error("Enter document text to classify");
        payload = { text: testText.trim() };
      }

      const resp = await fetch(
        `/api/deployments/${activeDeployment.deploymentId}/predict`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.error || "Prediction request failed");
      }
      setPrediction(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Prediction failed");
    } finally {
      setPredicting(false);
    }
  }

  async function copyText(id: string, value: string) {
    await navigator.clipboard.writeText(value);
    setCopiedKey(id);
    setTimeout(() => setCopiedKey(null), 1800);
  }

  if (models.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-zinc-300 bg-white p-12 text-center space-y-2">
        <Rocket className="h-8 w-8 text-zinc-400 mx-auto" />
        <h2 className="text-base font-semibold text-zinc-900">
          Train a model first
        </h2>
        <p className="text-sm text-zinc-600">
          Once a model finishes training, you can deploy it as its own AWS
          Lambda Function URL in one click.
        </p>
      </div>
    );
  }

  const endpointBase = activeDeployment?.functionUrl.replace(/\/$/, "") || "";
  const apiKeyPlaceholder = freshApiKey || "<YOUR_MLTRAIN_API_KEY>";

  const snippets = {
    curl: `curl -X POST "${endpointBase}/predict" \\
  -H "Content-Type: application/json" \\${
    activeDeployment?.authEnabled
      ? `\n  -H "Authorization: Bearer ${apiKeyPlaceholder}" \\`
      : ""
  }
  -d '{"text": "Your document text to classify..."}'`,
    python: `import requests

resp = requests.post(
    "${endpointBase}/predict",
    headers={${
      activeDeployment?.authEnabled
        ? `"Authorization": "Bearer ${apiKeyPlaceholder}"`
        : ""
    }},
    json={"text": "Your document text to classify..."},
    timeout=15,
)
print(resp.json())`,
    ts: `const res = await fetch("${endpointBase}/predict", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",${
      activeDeployment?.authEnabled
        ? `\n    "Authorization": "Bearer ${apiKeyPlaceholder}",`
        : ""
    }
  },
  body: JSON.stringify({ text: "Your document text to classify..." }),
});
const data = await res.json();`,
  };

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Deploy Configurator */}
      <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-xs space-y-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-zinc-950">
              Deploy Dedicated AWS Lambda Function URL
            </h2>
            <p className="text-xs text-zinc-600 mt-0.5">
              Packages <code className="font-mono">handler.py</code> (~2 KB) +
              your Shared ML Runtime Layer and mounts{" "}
              <code className="font-mono">model.joblib</code> from S3.
            </p>
          </div>
          <span className="rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1 font-mono text-xs text-zinc-700 shrink-0">
            Free Tier: 1M reqs · 400k GB-s/mo
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 items-end">
          <div className="sm:col-span-2 space-y-1">
            <label className="block text-xs font-medium text-zinc-700">
              Model Version
            </label>
            <select
              value={activeModelId}
              onChange={(e) => onSelectModel(e.target.value)}
              className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs font-mono"
            >
              {models.map((m) => (
                <option key={m.modelId} value={m.modelId}>
                  v{m.version} · {m.algorithm} ·{" "}
                  {formatPct(m.metricsSummary?.macroF1)} F1
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-medium text-zinc-700">
              Lambda Memory
            </label>
            <select
              value={memoryMb}
              onChange={(e) =>
                setMemoryMb(Number(e.target.value) as 256 | 512 | 1024)
              }
              className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs font-mono"
            >
              <option value={256}>256 MB (1.6M sec free)</option>
              <option value={512}>512 MB (Balanced)</option>
              <option value={1024}>1024 MB (Fastest cold start)</option>
            </select>
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-medium text-zinc-700">
              Timeout
            </label>
            <select
              value={timeoutSec}
              onChange={(e) => setTimeoutSec(Number(e.target.value))}
              className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs font-mono"
            >
              <option value={15}>15 seconds</option>
              <option value={30}>30 seconds</option>
            </select>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-2 border-t border-zinc-100">
          <label className="inline-flex items-center gap-2 text-xs font-medium text-zinc-700 cursor-pointer">
            <input
              type="checkbox"
              checked={authEnabled}
              onChange={(e) => setAuthEnabled(e.target.checked)}
              className="accent-[#0f766e]"
            />
            <Shield className="h-3.5 w-3.5 text-[#0f766e]" />
            <span>Require Bearer API Key on Function URL (Recommended)</span>
          </label>

          <button
            id="btn-deploy-lambda"
            type="button"
            disabled={deploying}
            onClick={handleDeploy}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#0f766e] hover:bg-[#115e59] text-white px-5 py-2.5 text-sm font-medium transition-colors disabled:opacity-60 cursor-pointer"
          >
            {deploying ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Rocket className="h-4 w-4" />
            )}
            <span>
              {deploying
                ? "Provisioning Lambda..."
                : activeDeployment?.modelId === activeModelId
                  ? "Redeploy / Update Lambda"
                  : "Deploy to AWS Lambda"}
            </span>
          </button>
        </div>
      </section>

      {/* One-time API Key Banner */}
      {freshApiKey && (
        <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-emerald-900 inline-flex items-center gap-1.5">
              <KeyRound className="h-4 w-4" />
              Save your Bearer API Key (shown once for external clients; Playground tests automatically)
            </span>
            <button
              type="button"
              onClick={() => copyText("apikey", freshApiKey)}
              className="inline-flex items-center gap-1 rounded border border-emerald-300 bg-white px-2.5 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-100 cursor-pointer"
            >
              {copiedKey === "apikey" ? (
                <Check className="h-3 w-3" />
              ) : (
                <Copy className="h-3 w-3" />
              )}
              <span>{copiedKey === "apikey" ? "Copied" : "Copy Key"}</span>
            </button>
          </div>
          <div className="font-mono text-xs text-emerald-950 bg-white/80 rounded px-3 py-2 border border-emerald-200 break-all">
            {freshApiKey}
          </div>
        </div>
      )}

      {/* Active Deployment + Playground */}
      {activeDeployment && (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* Endpoint Info & Snippets */}
          <section className="lg:col-span-2 rounded-xl border border-zinc-200 bg-white p-5 shadow-xs space-y-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                  <h3 className="text-sm font-semibold text-zinc-950">
                    Live Endpoint
                  </h3>
                </div>
                <p className="font-mono text-[11px] text-zinc-500 mt-0.5">
                  {activeDeployment.functionName} · {activeDeployment.memoryMb} MB
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleUndeploy(activeDeployment)}
                className="inline-flex items-center gap-1 rounded border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50 cursor-pointer"
              >
                <Trash2 className="h-3 w-3" />
                <span>Undeploy</span>
              </button>
            </div>

            <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-2.5 flex items-center justify-between gap-2">
              <span className="font-mono text-xs text-zinc-900 truncate">
                {activeDeployment.functionUrl}
              </span>
              <button
                type="button"
                onClick={() => copyText("url", activeDeployment.functionUrl)}
                className="text-zinc-500 hover:text-zinc-900 shrink-0 cursor-pointer"
                aria-label="Copy endpoint URL"
              >
                {copiedKey === "url" ? (
                  <Check className="h-3.5 w-3.5 text-emerald-600" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </button>
            </div>

            <div className="flex items-center justify-between gap-2 text-xs">
              <button
                type="button"
                onClick={() => handlePing(activeDeployment)}
                disabled={pingResult?.loading}
                className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 font-medium text-zinc-700 hover:bg-zinc-50 cursor-pointer"
              >
                <Activity className="h-3.5 w-3.5 text-[#0f766e]" />
                <span>{pingResult?.loading ? "Pinging..." : "Ping /health"}</span>
              </button>
              {pingResult && !pingResult.loading && (
                <span
                  className={`font-mono ${
                    pingResult.ok ? "text-emerald-700" : "text-red-600"
                  }`}
                >
                  {pingResult.text}
                </span>
              )}
            </div>

            <div className="pt-2 border-t border-zinc-100 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-zinc-800 inline-flex items-center gap-1.5">
                  <Terminal className="h-3.5 w-3.5" />
                  Integration Snippets
                </span>
                <div className="flex rounded-md border border-zinc-200 overflow-hidden text-[11px]">
                  {(["curl", "python", "ts"] as const).map((lang) => (
                    <button
                      key={lang}
                      type="button"
                      onClick={() => setSnippetLang(lang)}
                      className={`px-2 py-1 font-medium cursor-pointer ${
                        snippetLang === lang
                          ? "bg-[#0f766e] text-white"
                          : "bg-white text-zinc-600 hover:bg-zinc-50"
                      }`}
                    >
                      {lang === "curl"
                        ? "cURL"
                        : lang === "python"
                          ? "Python"
                          : "TS"}
                    </button>
                  ))}
                </div>
              </div>

              <div className="relative">
                <pre className="rounded-lg bg-zinc-950 text-zinc-100 p-3 font-mono text-[11px] overflow-x-auto leading-relaxed">
                  {snippets[snippetLang]}
                </pre>
                <button
                  type="button"
                  onClick={() => copyText("snippet", snippets[snippetLang])}
                  className="absolute top-2 right-2 rounded border border-zinc-700 bg-zinc-900/90 px-2 py-1 text-[10px] text-zinc-200 hover:bg-zinc-800 cursor-pointer"
                >
                  {copiedKey === "snippet" ? "Copied" : "Copy"}
                </button>
              </div>
            </div>
          </section>

          {/* Interactive Inference Playground */}
          <section className="lg:col-span-3 rounded-xl border border-zinc-200 bg-white p-5 shadow-xs space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-zinc-950">
                  Live Inference Playground
                </h3>
                <p className="text-xs text-zinc-500">
                  Sends requests directly to your live AWS Lambda Function URL.
                </p>
              </div>

              <div className="flex rounded-lg border border-zinc-200 overflow-hidden text-xs">
                <button
                  type="button"
                  onClick={() => setInputMode("text")}
                  className={`px-3 py-1.5 font-medium cursor-pointer ${
                    inputMode === "text"
                      ? "bg-[#0f766e] text-white"
                      : "bg-white text-zinc-600"
                  }`}
                >
                  Paste Text
                </button>
                <button
                  type="button"
                  onClick={() => setInputMode("file")}
                  className={`px-3 py-1.5 font-medium cursor-pointer ${
                    inputMode === "file"
                      ? "bg-[#0f766e] text-white"
                      : "bg-white text-zinc-600"
                  }`}
                >
                  Upload PDF / DOCX
                </button>
              </div>
            </div>

            <form onSubmit={handlePredict} className="space-y-3">
              {inputMode === "text" ? (
                <textarea
                  id="textarea-playground-input"
                  rows={5}
                  value={testText}
                  onChange={(e) => setTestText(e.target.value)}
                  placeholder="Paste an invoice, support ticket, contract excerpt, or review to classify..."
                  className="w-full rounded-lg border border-zinc-300 p-3 text-sm text-zinc-950 focus:outline-none focus:ring-2 focus:ring-[#0f766e]/20 focus:border-[#0f766e]"
                />
              ) : (
                <label className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-zinc-300 bg-zinc-50 py-8 px-4 cursor-pointer hover:border-[#0f766e]">
                  <input
                    type="file"
                    accept=".pdf,.docx,.txt,.md"
                    onChange={(e) => setTestFile(e.target.files?.[0] || null)}
                    className="hidden"
                  />
                  <FileUp className="h-6 w-6 text-[#0f766e] mb-2" />
                  <span className="text-sm font-medium text-zinc-900">
                    {testFile
                      ? testFile.name
                      : "Choose a .pdf, .docx, or .txt document to test"}
                  </span>
                </label>
              )}

              <button
                id="btn-run-prediction"
                type="submit"
                disabled={predicting}
                className="inline-flex items-center gap-2 rounded-lg bg-[#0f766e] hover:bg-[#115e59] text-white px-4 py-2 text-sm font-medium disabled:opacity-60 cursor-pointer"
              >
                {predicting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
                <span>{predicting ? "Running Lambda..." : "Run Prediction"}</span>
              </button>
            </form>

            {prediction && prediction.predictions?.[0] && (
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-zinc-500">Prediction:</span>
                    {prediction.predictions[0].labels.map((lbl) => (
                      <span
                        key={lbl}
                        className="rounded-md bg-[#0f766e] px-2.5 py-1 text-xs font-semibold text-white"
                      >
                        {lbl}
                      </span>
                    ))}
                    <span className="font-mono text-xs text-zinc-700">
                      {formatPct(prediction.predictions[0].confidence)} confidence
                    </span>
                  </div>
                  <span className="font-mono text-[11px] text-zinc-500">
                    Lambda: {prediction.latencyMs} ms
                    {prediction.coldStart ? " (cold start)" : ""} · Total:{" "}
                    {prediction.roundTripMs} ms
                  </span>
                </div>

                {/* Probability Bars */}
                <div className="space-y-2">
                  {Object.entries(prediction.predictions[0].probabilities)
                    .sort((a, b) => b[1] - a[1])
                    .map(([cls, prob]) => (
                      <div key={cls} className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <span className="font-medium text-zinc-800">{cls}</span>
                          <span className="font-mono text-zinc-600">
                            {(prob * 100).toFixed(1)}%
                          </span>
                        </div>
                        <div className="h-2 w-full rounded-full bg-zinc-200 overflow-hidden">
                          <div
                            className="h-full bg-[#0f766e] rounded-full transition-all"
                            style={{ width: `${Math.max(2, prob * 100)}%` }}
                          />
                        </div>
                      </div>
                    ))}
                </div>

                {/* Live Signal Tokens */}
                {prediction.predictions[0].topSignals?.length > 0 && (
                  <div className="pt-2 border-t border-zinc-200 space-y-1.5">
                    <div className="text-xs font-medium text-zinc-700">
                      Matched Document Signal Tokens
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {prediction.predictions[0].topSignals.map((sig) => (
                        <span
                          key={sig.token}
                          className="rounded-md border border-teal-200 bg-white px-2 py-0.5 font-mono text-xs text-[#0f766e]"
                        >
                          {sig.token} (+{sig.score.toFixed(3)})
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
