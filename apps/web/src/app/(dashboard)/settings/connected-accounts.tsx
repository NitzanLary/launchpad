"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { useState, useEffect, Suspense } from "react";

type ConnectionInfo = {
  providerAccountId: string;
  tokenExpiresAt: string | null;
  updatedAt: string;
};

type ConnectionMap = Record<string, ConnectionInfo>;

const PROVIDERS = [
  {
    key: "GITHUB",
    label: "GitHub",
    description: "Repository creation, webhooks, and code push",
    connectUrl: null, // Auto-connected via sign-in
    canDisconnect: false,
  },
  {
    key: "VERCEL",
    label: "Vercel",
    description: "Project hosting, deployments, and environment variables",
    connectUrl: "/api/oauth/vercel",
    canDisconnect: true,
  },
  {
    key: "SUPABASE",
    label: "Supabase",
    description: "Database provisioning and management",
    connectUrl: "/api/oauth/supabase",
    canDisconnect: true,
  },
] as const;

function ConnectedAccountsInner({
  connections,
}: {
  connections: ConnectionMap;
}) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [notification, setNotification] = useState<{
    type: "success" | "error" | "warning";
    message: string;
  } | null>(null);

  useEffect(() => {
    const connected = searchParams.get("connected");
    const error = searchParams.get("error");
    const warning = searchParams.get("warning");

    if (connected) {
      setNotification({
        type: "success",
        message: `${connected.charAt(0).toUpperCase() + connected.slice(1)} connected successfully.`,
      });
    } else if (warning === "supabase_slots_full") {
      setNotification({
        type: "warning",
        message:
          "Supabase connected, but your account already has projects. LaunchPad needs 2 free project slots. Please delete existing Supabase projects or upgrade your plan.",
      });
    } else if (error) {
      setNotification({
        type: "error",
        message: decodeURIComponent(error),
      });
    }

    // Clean URL params after reading
    if (connected || error || warning) {
      router.replace("/settings", { scroll: false });
    }
  }, [searchParams, router]);

  async function handleDisconnect(provider: string) {
    setDisconnecting(provider);
    try {
      const response = await fetch("/api/oauth/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
      });

      if (!response.ok) {
        const data = await response.json();
        setNotification({ type: "error", message: data.error });
        return;
      }

      setNotification({
        type: "success",
        message: `${provider.charAt(0) + provider.slice(1).toLowerCase()} disconnected.`,
      });
      router.refresh();
    } catch {
      setNotification({
        type: "error",
        message: "Failed to disconnect. Please try again.",
      });
    } finally {
      setDisconnecting(null);
    }
  }

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">Connected Accounts</h2>

      {notification && (
        <div
          className={`rounded-lg px-4 py-3 text-sm ${
            notification.type === "success"
              ? "bg-green-500/10 text-green-400"
              : notification.type === "warning"
                ? "bg-yellow-500/10 text-yellow-400"
                : "bg-red-500/10 text-red-400"
          }`}
        >
          {notification.message}
          <button
            onClick={() => setNotification(null)}
            className="ml-2 text-xs opacity-60 hover:opacity-100"
          >
            dismiss
          </button>
        </div>
      )}

      <div className="space-y-3">
        {PROVIDERS.map((provider) => {
          const connection = connections[provider.key];
          const isExpired =
            connection?.tokenExpiresAt &&
            new Date(connection.tokenExpiresAt) < new Date();

          return (
            <div
              key={provider.key}
              className="flex items-center justify-between rounded-xl border border-border bg-card px-5 py-4"
            >
              <div className="space-y-0.5">
                <h3 className="font-medium">{provider.label}</h3>
                <p className="text-xs text-muted-foreground">
                  {provider.description}
                </p>
                {connection && (
                  <p className="text-xs text-muted-foreground">
                    Account: {connection.providerAccountId}
                    {isExpired && (
                      <span className="ml-2 text-yellow-400">
                        (token expired)
                      </span>
                    )}
                  </p>
                )}
              </div>

              <div className="flex items-center gap-2">
                {connection ? (
                  <>
                    <span className="rounded-full bg-green-500/10 px-2.5 py-1 text-xs font-medium text-green-400">
                      Connected
                    </span>
                    {provider.canDisconnect && (
                      <button
                        onClick={() => handleDisconnect(provider.key)}
                        disabled={disconnecting === provider.key}
                        className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-destructive hover:text-destructive disabled:opacity-50"
                      >
                        {disconnecting === provider.key
                          ? "Disconnecting..."
                          : "Disconnect"}
                      </button>
                    )}
                    {isExpired && provider.connectUrl && (
                      <a
                        href={provider.connectUrl}
                        className="rounded-lg bg-yellow-500/20 px-3 py-1.5 text-xs font-medium text-yellow-400 transition-colors hover:bg-yellow-500/30"
                      >
                        Reconnect
                      </a>
                    )}
                  </>
                ) : provider.connectUrl ? (
                  <a
                    href={provider.connectUrl}
                    className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                  >
                    Connect
                  </a>
                ) : (
                  <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                    Via sign-in
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        GitHub is connected automatically via sign-in. Vercel and Supabase
        require separate authorization. All tokens are stored encrypted.
      </p>
    </section>
  );
}

export function ConnectedAccounts({
  connections,
}: {
  connections: ConnectionMap;
}) {
  return (
    <Suspense>
      <ConnectedAccountsInner connections={connections} />
    </Suspense>
  );
}
