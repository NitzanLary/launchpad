import { randomBytes, createHash } from "crypto";
import { cookies } from "next/headers";

const STATE_COOKIE = "oauth_state";
const STATE_MAX_AGE = 600; // 10 minutes

/**
 * Generate a cryptographically random state parameter for OAuth CSRF protection.
 * Stores the state in an HTTP-only cookie and returns the value to include in the auth URL.
 */
export async function generateOAuthState(provider: string): Promise<string> {
  const raw = randomBytes(32).toString("hex");
  // Include provider in state to prevent cross-provider confusion
  const state = `${provider}:${raw}`;

  const cookieStore = await cookies();
  cookieStore.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: STATE_MAX_AGE,
    path: "/",
  });

  return state;
}

/**
 * Validate the OAuth state parameter against the stored cookie.
 * Returns true if valid, false otherwise. Always clears the cookie.
 */
export async function validateOAuthState(
  state: string | null,
  expectedProvider: string
): Promise<boolean> {
  const cookieStore = await cookies();
  const stored = cookieStore.get(STATE_COOKIE)?.value;
  cookieStore.delete(STATE_COOKIE);

  if (!state || !stored) return false;
  if (state !== stored) return false;

  // Verify the state was generated for this provider
  const [provider] = state.split(":");
  return provider === expectedProvider;
}

/**
 * OAuth provider configuration.
 */
export const OAUTH_CONFIG = {
  vercel: {
    authorizationUrl: () =>
      `https://vercel.com/integrations/${process.env.INTEGRATION_VERCEL_SLUG!.trim()}/new`,
    tokenUrl: "https://api.vercel.com/v2/oauth/access_token",
    clientId: () => process.env.INTEGRATION_VERCEL_CLIENT_ID!.trim(),
    clientSecret: () => process.env.INTEGRATION_VERCEL_CLIENT_SECRET!.trim(),
    // Vercel doesn't use traditional scopes — permissions are set during integration setup
    scopes: [],
  },
  supabase: {
    authorizationUrl: () => "https://api.supabase.com/v1/oauth/authorize",
    tokenUrl: "https://api.supabase.com/v1/oauth/token",
    clientId: () => process.env.SUPABASE_CLIENT_ID!.trim(),
    clientSecret: () => process.env.SUPABASE_CLIENT_SECRET!.trim(),
    scopes: ["all"],
    // Supabase requires Basic auth for the token endpoint
    tokenAuthMethod: "basic" as const,
  },
} as const;

export type OAuthProviderKey = keyof typeof OAUTH_CONFIG;

/**
 * Build the authorization URL for a given provider.
 */
export function buildAuthorizationUrl(
  provider: OAuthProviderKey,
  state: string,
  redirectUri: string
): string {
  const config = OAUTH_CONFIG[provider];
  const params = new URLSearchParams({
    client_id: config.clientId(),
    redirect_uri: redirectUri,
    response_type: "code",
    state,
  });

  if (config.scopes.length > 0) {
    params.set("scope", config.scopes.join(" "));
  }

  return `${config.authorizationUrl()}?${params.toString()}`;
}

/**
 * Exchange an authorization code for tokens.
 */
export async function exchangeCodeForTokens(
  provider: OAuthProviderKey,
  code: string,
  redirectUri: string
): Promise<{
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type: string;
  team_id?: string;
  user_id?: string;
}> {
  const config = OAUTH_CONFIG[provider];
  const useBasicAuth = "tokenAuthMethod" in config && config.tokenAuthMethod === "basic";

  const bodyParams: Record<string, string> = {
    code,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  };

  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
  };

  if (useBasicAuth) {
    headers["Authorization"] =
      "Basic " + btoa(`${config.clientId()}:${config.clientSecret()}`);
  } else {
    bodyParams.client_id = config.clientId();
    bodyParams.client_secret = config.clientSecret();
  }

  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers,
    body: new URLSearchParams(bodyParams).toString(),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(
      `OAuth token exchange failed for ${provider}: ${response.status} ${error}`
    );
  }

  return response.json();
}

/**
 * Refresh an access token using a refresh token.
 */
export async function refreshAccessToken(
  provider: OAuthProviderKey,
  refreshToken: string
): Promise<{
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}> {
  const config = OAUTH_CONFIG[provider];
  const useBasicAuth = "tokenAuthMethod" in config && config.tokenAuthMethod === "basic";

  const bodyParams: Record<string, string> = {
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  };

  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
  };

  if (useBasicAuth) {
    headers["Authorization"] =
      "Basic " + btoa(`${config.clientId()}:${config.clientSecret()}`);
  } else {
    bodyParams.client_id = config.clientId();
    bodyParams.client_secret = config.clientSecret();
  }

  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers,
    body: new URLSearchParams(bodyParams).toString(),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(
      `Token refresh failed for ${provider}: ${response.status} ${error}`
    );
  }

  return response.json();
}

/**
 * Build the callback URL for a provider based on the current request.
 */
export function getCallbackUrl(
  provider: OAuthProviderKey,
  requestUrl: string
): string {
  const url = new URL(requestUrl);
  return `${url.origin}/api/oauth/${provider}/callback`;
}
