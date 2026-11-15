"use client";

import {
  ArrowRight,
  CheckCircle2,
  Cpu,
  FileText,
  FolderPlus,
  Layers,
  Plus,
  Sparkles,
  Terminal,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { formatPct } from "@/lib/dataset-utils";
import type { ProjectRecord, TaskType } from "@/lib/types";

interface EnrichedProject extends ProjectRecord {
  totalSamples: number;
  labeledSamples: number;
  modelCount: number;
  latestMacroF1: string | null;
  activeDeploymentCount: number;
}

const TASK_LABELS: Record<TaskType, { title: string; badge: string; hint: string }> = {
  multiclass: {
    title: "Multi-Class Classification",
    badge: "Single Label",
    hint: "Assign one primary category per document (e.g., Billing, Legal, Technical).",
  },
  multilabel: {
    title: "Multi-Label Tagging",
    badge: "Multi Tag",
    hint: "Predict one or more independent tags per document (e.g., Urgent, Security, VIP).",
  },
  sentiment: {
    title: "Sentiment Analysis",
    badge: "Polarity",
    hint: "Classify tone or polarity (preloaded with Positive, Neutral, Negative classes).",
  },
};

export default function HomePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [configured, setConfigured] = useState(true);
  const [projects, setProjects] = useState<EnrichedProject[]>([]);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [taskType, setTaskType] = useState<TaskType>("multiclass");
  const [labelsInput, setLabelsInput] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/projects", { cache: "no-store" })
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (!active) return;
        if (!ok) throw new Error(d.error || "Failed to load projects");
        setConfigured(Boolean(d.configured));
        setProjects(d.projects || []);
      })
      .catch((err) => {
        if (active) {
          setError(err instanceof Error ? err.message : "Failed to load workspace");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function handleCreateProject(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError("");
    try {
      const parsedLabels = labelsInput
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      const resp = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description,
          taskType,
          labels: parsedLabels,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.error || "Failed to create project");
      }
      setShowCreate(false);
      router.push(`/projects/${data.project.projectId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create project");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-zinc-200 pb-6">
        <div className="space-y-1.5">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">
            Document ML Projects
          </h1>
          <p className="text-sm text-zinc-600 max-w-2xl">
            Ingest PDF, DOCX, TXT, or CSV documents, train scikit-learn text
            models asynchronously on AWS Lambda, and deploy isolated Function URL
            endpoints.
          </p>
        </div>

        {configured && (
          <button
            id="btn-new-project"
            type="button"
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#0f766e] hover:bg-[#115e59] text-white px-4 py-2.5 text-sm font-medium transition-colors shadow-xs cursor-pointer shrink-0"
          >
            <Plus className="h-4 w-4" />
            <span>New Project</span>
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {!loading && !configured ? (
        <section className="rounded-xl border border-zinc-200 bg-white p-6 sm:p-8 shadow-xs space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <h2 className="text-lg font-semibold tracking-tight text-zinc-950">
                Connect your AWS Free-Tier Backend
              </h2>
              <p className="text-sm text-zinc-600">
                Run the one-time CloudFormation bootstrap script to provision S3,
                Always-Free DynamoDB, the Shared ML Layer, and the Trainer Lambda.
              </p>
            </div>
            <Link
              href="/settings"
              className="inline-flex items-center gap-2 rounded-lg bg-[#0f766e] hover:bg-[#115e59] text-white px-4 py-2 text-sm font-medium transition-colors shrink-0"
            >
              <Terminal className="h-4 w-4" />
              <span>Open Diagnostics & Setup</span>
            </Link>
          </div>

          <div className="rounded-lg border border-zinc-200 bg-zinc-950 text-zinc-100 p-4 font-mono text-xs overflow-x-auto space-y-1.5">
            <div className="text-zinc-400">
              # 1. Build Python 3.12 ML Layer (&lt; 235 MB unzipped) &amp; deploy CloudFormation stack
            </div>
            <div>python3 infra/scripts/deploy.py --region us-east-1 --create-access-key</div>
            <div className="text-zinc-400 pt-2">
              # 2. Paste the printed variables into .env.local (local) or Vercel Project Settings
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
            <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 space-y-1">
              <div className="text-xs font-medium text-zinc-500">Storage &amp; DB</div>
              <div className="text-sm font-semibold text-zinc-900">
                S3 + DynamoDB (10 RCU/WCU)
              </div>
              <p className="text-xs text-zinc-600">
                Direct browser-to-S3 presigned uploads bypass Vercel&apos;s 4.5 MB body limit.
              </p>
            </div>
            <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 space-y-1">
              <div className="text-xs font-medium text-zinc-500">Async Training</div>
              <div className="text-sm font-semibold text-zinc-900">
                Lambda AutoML Tournament
              </div>
              <p className="text-xs text-zinc-600">
                Cross-validates Logistic Regression, LinearSVC, Naive Bayes &amp; SGD up to 15 min.
              </p>
            </div>
            <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 space-y-1">
              <div className="text-xs font-medium text-zinc-500">Model Hosting</div>
              <div className="text-sm font-semibold text-zinc-900">
                Isolated Lambda Function URLs
              </div>
              <p className="text-xs text-zinc-600">
                Each model deploys with Bearer API key auth and live token attributions.
              </p>
            </div>
          </div>
        </section>
      ) : loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-44 rounded-xl border border-zinc-200 bg-white p-5 animate-pulse"
            />
          ))}
        </div>
      ) : projects.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 bg-white p-12 text-center space-y-4">
          <div className="mx-auto h-11 w-11 rounded-xl bg-teal-50 border border-teal-200 flex items-center justify-center text-[#0f766e]">
            <FolderPlus className="h-5 w-5" />
          </div>
          <div className="space-y-1 max-w-md mx-auto">
            <h2 className="text-base font-semibold text-zinc-950">
              No ML projects yet
            </h2>
            <p className="text-sm text-zinc-600">
              Create your first document model project to upload PDFs, Word
              documents, or labeled CSVs and deploy an inference endpoint.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-[#0f766e] hover:bg-[#115e59] text-white px-4 py-2 text-sm font-medium transition-colors cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            <span>Create First Project</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {projects.map((p) => (
            <Link
              key={p.projectId}
              href={`/projects/${p.projectId}`}
              className="group rounded-xl border border-zinc-200 bg-white p-5 shadow-xs hover:border-zinc-300 hover:shadow-sm transition-all flex flex-col justify-between gap-5"
            >
              <div className="space-y-2.5">
                <div className="flex items-start justify-between gap-3">
                  <h2 className="text-base font-semibold tracking-tight text-zinc-950 group-hover:text-[#0f766e] transition-colors line-clamp-1">
                    {p.name}
                  </h2>
                  <span className="shrink-0 rounded-md border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[11px] font-medium text-zinc-700">
                    {TASK_LABELS[p.taskType].badge}
                  </span>
                </div>
                <p className="text-xs text-zinc-600 line-clamp-2 min-h-[2rem]">
                  {p.description || TASK_LABELS[p.taskType].hint}
                </p>
              </div>

              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-2 pt-3 border-t border-zinc-100 text-xs">
                  <div>
                    <div className="text-zinc-500 flex items-center gap-1">
                      <FileText className="h-3 w-3" />
                      <span>Samples</span>
                    </div>
                    <div className="font-mono font-semibold text-zinc-900 mt-0.5">
                      {p.labeledSamples}
                    </div>
                  </div>
                  <div>
                    <div className="text-zinc-500 flex items-center gap-1">
                      <Sparkles className="h-3 w-3" />
                      <span>Macro F1</span>
                    </div>
                    <div className="font-mono font-semibold text-zinc-900 mt-0.5">
                      {p.latestMacroF1 ? formatPct(p.latestMacroF1) : "—"}
                    </div>
                  </div>
                  <div>
                    <div className="text-zinc-500 flex items-center gap-1">
                      <Cpu className="h-3 w-3" />
                      <span>Lambdas</span>
                    </div>
                    <div className="font-mono font-semibold text-zinc-900 mt-0.5">
                      {p.activeDeploymentCount}
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs font-medium text-[#0f766e]">
                  <span>
                    {p.modelCount > 0
                      ? `${p.modelCount} trained version${p.modelCount === 1 ? "" : "s"}`
                      : "Open studio"}
                  </span>
                  <ArrowRight className="h-3.5 w-3.5 group-hover:translate-x-0.5 transition-transform" />
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {showCreate && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40 backdrop-blur-[2px] p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-project-title"
        >
          <div className="w-full max-w-lg rounded-xl border border-zinc-200 bg-white shadow-xl overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200">
              <div className="flex items-center gap-2">
                <Layers className="h-4 w-4 text-[#0f766e]" />
                <h2
                  id="create-project-title"
                  className="text-base font-semibold text-zinc-950"
                >
                  New Document ML Project
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="text-zinc-400 hover:text-zinc-700 cursor-pointer"
                aria-label="Close modal"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleCreateProject} className="p-6 space-y-5">
              <div className="space-y-1.5">
                <label
                  htmlFor="input-project-name"
                  className="block text-xs font-medium text-zinc-700"
                >
                  Project Name
                </label>
                <input
                  id="input-project-name"
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g., Support Ticket Triage or Contract Clause Classifier"
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-950 focus:outline-none focus:ring-2 focus:ring-[#0f766e]/20 focus:border-[#0f766e]"
                />
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="input-project-desc"
                  className="block text-xs font-medium text-zinc-700"
                >
                  Description (optional)
                </label>
                <input
                  id="input-project-desc"
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What documents or business routing does this model handle?"
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-950 focus:outline-none focus:ring-2 focus:ring-[#0f766e]/20 focus:border-[#0f766e]"
                />
              </div>

              <div className="space-y-2">
                <span className="block text-xs font-medium text-zinc-700">
                  ML Task Type
                </span>
                <div className="grid grid-cols-1 gap-2">
                  {(Object.keys(TASK_LABELS) as TaskType[]).map((key) => {
                    const selected = taskType === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setTaskType(key)}
                        className={`text-left rounded-lg border p-3 transition-colors cursor-pointer ${
                          selected
                            ? "border-[#0f766e] bg-teal-50/70"
                            : "border-zinc-200 hover:border-zinc-300 bg-white"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-zinc-950">
                            {TASK_LABELS[key].title}
                          </span>
                          {selected && (
                            <CheckCircle2 className="h-4 w-4 text-[#0f766e]" />
                          )}
                        </div>
                        <p className="text-xs text-zinc-600 mt-0.5">
                          {TASK_LABELS[key].hint}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="input-project-labels"
                  className="block text-xs font-medium text-zinc-700"
                >
                  Initial Labels (comma-separated, optional — auto-populated from CSV too)
                </label>
                <input
                  id="input-project-labels"
                  type="text"
                  value={labelsInput}
                  onChange={(e) => setLabelsInput(e.target.value)}
                  placeholder={
                    taskType === "sentiment"
                      ? "Positive, Neutral, Negative"
                      : "Billing, Technical, Legal"
                  }
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-950 focus:outline-none focus:ring-2 focus:ring-[#0f766e]/20 focus:border-[#0f766e]"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  id="btn-submit-create-project"
                  type="submit"
                  disabled={creating}
                  className="rounded-lg bg-[#0f766e] hover:bg-[#115e59] text-white px-4 py-2 text-sm font-medium transition-colors disabled:opacity-60 cursor-pointer"
                >
                  {creating ? "Creating..." : "Create Project"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
