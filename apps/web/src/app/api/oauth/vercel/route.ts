import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  generateOAuthState,
  buildAuthorizationUrl,
  getCallbackUrl,
} from "@/lib/oauth";

/**
 * GET /api/oauth/vercel — Initiates the Vercel OAuth flow.
 * Generates a CSRF state, stores it in a cookie, and redirects to Vercel's authorization page.
 */
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (
    !process.env.INTEGRATION_VERCEL_CLIENT_ID ||
    !process.env.INTEGRATION_VERCEL_CLIENT_SECRET ||
    !process.env.INTEGRATION_VERCEL_SLUG
  ) {
    return NextResponse.redirect(
      new URL(
        "/settings?error=" +
          encodeURIComponent(
            "Vercel Integration OAuth is not configured. INTEGRATION_VERCEL_CLIENT_ID, INTEGRATION_VERCEL_CLIENT_SECRET, and INTEGRATION_VERCEL_SLUG must be set."
          ),
        request.url
      )
    );
  }

  try {
    const state = await generateOAuthState("vercel");
    const redirectUri = getCallbackUrl("vercel", request.url);
    const authUrl = buildAuthorizationUrl("vercel", state, redirectUri);

    return NextResponse.redirect(authUrl);
  } catch (err) {
    console.error("Vercel OAuth initiation error:", err);
    return NextResponse.redirect(
      new URL(
        "/settings?error=" +
          encodeURIComponent("Failed to start Vercel OAuth flow"),
        request.url
      )
    );
  }
}
