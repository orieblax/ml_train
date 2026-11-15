"use client";

import {
  CheckCircle2,
  Copy,
  RefreshCw,
  Server,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { DiagnosticCheck } from "@/lib/types";

interface HealthPayload {
  configured: boolean;
  healthy: boolean;
  region?: string;
  missingKeys: string[];
  checks: DiagnosticCheck[];
}

export default function SettingsPage() {
  const [health, setHealth] = useState<HealthPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  const checkHealth = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await fetch("/api/health", { cache: "no-store" });
      setHealth(await resp.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/api/health", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        if (active) setHealth(data);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const bootstrapCmd =
    "python3 infra/scripts/deploy.py --region us-east-1 --create-access-key";

  async function copyBootstrap() {
    await navigator.clipboard.writeText(bootstrapCmd);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div className="space-y-8 max-w-4xl">
      <div className="flex items-end justify-between gap-4 border-b border-zinc-200 pb-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">
            AWS &amp; Vercel Diagnostics
          </h1>
          <p className="text-sm text-zinc-600">
            Verify connectivity to your AWS Free-Tier stack and review deployment
            configuration.
          </p>
        </div>

        <button
          type="button"
          onClick={checkHealth}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3.5 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50 cursor-pointer"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          <span>Run Checks</span>
        </button>
      </div>

      <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-zinc-950 flex items-center gap-2">
            <Server className="h-4 w-4 text-[#0f766e]" />
            <span>Live Cloud Resource Status</span>
          </h2>
          {health && (
            <span
              className={`rounded-md px-2.5 py-1 text-xs font-medium border ${
                health.healthy
                  ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                  : health.configured
                    ? "bg-amber-50 text-amber-800 border-amber-200"
                    : "bg-zinc-100 text-zinc-700 border-zinc-200"
              }`}
            >
              {health.healthy
                ? "All Systems Operational"
                : health.configured
                  ? "Attention Required"
                  : "Not Configured"}
            </span>
          )}
        </div>

        {loading && !health ? (
          <div className="h-36 rounded-lg bg-zinc-50 animate-pulse" />
        ) : (
          <div className="divide-y divide-zinc-100 border border-zinc-200 rounded-lg overflow-hidden">
            {(health?.checks || []).map((check) => (
              <div
                key={check.name}
                className="flex items-start justify-between gap-4 px-4 py-3 bg-white text-sm"
              >
                <div className="flex items-start gap-2.5">
                  {check.ok ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
                  ) : (
                    <XCircle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                  )}
                  <div>
                    <div className="font-medium text-zinc-900">{check.name}</div>
                    <div className="font-mono text-xs text-zinc-600 mt-0.5 break-all">
                      {check.detail}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-xs space-y-4">
        <h2 className="text-base font-semibold text-zinc-950">
          One-Command AWS Free-Tier Bootstrap
        </h2>
        <p className="text-sm text-zinc-600">
          Run this script locally with your AWS CLI credentials to build the
          Python 3.12 ML Layer (&lt; 235 MB unzipped), deploy{" "}
          <code className="font-mono text-xs bg-zinc-100 px-1.5 py-0.5 rounded">
            infra/cloudformation.yaml
          </code>
          , and generate scoped Vercel environment variables.
        </p>

        <div className="flex items-center justify-between gap-3 rounded-lg bg-zinc-950 text-zinc-100 px-4 py-3 font-mono text-xs">
          <span className="overflow-x-auto">{bootstrapCmd}</span>
          <button
            type="button"
            onClick={copyBootstrap}
            className="inline-flex items-center gap-1 rounded border border-zinc-700 px-2.5 py-1 text-zinc-200 hover:bg-zinc-800 shrink-0 cursor-pointer"
          >
            <Copy className="h-3 w-3" />
            <span>{copied ? "Copied" : "Copy"}</span>
          </button>
        </div>

        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 flex items-start gap-3 text-xs text-amber-900">
          <ShieldAlert className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
          <div className="space-y-1">
            <div className="font-semibold">AWS Free Tier Guardrails Built In</div>
            <ul className="list-disc pl-4 space-y-0.5">
              <li>
                <strong>AWS Lambda Always Free</strong>: 1M requests + 400,000 GB-s/month. Uses Function URLs (zero API Gateway cost) and disables Provisioned Concurrency.
              </li>
              <li>
                <strong>AWS DynamoDB Always Free</strong>: Provisioned 10 RCU / 10 WCU on table + 10 RCU / 10 WCU on GSI1 (20 total, inside the 25 RCU/WCU Always-Free quota).
              </li>
              <li>
                <strong>CloudWatch Logs</strong>: Trainer log group retention capped at 7 days to stay well under the 5 GB free tier.
              </li>
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
}
