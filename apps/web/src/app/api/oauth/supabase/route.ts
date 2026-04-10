import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  generateOAuthState,
  buildAuthorizationUrl,
  getCallbackUrl,
} from "@/lib/oauth";

/**
 * GET /api/oauth/supabase — Initiates the Supabase OAuth flow.
 * Generates a CSRF state, stores it in a cookie, and redirects to Supabase's authorization page.
 */
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const state = await generateOAuthState("supabase");
  const redirectUri = getCallbackUrl("supabase", request.url);
  const authUrl = buildAuthorizationUrl("supabase", state, redirectUri);

  return NextResponse.redirect(authUrl);
}
