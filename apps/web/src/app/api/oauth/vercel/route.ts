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

  const state = await generateOAuthState("vercel");
  const redirectUri = getCallbackUrl("vercel", request.url);
  const authUrl = buildAuthorizationUrl("vercel", state, redirectUri);

  return NextResponse.redirect(authUrl);
}
