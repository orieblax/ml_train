"use client";

import {
  Activity,
  ExternalLink,
  RefreshCw,
  Shield,
  ShieldOff,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { DeploymentRecord } from "@/lib/types";

interface EnrichedDeployment extends DeploymentRecord {
  projectName?: string;
}

interface HealthCheckState {
  loading: boolean;
  ok?: boolean;
  latencyMs?: number;
  coldStart?: boolean;
  error?: string;
}

export default function DeploymentsPage() {
  const [deployments, setDeployments] = useState<EnrichedDeployment[]>([]);
  const [loading, setLoading] = useState(true);
  const [configured, setConfigured] = useState(true);
  const [error, setError] = useState("");
  const [pings, setPings] = useState<Record<string, HealthCheckState>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const resp = await fetch("/api/deployments", { cache: "no-store" });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Failed to load deployments");
      setConfigured(Boolean(data.configured));
      setDeployments(data.deployments || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/api/deployments", { cache: "no-store" })
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (!active) return;
        if (!ok) throw new Error(d.error || "Failed to load deployments");
        setConfigured(Boolean(d.configured));
        setDeployments(d.deployments || []);
      })
      .catch((err) => {
        if (active) {
          setError(err instanceof Error ? err.message : "Failed to load");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function pingHealth(dep: EnrichedDeployment) {
    setPings((prev) => ({ ...prev, [dep.deploymentId]: { loading: true } }));
    try {
      const resp = await fetch(`/api/deployments/${dep.deploymentId}/predict`, {
        method: "GET",
      });
      const data = await resp.json();
      setPings((prev) => ({
        ...prev,
        [dep.deploymentId]: {
          loading: false,
          ok: Boolean(data.ok),
          latencyMs: data.roundTripMs,
          coldStart: data.health?.coldStart,
          error: data.error,
        },
      }));
    } catch (err) {
      setPings((prev) => ({
        ...prev,
        [dep.deploymentId]: {
          loading: false,
          ok: false,
          error: err instanceof Error ? err.message : "Ping failed",
        },
      }));
    }
  }

  async function handleTeardown(dep: EnrichedDeployment) {
    if (
      !window.confirm(
        `Delete AWS Lambda "${dep.functionName}" and its Function URL?`
      )
    ) {
      return;
    }
    const resp = await fetch(
      `/api/models/${dep.modelId}/deploy?deploymentId=${dep.deploymentId}`,
      { method: "DELETE" }
    );
    if (resp.ok) {
      await load();
    } else {
      const data = await resp.json().catch(() => ({}));
      setError(data.error || "Failed to delete deployment");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 border-b border-zinc-200 pb-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">
            Deployed AWS Lambda Models
          </h1>
          <p className="text-sm text-zinc-600">
            Active isolated model endpoints running on AWS Lambda Function URLs.
          </p>
        </div>

        <button
          type="button"
          onClick={load}
          className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50 cursor-pointer"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          <span>Refresh</span>
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {!loading && !configured ? (
        <div className="rounded-xl border border-zinc-200 bg-white p-8 text-center space-y-3">
          <p className="text-sm text-zinc-600">
            AWS environment variables are not configured yet.
          </p>
          <Link
            href="/settings"
            className="inline-flex items-center gap-2 rounded-lg bg-[#0f766e] text-white px-4 py-2 text-sm font-medium"
          >
            Go to AWS Setup
          </Link>
        </div>
      ) : loading ? (
        <div className="h-48 rounded-xl border border-zinc-200 bg-white animate-pulse" />
      ) : deployments.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 bg-white p-12 text-center space-y-3">
          <p className="text-sm font-medium text-zinc-900">
            No active AWS Lambda model endpoints
          </p>
          <p className="text-xs text-zinc-600">
            Train a model inside any project and deploy it from the Deploy &amp;
            Playground tab.
          </p>
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-[#0f766e] hover:underline"
          >
            Browse Projects
          </Link>
        </div>
      ) : (
        <div className="rounded-xl border border-zinc-200 bg-white shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-zinc-50 border-b border-zinc-200 text-xs font-medium text-zinc-600">
                <tr>
                  <th className="px-4 py-3">Project / Model</th>
                  <th className="px-4 py-3">AWS Lambda Function</th>
                  <th className="px-4 py-3">Runtime</th>
                  <th className="px-4 py-3">Auth</th>
                  <th className="px-4 py-3">Endpoint Health</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {deployments.map((dep) => {
                  const ping = pings[dep.deploymentId];
                  return (
                    <tr key={dep.deploymentId} className="hover:bg-zinc-50/70">
                      <td className="px-4 py-3.5">
                        <Link
                          href={`/projects/${dep.projectId}?tab=deploy`}
                          className="font-medium text-zinc-950 hover:text-[#0f766e] inline-flex items-center gap-1"
                        >
                          <span>{dep.projectName || dep.projectId}</span>
                          <ExternalLink className="h-3 w-3" />
                        </Link>
                        <div className="font-mono text-xs text-zinc-500">
                          {dep.modelId}
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="font-mono text-xs text-zinc-900">
                          {dep.functionName}
                        </div>
                        <div className="font-mono text-[11px] text-zinc-500 max-w-xs truncate">
                          {dep.functionUrl}
                        </div>
                      </td>
                      <td className="px-4 py-3.5 font-mono text-xs text-zinc-700">
                        {dep.memoryMb} MB · {dep.timeoutSec}s
                      </td>
                      <td className="px-4 py-3.5">
                        {dep.authEnabled ? (
                          <span className="inline-flex items-center gap-1 rounded-md bg-teal-50 border border-teal-200 px-2 py-0.5 text-xs font-medium text-[#0f766e]">
                            <Shield className="h-3 w-3" />
                            Bearer Key
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 border border-amber-200 px-2 py-0.5 text-xs font-medium text-amber-800">
                            <ShieldOff className="h-3 w-3" />
                            Public
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => pingHealth(dep)}
                            disabled={ping?.loading}
                            className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-white px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 cursor-pointer"
                          >
                            <Activity className="h-3 w-3 text-[#0f766e]" />
                            <span>{ping?.loading ? "Pinging..." : "Ping"}</span>
                          </button>
                          {ping && !ping.loading && (
                            <span
                              className={`font-mono text-xs ${
                                ping.ok ? "text-emerald-700" : "text-red-600"
                              }`}
                            >
                              {ping.ok
                                ? `${ping.latencyMs}ms${ping.coldStart ? " (cold)" : ""}`
                                : ping.error || "Error"}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        <button
                          type="button"
                          onClick={() => handleTeardown(dep)}
                          className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-white px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50 cursor-pointer"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          <span>Undeploy</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
