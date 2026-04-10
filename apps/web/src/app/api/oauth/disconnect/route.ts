import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import type { OAuthProvider } from "@prisma/client";

const VALID_PROVIDERS: OAuthProvider[] = ["GITHUB", "VERCEL", "SUPABASE"];

/**
 * POST /api/oauth/disconnect — Disconnects an OAuth provider.
 * Removes the OAuthConnection record for the given provider.
 * GitHub cannot be disconnected (it's the sign-in provider).
 */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const provider = body.provider as OAuthProvider;

  if (!VALID_PROVIDERS.includes(provider)) {
    return NextResponse.json({ error: "Invalid provider" }, { status: 400 });
  }

  if (provider === "GITHUB") {
    return NextResponse.json(
      {
        error:
          "GitHub cannot be disconnected because it is your sign-in provider.",
      },
      { status: 400 }
    );
  }

  // Check if user has active projects that depend on this provider
  if (provider === "VERCEL" || provider === "SUPABASE") {
    const activeProjects = await prisma.project.count({
      where: {
        userId: session.user.id,
        status: { in: ["CREATING", "ACTIVE"] },
      },
    });

    if (activeProjects > 0) {
      return NextResponse.json(
        {
          error: `Cannot disconnect ${provider.toLowerCase()} while you have active projects. Delete your projects first.`,
        },
        { status: 400 }
      );
    }
  }

  await prisma.oAuthConnection.deleteMany({
    where: {
      userId: session.user.id,
      provider,
    },
  });

  return NextResponse.json({ success: true });
}
