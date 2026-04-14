"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";

const VERCEL_GITHUB_APP_URL = "https://github.com/apps/vercel/installations/new";
const POLL_INTERVAL_MS = 3000;

export default function NewProjectPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showGitHubSetup, setShowGitHubSetup] = useState(false);
  const [polling, setPolling] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    setPolling(false);
  }, []);

  // Clean up polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  async function createProject() {
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });

    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error("Server error — please try again.");
    }

    if (!res.ok) {
      if (data.code === "VERCEL_GITHUB_NOT_CONNECTED") {
        return { needsGitHub: true };
      }
      throw new Error(data.error || "Failed to create project");
    }

    return { project: data };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setShowGitHubSetup(false);

    try {
      const result = await createProject();

      if (result.needsGitHub) {
        setShowGitHubSetup(true);
        setLoading(false);
        return;
      }

      router.push(`/projects/${result.project.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setLoading(false);
    }
  }

  function handleOpenGitHubApp() {
    window.open(VERCEL_GITHUB_APP_URL, "_blank", "noopener");
    startPolling();
  }

  function startPolling() {
    stopPolling();
    setPolling(true);

    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch("/api/oauth/vercel/github-status");
        const data = await res.json();

        if (data.connected) {
          stopPolling();
          // Auto-retry project creation
          setShowGitHubSetup(false);
          setLoading(true);
          setError(null);

          try {
            const result = await createProject();
            if (result.project) {
              router.push(`/projects/${result.project.id}`);
              return;
            }
          } catch (err) {
            setError(
              err instanceof Error ? err.message : "Something went wrong"
            );
          }
          setLoading(false);
        }
      } catch {
        // Network error — keep polling
      }
    }, POLL_INTERVAL_MS);
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Create a new project</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          LaunchPad will create a GitHub repo, Supabase databases, and a Vercel
          project — all wired together automatically.
        </p>
      </div>

      {showGitHubSetup && (
        <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/5 p-5 space-y-3">
          <h3 className="font-medium text-yellow-400">
            Connect GitHub to Vercel
          </h3>
          <p className="text-sm text-muted-foreground">
            Vercel needs the GitHub integration to deploy from your repos.
            Install the Vercel app on your GitHub account, then we&apos;ll
            continue automatically.
          </p>
          <div className="flex items-center gap-3">
            <button
              onClick={handleOpenGitHubApp}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Install Vercel GitHub App
            </button>
            {polling && (
              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-yellow-400" />
                Waiting for installation...
              </span>
            )}
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label
            htmlFor="name"
            className="block text-sm font-medium text-foreground"
          >
            Project name
          </label>
          <input
            id="name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="my-cool-app"
            pattern="[a-z0-9][a-z0-9-]*[a-z0-9]"
            title="Lowercase letters, numbers, and hyphens. Must start and end with a letter or number."
            required
            className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Lowercase letters, numbers, and hyphens only
          </p>
        </div>

        {error && (
          <div className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading || !name || showGitHubSetup}
          className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {loading ? "Creating..." : "Create Project"}
        </button>
      </form>
    </div>
  );
}
