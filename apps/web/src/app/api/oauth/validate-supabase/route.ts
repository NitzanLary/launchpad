import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getProviderToken, TokenError } from "@/lib/tokens";
import { SupabaseClient } from "@/lib/integrations/supabase";

/**
 * GET /api/oauth/validate-supabase — Checks if the user's Supabase account
 * has 0 existing projects (required for free-tier LaunchPad project creation).
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { accessToken } = await getProviderToken(
      session.user.id,
      "SUPABASE"
    );
    const client = new SupabaseClient(accessToken);
    const activeCount = await client.countActiveProjects();

    return NextResponse.json({
      valid: activeCount === 0,
      activeProjectCount: activeCount,
      message:
        activeCount === 0
          ? "Your Supabase account is ready for LaunchPad."
          : "Your Supabase account already has projects. LaunchPad needs 2 free project slots (for staging and production). Please delete existing projects or upgrade your Supabase plan, then try again.",
    });
  } catch (err) {
    if (err instanceof TokenError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: 400 }
      );
    }
    console.error("Supabase validation error:", err);
    return NextResponse.json(
      { error: "Failed to validate Supabase account" },
      { status: 500 }
    );
  }
}
