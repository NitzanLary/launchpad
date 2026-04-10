import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { encrypt } from "@/lib/encryption";
import {
  validateOAuthState,
  exchangeCodeForTokens,
  getCallbackUrl,
} from "@/lib/oauth";

/**
 * GET /api/oauth/supabase/callback — Handles the Supabase OAuth callback.
 * Validates state, exchanges code for tokens, encrypts and stores them.
 * After storing tokens, validates the user's Supabase account (0 existing projects required).
 */
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  if (error) {
    const message = searchParams.get("error_description") || error;
    return NextResponse.redirect(
      new URL(`/settings?error=${encodeURIComponent(message)}`, request.url)
    );
  }

  if (!code) {
    return NextResponse.redirect(
      new URL("/settings?error=Missing+authorization+code", request.url)
    );
  }

  const isValid = await validateOAuthState(state, "supabase");
  if (!isValid) {
    return NextResponse.redirect(
      new URL("/settings?error=Invalid+state+parameter", request.url)
    );
  }

  try {
    const redirectUri = getCallbackUrl("supabase", request.url);
    const tokens = await exchangeCodeForTokens("supabase", code, redirectUri);

    const accessTokenEnc = encrypt(tokens.access_token);
    const refreshTokenEnc = tokens.refresh_token
      ? encrypt(tokens.refresh_token)
      : null;
    const tokenExpiresAt = tokens.expires_in
      ? new Date(Date.now() + tokens.expires_in * 1000)
      : null;

    const providerAccountId = tokens.user_id || "supabase-user";

    await prisma.oAuthConnection.upsert({
      where: {
        userId_provider: {
          userId: session.user.id,
          provider: "SUPABASE",
        },
      },
      update: {
        accessTokenEnc,
        refreshTokenEnc,
        tokenExpiresAt,
        providerAccountId,
        scopes: ["all"],
      },
      create: {
        userId: session.user.id,
        provider: "SUPABASE",
        providerAccountId,
        accessTokenEnc,
        refreshTokenEnc,
        tokenExpiresAt,
        scopes: ["all"],
      },
    });

    // Validate Supabase account: check for existing projects
    const { SupabaseClient } = await import("@/lib/integrations/supabase");
    const client = new SupabaseClient(tokens.access_token);
    const projects = await client.listProjects();

    if (projects.length > 0) {
      // Store connection but warn the user — they need 0 existing projects
      return NextResponse.redirect(
        new URL(
          "/settings?connected=supabase&warning=supabase_slots_full",
          request.url
        )
      );
    }

    return NextResponse.redirect(
      new URL("/settings?connected=supabase", request.url)
    );
  } catch (err) {
    console.error("Supabase OAuth callback error:", err);
    return NextResponse.redirect(
      new URL("/settings?error=Failed+to+connect+Supabase", request.url)
    );
  }
}
