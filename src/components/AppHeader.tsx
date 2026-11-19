"use client";

import {
  Activity,
  Cpu,
  FolderKanban,
  LogOut,
  Settings,
  User,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useWorkspaceAuth } from "@/components/AuthGate";

interface HealthSummary {
  configured: boolean;
  healthy: boolean;
  region?: string;
}

export function AppHeader() {
  const pathname = usePathname();
  const { authRequired, username, signOut } = useWorkspaceAuth();
  const [health, setHealth] = useState<HealthSummary | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/health", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (active && data) setHealth(data);
      })
      .catch(() => null);

    return () => {
      active = false;
    };
  }, []);

  const navItems = [
    {
      href: "/",
      label: "Projects",
      icon: FolderKanban,
      match: (p: string) => p === "/" || p.startsWith("/projects"),
    },
    {
      href: "/deployments",
      label: "Deployments",
      icon: Cpu,
      match: (p: string) => p.startsWith("/deployments"),
    },
    {
      href: "/settings",
      label: "AWS Setup",
      icon: Settings,
      match: (p: string) => p.startsWith("/settings"),
    },
  ];

  return (
    <header className="sticky top-0 z-30 border-b border-zinc-200 bg-white/95 backdrop-blur-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-15 flex items-center justify-between gap-4">
        <div className="flex items-center gap-8">
          <Link href="/" className="flex items-center gap-2.5 group">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[#0f766e] text-white font-mono text-sm font-semibold tracking-tight shadow-xs">
              ml
            </span>
            <div className="flex flex-col">
              <span className="text-sm font-semibold tracking-tight text-zinc-950 leading-none">
                ml_train
              </span>
              <span className="text-[11px] text-zinc-500 leading-tight mt-0.5">
                Document ML Studio
              </span>
            </div>
          </Link>

          <nav className="flex items-center gap-1" aria-label="Primary Navigation">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = item.match(pathname);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                    active
                      ? "bg-teal-50 text-[#0f766e]"
                      : "text-zinc-600 hover:text-zinc-950 hover:bg-zinc-100"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-2.5">
          <Link
            href="/settings"
            className="hidden sm:inline-flex items-center gap-2 px-2.5 py-1 rounded-md border border-zinc-200 bg-zinc-50 hover:bg-zinc-100 transition-colors text-xs text-zinc-700"
          >
            <Activity
              className={`h-3.5 w-3.5 ${
                !health
                  ? "text-zinc-400"
                  : health.healthy
                    ? "text-emerald-600"
                    : health.configured
                      ? "text-amber-600"
                      : "text-zinc-400"
              }`}
            />
            <span className="font-medium">
              {!health
                ? "Checking AWS..."
                : health.healthy
                  ? `AWS Ready (${health.region})`
                  : health.configured
                    ? "AWS Attention"
                    : "AWS Unconfigured"}
            </span>
          </Link>

          {authRequired && (
            <div className="flex items-center gap-2">
              {username && (
                <span className="hidden md:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-zinc-100 text-xs font-medium text-zinc-700">
                  <User className="h-3.5 w-3.5 text-zinc-500" />
                  <span className="max-w-28 truncate">{username}</span>
                </span>
              )}
              <button
                id="btn-sign-out"
                type="button"
                onClick={signOut}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-zinc-200 text-xs font-medium text-zinc-600 hover:text-zinc-950 hover:bg-zinc-50 transition-colors cursor-pointer"
                title="Sign out"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span>Sign Out</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
