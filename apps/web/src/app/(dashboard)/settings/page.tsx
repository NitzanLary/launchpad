import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/encryption";
import { VercelClient } from "@/lib/integrations";
import { ConnectedAccounts } from "./connected-accounts";

export default async function SettingsPage() {
  const session = await auth();
  const connections = await prisma.oAuthConnection.findMany({
    where: { userId: session!.user!.id! },
    select: {
      provider: true,
      providerAccountId: true,
      accessTokenEnc: true,
      tokenExpiresAt: true,
      updatedAt: true,
    },
  });

  const connectionMap = Object.fromEntries(
    connections.map((c) => [
      c.provider,
      {
        providerAccountId: c.providerAccountId,
        tokenExpiresAt: c.tokenExpiresAt?.toISOString() ?? null,
        updatedAt: c.updatedAt.toISOString(),
      },
    ])
  );

  // Check if Vercel has GitHub integration connected
  let vercelGitHubConnected: boolean | null = null;
  const vercelConn = connections.find((c) => c.provider === "VERCEL");
  if (vercelConn) {
    try {
      const token = decrypt(new Uint8Array(vercelConn.accessTokenEnc));
      const vercel = new VercelClient(token, vercelConn.providerAccountId);
      vercelGitHubConnected = await vercel.hasGitHubIntegration();
    } catch {
      // Token invalid or API error — leave as null (unknown)
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <h1 className="text-2xl font-bold">Settings</h1>

      <ConnectedAccounts
        connections={connectionMap}
        vercelGitHubConnected={vercelGitHubConnected}
      />

      {/* Danger Zone */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-destructive">Danger Zone</h2>
        <div className="rounded-xl border border-destructive/30 bg-card p-5">
          <p className="text-sm text-muted-foreground">
            Deleting your account will remove all projects, disconnect all
            services, and delete all deploy history. This action cannot be
            undone.
          </p>
          <button
            disabled
            className="mt-4 rounded-lg border border-destructive px-3 py-1.5 text-xs font-medium text-destructive opacity-50"
          >
            Delete Account (coming soon)
          </button>
        </div>
      </section>
    </div>
  );
}
