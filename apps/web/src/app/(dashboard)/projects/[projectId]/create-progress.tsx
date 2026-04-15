"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type ProjectStatus =
  | "CREATING"
  | "AWAITING_VERCEL"
  | "ACTIVE"
  | "ERROR"
  | "DELETING"
  | "DELETED";

type Props = {
  projectId: string;
  initialStatus: ProjectStatus;
};

const POLL_INTERVAL_MS = 2000;

export function CreateProgress({ projectId, initialStatus }: Props) {
  const router = useRouter();
  const [status, setStatus] = useState<ProjectStatus>(initialStatus);
  const [error, setError] = useState<string | null>(null);
  const redirectedRef = useRef(false);

  useEffect(() => {
    if (status === "ACTIVE" || status === "ERROR") return;

    const controller = new AbortController();
    let cancelled = false;

    const tick = async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!res.ok) return;
        const data: { status: ProjectStatus } = await res.json();
        if (cancelled) return;
        setStatus(data.status);
      } catch {
        // transient — next tick will retry
      }
    };

    tick();
    const id = setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(id);
    };
  }, [projectId, status]);

  useEffect(() => {
    if (status !== "AWAITING_VERCEL" || redirectedRef.current) return;

    const storageKey = `lp:vercel-redirect:${projectId}`;
    if (typeof window !== "undefined" && sessionStorage.getItem(storageKey)) {
      // User already bounced once this session — don't loop.
      return;
    }

    redirectedRef.current = true;
    (async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/vercel-deploy-url`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setError(body.error || "Failed to build Vercel deploy URL");
          return;
        }
        const { url } = (await res.json()) as { url: string };
        if (typeof window !== "undefined") {
          sessionStorage.setItem(storageKey, "1");
          window.location.assign(url);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unexpected error");
      }
    })();
  }, [projectId, status]);

  useEffect(() => {
    if (status === "ACTIVE") {
      router.refresh();
    }
  }, [status, router]);

  if (status === "ACTIVE") return null;

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center gap-3">
        <Spinner />
        <div>
          <h2 className="text-sm font-medium">
            {status === "CREATING" && "Preparing your project…"}
            {status === "AWAITING_VERCEL" && "Handing off to Vercel…"}
            {status === "ERROR" && "Project setup failed"}
            {(status === "DELETING" || status === "DELETED") &&
              "This project is being removed"}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {status === "CREATING" &&
              "Creating the GitHub repo, provisioning staging + production databases, and pushing your scaffolded template. This usually takes about a minute."}
            {status === "AWAITING_VERCEL" &&
              "Redirecting you to Vercel to create the deployment project under your own account. Once you finish there, we'll wire up env vars and trigger the first build automatically."}
            {status === "ERROR" &&
              "Something went wrong while setting up the project. Check the server logs and try creating a new project."}
          </p>
          {error && (
            <p className="mt-2 text-xs text-red-400">{error}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden
      className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-muted border-t-primary"
    />
  );
}
