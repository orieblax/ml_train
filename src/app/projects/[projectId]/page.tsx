"use client";

import {
  ArrowLeft,
  BarChart3,
  Cpu,
  FileText,
  Rocket,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { DeployTab } from "@/components/studio/DeployTab";
import { DocumentsTab } from "@/components/studio/DocumentsTab";
import { EvaluateTab } from "@/components/studio/EvaluateTab";
import { TrainTab } from "@/components/studio/TrainTab";
import type {
  DeploymentRecord,
  DocumentRecord,
  ModelVersionRecord,
  ProjectRecord,
  TrainingJobRecord,
} from "@/lib/types";

type StudioTab = "documents" | "train" | "evaluate" | "deploy";

function ProjectStudioInner() {
  const params = useParams<{ projectId: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const projectId = params.projectId;

  const initialTab = (searchParams.get("tab") as StudioTab) || "documents";
  const [activeTab, setActiveTab] = useState<StudioTab>(
    ["documents", "train", "evaluate", "deploy"].includes(initialTab)
      ? initialTab
      : "documents"
  );

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [project, setProject] = useState<ProjectRecord | null>(null);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [jobs, setJobs] = useState<TrainingJobRecord[]>([]);
  const [models, setModels] = useState<ModelVersionRecord[]>([]);
  const [deployments, setDeployments] = useState<DeploymentRecord[]>([]);
  const [selectedModelId, setSelectedModelId] = useState<string>("");

  const loadProject = useCallback(async () => {
    setError("");
    try {
      const resp = await fetch(`/api/projects/${projectId}`, {
        cache: "no-store",
      });
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.error || "Failed to load project");
      }
      setProject(data.project);
      setDocuments(data.documents || []);
      setJobs(data.jobs || []);
      const fetchedModels = (data.models || []) as ModelVersionRecord[];
      setModels(fetchedModels);
      setDeployments(data.deployments || []);
      if (fetchedModels.length > 0) {
        setSelectedModelId((prev) => prev || fetchedModels[0].modelId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load project");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    let active = true;
    fetch(`/api/projects/${projectId}`, { cache: "no-store" })
      .then((r) => r.json().then((data) => ({ ok: r.ok, data })))
      .then(({ ok, data }) => {
        if (!active) return;
        if (!ok) throw new Error(data.error || "Failed to load project");
        setProject(data.project);
        setDocuments(data.documents || []);
        setJobs(data.jobs || []);
        const fetchedModels = (data.models || []) as ModelVersionRecord[];
        setModels(fetchedModels);
        setDeployments(data.deployments || []);
        if (fetchedModels.length > 0) {
          setSelectedModelId((prev) => prev || fetchedModels[0].modelId);
        }
      })
      .catch((err) => {
        if (active) {
          setError(err instanceof Error ? err.message : "Failed to load project");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [projectId]);

  async function handleDeleteProject() {
    if (!project) return;
    if (
      !window.confirm(
        `Delete "${project.name}", all uploaded documents, trained models, and active AWS Lambdas?`
      )
    ) {
      return;
    }
    const resp = await fetch(`/api/projects/${projectId}`, {
      method: "DELETE",
    });
    if (resp.ok) {
      router.push("/");
    } else {
      const data = await resp.json().catch(() => ({}));
      setError(data.error || "Failed to delete project");
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-16 rounded-xl bg-white border border-zinc-200 animate-pulse" />
        <div className="h-72 rounded-xl bg-white border border-zinc-200 animate-pulse" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-8 text-center space-y-3">
        <p className="text-sm text-red-600">{error || "Project not found"}</p>
        <Link href="/" className="text-sm font-medium text-[#0f766e] hover:underline">
          Back to Projects
        </Link>
      </div>
    );
  }

  const tabs: Array<{
    id: StudioTab;
    label: string;
    step: number;
    icon: React.ComponentType<{ className?: string }>;
    badge?: string | number;
  }> = [
    {
      id: "documents",
      label: "Documents & Labels",
      step: 1,
      icon: FileText,
      badge: documents.length,
    },
    {
      id: "train",
      label: "Train Model",
      step: 2,
      icon: Cpu,
      badge: jobs.length || undefined,
    },
    {
      id: "evaluate",
      label: "Evaluate & Explain",
      step: 3,
      icon: BarChart3,
      badge: models.length || undefined,
    },
    {
      id: "deploy",
      label: "Deploy & Playground",
      step: 4,
      icon: Rocket,
      badge: deployments.length || undefined,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div className="space-y-1.5">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-500 hover:text-zinc-900"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>All Projects</span>
          </Link>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">
              {project.name}
            </h1>
            <span className="rounded-md border border-zinc-200 bg-white px-2 py-0.5 font-mono text-xs text-zinc-700">
              {project.taskType}
            </span>
          </div>
          {project.description && (
            <p className="text-sm text-zinc-600">{project.description}</p>
          )}
        </div>

        <button
          type="button"
          onClick={handleDeleteProject}
          className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-600 hover:text-red-600 hover:border-red-200 transition-colors cursor-pointer shrink-0"
        >
          <Trash2 className="h-3.5 w-3.5" />
          <span>Delete Project</span>
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* 4-Step Studio Tab Bar */}
      <div
        className="flex flex-wrap gap-2 border-b border-zinc-200 pb-3"
        role="tablist"
      >
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              id={`tab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setActiveTab(tab.id)}
              className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors cursor-pointer ${
                active
                  ? "bg-[#0f766e] text-white shadow-xs"
                  : "bg-white border border-zinc-200 text-zinc-700 hover:bg-zinc-50"
              }`}
            >
              <span
                className={`h-5 w-5 rounded-full text-[11px] font-mono inline-flex items-center justify-center ${
                  active
                    ? "bg-white/20 text-white"
                    : "bg-zinc-100 text-zinc-600"
                }`}
              >
                {tab.step}
              </span>
              <Icon className="h-4 w-4" />
              <span>{tab.label}</span>
              {tab.badge !== undefined && (
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[11px] font-mono leading-none ${
                    active
                      ? "bg-white/20 text-white"
                      : "bg-zinc-100 text-zinc-600"
                  }`}
                >
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {activeTab === "documents" && (
        <DocumentsTab
          project={project}
          documents={documents}
          onRefresh={loadProject}
        />
      )}

      {activeTab === "train" && (
        <TrainTab
          project={project}
          documents={documents}
          jobs={jobs}
          onRefresh={loadProject}
          onTrainingSucceeded={(modelId) => {
            setSelectedModelId(modelId);
            setActiveTab("evaluate");
          }}
        />
      )}

      {activeTab === "evaluate" && (
        <EvaluateTab
          models={models}
          selectedModelId={selectedModelId}
          onSelectModel={setSelectedModelId}
          onDeployClick={(modelId) => {
            setSelectedModelId(modelId);
            setActiveTab("deploy");
          }}
        />
      )}

      {activeTab === "deploy" && (
        <DeployTab
          models={models}
          deployments={deployments}
          selectedModelId={selectedModelId}
          onSelectModel={setSelectedModelId}
          onRefresh={loadProject}
        />
      )}
    </div>
  );
}

export default function ProjectStudioPage() {
  return (
    <Suspense
      fallback={
        <div className="h-72 rounded-xl bg-white border border-zinc-200 animate-pulse" />
      }
    >
      <ProjectStudioInner />
    </Suspense>
  );
}
