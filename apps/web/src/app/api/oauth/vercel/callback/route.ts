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
 * GET /api/oauth/vercel/callback — Handles the Vercel OAuth callback.
 * Validates state, exchanges code for tokens, encrypts and stores them.
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

  const isValid = await validateOAuthState(state, "vercel");
  if (!isValid) {
    return NextResponse.redirect(
      new URL("/settings?error=Invalid+state+parameter", request.url)
    );
  }

  try {
    const redirectUri = getCallbackUrl("vercel", request.url);
    const tokens = await exchangeCodeForTokens("vercel", code, redirectUri);

    const accessTokenEnc = encrypt(tokens.access_token);
    const refreshTokenEnc = tokens.refresh_token
      ? encrypt(tokens.refresh_token)
      : null;
    const tokenExpiresAt = tokens.expires_in
      ? new Date(Date.now() + tokens.expires_in * 1000)
      : null;

    // Vercel returns team_id or user_id as the account identifier
    const providerAccountId =
      tokens.team_id || tokens.user_id || "vercel-user";

    await prisma.oAuthConnection.upsert({
      where: {
        userId_provider: {
          userId: session.user.id,
          provider: "VERCEL",
        },
      },
      update: {
        accessTokenEnc,
        refreshTokenEnc,
        tokenExpiresAt,
        providerAccountId,
      },
      create: {
        userId: session.user.id,
        provider: "VERCEL",
        providerAccountId,
        accessTokenEnc,
        refreshTokenEnc,
        tokenExpiresAt,
        scopes: [],
      },
    });

    return NextResponse.redirect(
      new URL("/settings?connected=vercel", request.url)
    );
  } catch (err) {
    console.error("Vercel OAuth callback error:", err);
    return NextResponse.redirect(
      new URL("/settings?error=Failed+to+connect+Vercel", request.url)
    );
  }
}
