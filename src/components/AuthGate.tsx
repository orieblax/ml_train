"use client";

import {
  AlertTriangle,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  LogIn,
  ShieldCheck,
  User,
} from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export interface WorkspaceAuthContextValue {
  authenticated: boolean;
  authRequired: boolean;
  username: string | null;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<WorkspaceAuthContextValue>({
  authenticated: false,
  authRequired: true,
  username: null,
  signOut: async () => {},
});

export function useWorkspaceAuth(): WorkspaceAuthContextValue {
  return useContext(AuthContext);
}

interface AuthStatusResponse {
  authenticated?: boolean;
  authRequired?: boolean;
  configured?: boolean;
  username?: string | null;
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<"loading" | "locked" | "open">("loading");
  const [authRequired, setAuthRequired] = useState(true);
  const [configured, setConfigured] = useState(true);
  const [sessionUser, setSessionUser] = useState<string | null>(null);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const checkStatus = useCallback(async () => {
    setError("");
    try {
      const resp = await fetch("/api/auth", { cache: "no-store" });
      if (!resp.ok) {
        throw new Error("Unable to verify session status");
      }
      const data = (await resp.json()) as AuthStatusResponse;
      setAuthRequired(data.authRequired ?? true);
      setConfigured(data.configured ?? true);
      setSessionUser(data.username ?? null);
      if (data.authenticated) {
        setState("open");
      } else {
        setState("locked");
      }
    } catch {
      setError("Could not reach the authentication server. Please try again.");
      setState("locked");
    }
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/api/auth", { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error("Unable to verify session status");
        return r.json() as Promise<AuthStatusResponse>;
      })
      .then((data) => {
        if (!active) return;
        setAuthRequired(data.authRequired ?? true);
        setConfigured(data.configured ?? true);
        setSessionUser(data.username ?? null);
        setState(data.authenticated ? "open" : "locked");
      })
      .catch(() => {
        if (!active) return;
        setError("Could not reach the authentication server. Please try again.");
        setState("locked");
      });
    return () => {
      active = false;
    };
  }, []);

  const signOut = useCallback(async () => {
    try {
      await fetch("/api/auth", { method: "DELETE" });
    } finally {
      setSessionUser(null);
      setPassword("");
      setShowPassword(false);
      setError("");
      setState("locked");
    }
  }, []);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const resp = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: username.trim(),
          password,
        }),
      });
      const body = (await resp.json().catch(() => ({}))) as {
        authenticated?: boolean;
        username?: string | null;
        error?: string;
      };
      if (!resp.ok || !body.authenticated) {
        setError(body.error || "Invalid username or password.");
        if (resp.status === 503) {
          setConfigured(false);
        }
      } else {
        setSessionUser(body.username ?? username.trim());
        setPassword("");
        setShowPassword(false);
        setState("open");
      }
    } catch {
      setError("Failed to contact login service. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const contextValue = useMemo<WorkspaceAuthContextValue>(
    () => ({
      authenticated: state === "open",
      authRequired,
      username: sessionUser,
      signOut,
    }),
    [state, authRequired, sessionUser, signOut]
  );

  if (state === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f8f9fa]">
        <div className="inline-flex items-center gap-2.5 text-sm text-zinc-500 font-medium">
          <Loader2 className="h-4 w-4 animate-spin text-[#0f766e]" />
          <span>Loading studio...</span>
        </div>
      </div>
    );
  }

  if (state === "locked") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#f8f9fa] px-4 py-12">
        <div className="w-full max-w-md space-y-6">
          <div className="flex flex-col items-center text-center space-y-2">
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-[#0f766e] text-white font-mono text-base font-semibold tracking-tight shadow-xs">
              ml
            </span>
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-zinc-950">
                ml_train Studio
              </h1>
              <p className="text-xs text-zinc-500 mt-0.5">
                Sign in with your workspace credentials to continue
              </p>
            </div>
          </div>

          <form
            onSubmit={handleLogin}
            className="rounded-xl border border-zinc-200 bg-white p-6 shadow-xs space-y-5"
          >
            <div className="flex items-center gap-2.5 pb-3 border-b border-zinc-100">
              <div className="h-8 w-8 rounded-lg bg-teal-50 border border-teal-200 flex items-center justify-center text-[#0f766e] shrink-0">
                <ShieldCheck className="h-4 w-4" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-zinc-950">
                  Workspace Sign In
                </h2>
                <p className="text-[11px] text-zinc-500">
                  Protected Document ML Training &amp; AWS Lambda Console
                </p>
              </div>
            </div>

            {!configured && (
              <div
                role="alert"
                className="rounded-lg border border-amber-200 bg-amber-50 p-3.5 text-xs text-amber-900 space-y-1.5"
              >
                <div className="flex items-center gap-1.5 font-semibold">
                  <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                  <span>Login credentials not configured yet</span>
                </div>
                <p className="text-amber-800 leading-relaxed">
                  Add{" "}
                  <code className="font-mono bg-amber-100 px-1 py-0.5 rounded">
                    APP_USERNAME
                  </code>{" "}
                  and{" "}
                  <code className="font-mono bg-amber-100 px-1 py-0.5 rounded">
                    APP_PASSWORD
                  </code>{" "}
                  in <strong>Vercel → Settings → Environment Variables</strong>{" "}
                  (or <code className="font-mono">.env.local</code>) and
                  redeploy.
                </p>
                <button
                  type="button"
                  onClick={checkStatus}
                  className="text-[11px] font-medium text-amber-900 underline hover:no-underline cursor-pointer"
                >
                  Re-check status
                </button>
              </div>
            )}

            <div className="space-y-4">
              <div className="space-y-1.5">
                <label
                  htmlFor="login-username"
                  className="block text-xs font-medium text-zinc-700"
                >
                  Username
                </label>
                <div className="relative">
                  <User className="h-4 w-4 text-zinc-400 absolute left-3 top-2.5 pointer-events-none" />
                  <input
                    id="login-username"
                    name="username"
                    type="text"
                    required
                    autoFocus
                    autoComplete="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Enter username"
                    disabled={!configured || submitting}
                    className="w-full rounded-lg border border-zinc-300 bg-white pl-9 pr-3 py-2 text-sm text-zinc-950 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-[#0f766e]/20 focus:border-[#0f766e] disabled:bg-zinc-50 disabled:text-zinc-400"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="login-password"
                  className="block text-xs font-medium text-zinc-700"
                >
                  Password
                </label>
                <div className="relative">
                  <KeyRound className="h-4 w-4 text-zinc-400 absolute left-3 top-2.5 pointer-events-none" />
                  <input
                    id="login-password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    required
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter password"
                    disabled={!configured || submitting}
                    className="w-full rounded-lg border border-zinc-300 bg-white pl-9 pr-10 py-2 text-sm text-zinc-950 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-[#0f766e]/20 focus:border-[#0f766e] disabled:bg-zinc-50 disabled:text-zinc-400"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    className="absolute right-2.5 top-2 p-0.5 text-zinc-400 hover:text-zinc-700 cursor-pointer"
                    tabIndex={-1}
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>
            </div>

            {error && (
              <p
                role="alert"
                className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2"
              >
                {error}
              </p>
            )}

            <button
              id="btn-login-submit"
              type="submit"
              disabled={!configured || submitting}
              className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-[#0f766e] hover:bg-[#115e59] text-white text-sm font-medium py-2.5 transition-colors disabled:opacity-60 cursor-pointer shadow-xs"
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <LogIn className="h-4 w-4" />
              )}
              <span>{submitting ? "Signing in..." : "Sign In"}</span>
            </button>

            <p className="text-[11px] text-center text-zinc-400">
              Credentials are verified server-side via environment variables.
            </p>
          </form>
        </div>
      </div>
    );
  }

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
}
