"use client";

import { KeyRound, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<"loading" | "locked" | "open">("loading");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/auth", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        if (data?.authenticated) {
          setState("open");
        } else {
          setState("locked");
        }
      })
      .catch(() => setState("open"));
  }, []);

  async function handleUnlock(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const resp = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        setError(body.error || "Invalid passcode");
      } else {
        setState("open");
      }
    } catch {
      setError("Failed to verify passcode");
    } finally {
      setSubmitting(false);
    }
  }

  if (state === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f8f9fa]">
        <div className="text-sm text-zinc-500 font-medium">Loading studio...</div>
      </div>
    );
  }

  if (state === "locked") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f8f9fa] px-4">
        <form
          onSubmit={handleUnlock}
          className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-6 shadow-xs space-y-5"
        >
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-teal-50 border border-teal-200 flex items-center justify-center text-[#0f766e]">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-base font-semibold tracking-tight text-zinc-950">
                ml_train Workspace
              </h1>
              <p className="text-xs text-zinc-500">
                Enter your workspace passcode to continue
              </p>
            </div>
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="workspace-pin"
              className="block text-xs font-medium text-zinc-700"
            >
              Access Passcode
            </label>
            <div className="relative">
              <KeyRound className="h-4 w-4 text-zinc-400 absolute left-3 top-2.5" />
              <input
                id="workspace-pin"
                type="password"
                required
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder="Enter APP_ACCESS_PIN"
                className="w-full rounded-lg border border-zinc-300 bg-white pl-9 pr-3 py-2 text-sm text-zinc-950 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-[#0f766e]/20 focus:border-[#0f766e]"
              />
            </div>
          </div>

          {error && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-[#0f766e] hover:bg-[#115e59] text-white text-sm font-medium py-2 transition-colors disabled:opacity-60 cursor-pointer"
          >
            {submitting ? "Verifying..." : "Unlock Studio"}
          </button>
        </form>
      </div>
    );
  }

  return <>{children}</>;
}
