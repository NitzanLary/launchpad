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

  if (!process.env.SUPABASE_CLIENT_ID || !process.env.SUPABASE_CLIENT_SECRET) {
    return NextResponse.redirect(
      new URL(
        "/settings?error=" +
          encodeURIComponent(
            "Supabase OAuth is not configured. SUPABASE_CLIENT_ID and SUPABASE_CLIENT_SECRET must be set."
          ),
        request.url
      )
    );
  }

  try {
    const state = await generateOAuthState("supabase");
    const redirectUri = getCallbackUrl("supabase", request.url);
    const authUrl = buildAuthorizationUrl("supabase", state, redirectUri);

    return NextResponse.redirect(authUrl);
  } catch (err) {
    console.error("Supabase OAuth initiation error:", err);
    return NextResponse.redirect(
      new URL(
        "/settings?error=" +
          encodeURIComponent("Failed to start Supabase OAuth flow"),
        request.url
      )
    );
  }
}
