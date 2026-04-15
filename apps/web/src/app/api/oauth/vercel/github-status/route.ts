import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getProviderToken, TokenError } from "@/lib/tokens";
import { VercelClient } from "@/lib/integrations";

/**
 * GET /api/oauth/vercel/github-status
 * Checks whether the user's Vercel account has the GitHub integration installed.
 * Used by the frontend to poll for completion after the user installs the Vercel GitHub App.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { accessToken, providerAccountId } = await getProviderToken(session.user.id, "VERCEL");
    const vercel = new VercelClient(accessToken, providerAccountId);
    const connected = await vercel.hasGitHubIntegration();
    return NextResponse.json({ connected });
  } catch (err) {
    if (err instanceof TokenError) {
      return NextResponse.json({ connected: false, error: err.message });
    }
    return NextResponse.json({ connected: false });
  }
}
