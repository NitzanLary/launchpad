import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getProviderToken } from "@/lib/tokens";

/**
 * Diagnostic endpoint for the current user's Vercel token.
 * Hits a few Vercel endpoints and reports which succeed, so we can tell
 * whether the token carries a user principal and sees a linked GitHub App.
 *
 * Visit `/api/debug/vercel` while logged in. Remove this route once the
 * Vercel integration is verified working.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const connection = await prisma.oAuthConnection.findUnique({
    where: {
      userId_provider: { userId: session.user.id, provider: "VERCEL" },
    },
    select: {
      providerAccountId: true,
      scopes: true,
      tokenExpiresAt: true,
      updatedAt: true,
      createdAt: true,
    },
  });

  if (!connection) {
    return NextResponse.json({ error: "No Vercel connection" }, { status: 404 });
  }

  const { accessToken, providerAccountId } = await getProviderToken(
    session.user.id,
    "VERCEL"
  );

  const results: Record<string, unknown> = {
    dbRow: connection,
    providerAccountId,
    probes: {},
  };

  async function probe(
    label: string,
    url: string,
    opts: { withTeamId?: boolean } = {}
  ) {
    const u = new URL(url);
    if (opts.withTeamId && providerAccountId) {
      u.searchParams.set("teamId", providerAccountId);
    }
    try {
      const r = await fetch(u.toString(), {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const body = await r.text();
      let parsed: unknown = body;
      try {
        parsed = JSON.parse(body);
      } catch {
        /* body not JSON */
      }
      (results.probes as Record<string, unknown>)[label] = {
        status: r.status,
        ok: r.ok,
        body: parsed,
      };
    } catch (err) {
      (results.probes as Record<string, unknown>)[label] = {
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  await probe("user (/v2/user)", "https://api.vercel.com/v2/user");
  await probe(
    "search-repo via importFlowGitNamespaceId",
    "https://api.vercel.com/v1/integrations/search-repo?provider=github&namespaceId=118300449"
  );

  // Dry-run project creation with several gitRepository shapes — whichever
  // returns 200 is the shape we should use in project-create. Use a unique
  // throwaway name; delete the project afterward if it succeeds.
  const throwawayName = `debug-probe-${Date.now()}`;
  const repoFullName = "NitzanLary/test-project9"; // an existing repo we know about from prior failures

  async function tryCreate(
    label: string,
    body: Record<string, unknown>
  ) {
    const u = new URL("https://api.vercel.com/v10/projects");
    if (providerAccountId) u.searchParams.set("teamId", providerAccountId);
    try {
      const r = await fetch(u.toString(), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const text = await r.text();
      let parsed: unknown = text;
      try {
        parsed = JSON.parse(text);
      } catch {
        /* body not JSON */
      }

      // Clean up successful projects so we don't leak garbage.
      if (r.ok && parsed && typeof parsed === "object" && "id" in parsed) {
        const cleanupUrl = new URL(
          `https://api.vercel.com/v9/projects/${(parsed as { id: string }).id}`
        );
        if (providerAccountId)
          cleanupUrl.searchParams.set("teamId", providerAccountId);
        await fetch(cleanupUrl.toString(), {
          method: "DELETE",
          headers: { Authorization: `Bearer ${accessToken}` },
        }).catch(() => {});
      }

      (results.probes as Record<string, unknown>)[label] = {
        status: r.status,
        ok: r.ok,
        body: parsed,
      };
    } catch (err) {
      (results.probes as Record<string, unknown>)[label] = {
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  await tryCreate("create: repo only", {
    name: `${throwawayName}-a`,
    framework: "nextjs",
    gitRepository: { type: "github", repo: repoFullName },
  });
  await tryCreate("create: repo + sourceless", {
    name: `${throwawayName}-b`,
    framework: "nextjs",
    gitRepository: { type: "github", repo: repoFullName, sourceless: true },
  });
  await tryCreate("create: repo + gitNamespaceId", {
    name: `${throwawayName}-c`,
    framework: "nextjs",
    gitRepository: {
      type: "github",
      repo: repoFullName,
      gitNamespaceId: 118300449,
    },
  });
  await tryCreate("create: bare (no gitRepository)", {
    name: `${throwawayName}-d`,
    framework: "nextjs",
  });

  return NextResponse.json(results, { status: 200 });
}
