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
  await probe("teams (/v2/teams)", "https://api.vercel.com/v2/teams");
  await probe(
    "git-namespaces no-team",
    "https://api.vercel.com/v1/integrations/git-namespaces?provider=github"
  );
  await probe(
    "git-namespaces with-team",
    "https://api.vercel.com/v1/integrations/git-namespaces?provider=github",
    { withTeamId: true }
  );
  await probe(
    "configurations",
    "https://api.vercel.com/v1/integrations/configurations",
    { withTeamId: true }
  );

  return NextResponse.json(results, { status: 200 });
}
