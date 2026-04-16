import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { encrypt } from "@/lib/encryption";
import {
  validateOAuthState,
  exchangeCodeForTokens,
  getCallbackUrl,
} from "@/lib/oauth";
import { VercelClient } from "@/lib/integrations";

/**
 * GET /api/oauth/vercel/callback
 *
 * Handles two distinct flows that both terminate here because Vercel only
 * lets us register one redirect URL per integration:
 *
 *  1. User-initiated connect from Settings. We generated the `state`
 *     cookie via /api/oauth/vercel, Vercel echoes it back, we validate,
 *     exchange code, store tokens, redirect to /settings.
 *
 *  2. Vercel-initiated integration install — triggered when a user clicks
 *     "Add" on the LaunchPad integration card inside vercel.com/new/clone.
 *     Vercel sends `configurationId` + `next` and does NOT echo a state
 *     we generated. Skip state validation, exchange code the same way,
 *     store tokens, and redirect to Vercel's `next` URL so the user
 *     returns to the clone flow to finish.
 *
 * We distinguish the two by the presence of `configurationId`.
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
  const configurationId = searchParams.get("configurationId");
  const next = searchParams.get("next");

  const isIntegrationInstall = !!configurationId;

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

  // Only validate CSRF state for user-initiated flows; Vercel's integration
  // install doesn't round-trip a cookie-state.
  if (!isIntegrationInstall) {
    const isValid = await validateOAuthState(state, "vercel");
    if (!isValid) {
      return NextResponse.redirect(
        new URL("/settings?error=Invalid+state+parameter", request.url)
      );
    }
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

    // Integration install: return the user to Vercel's `next` URL so they
    // can finish the clone flow. Only honor Vercel-hosted URLs to avoid
    // being an open redirect.
    if (isIntegrationInstall && next && isVercelUrl(next)) {
      return NextResponse.redirect(next);
    }

    // User-initiated connect: land back on Settings.
    let redirectParams = "connected=vercel";
    try {
      const vercel = new VercelClient(tokens.access_token, tokens.team_id);
      const hasGitHub = await vercel.hasGitHubIntegration();
      if (hasGitHub === false) {
        redirectParams = "connected=vercel&vercel_github=missing";
      }
    } catch {
      // Non-fatal — the settings page will show the status separately
    }

    return NextResponse.redirect(
      new URL(`/settings?${redirectParams}`, request.url)
    );
  } catch (err) {
    console.error("Vercel OAuth callback error:", err);
    return NextResponse.redirect(
      new URL("/settings?error=Failed+to+connect+Vercel", request.url)
    );
  }
}

function isVercelUrl(candidate: string): boolean {
  try {
    const url = new URL(candidate);
    return url.hostname === "vercel.com" || url.hostname.endsWith(".vercel.com");
  } catch {
    return false;
  }
}
