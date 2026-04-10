import { prisma } from "./db";
import { encrypt, decrypt } from "./encryption";
import { refreshAccessToken, type OAuthProviderKey } from "./oauth";
import type { OAuthProvider } from "@prisma/client";

const PROVIDER_TO_KEY: Record<OAuthProvider, OAuthProviderKey | null> = {
  GITHUB: null, // GitHub tokens from Auth.js don't expire (classic OAuth tokens)
  VERCEL: "vercel",
  SUPABASE: "supabase",
};

// Buffer before actual expiry to trigger refresh (5 minutes)
const EXPIRY_BUFFER_MS = 5 * 60 * 1000;

export interface ResolvedToken {
  accessToken: string;
  providerAccountId: string;
}

/**
 * Load and decrypt the access token for a provider.
 * If the token is expired and a refresh token is available, automatically refreshes it.
 * Throws if no connection exists or the refresh fails.
 */
export async function getProviderToken(
  userId: string,
  provider: OAuthProvider
): Promise<ResolvedToken> {
  const connection = await prisma.oAuthConnection.findUnique({
    where: {
      userId_provider: { userId, provider },
    },
  });

  if (!connection) {
    throw new TokenError(
      `No ${provider} connection found. Please connect your ${provider.toLowerCase()} account in Settings.`,
      "NOT_CONNECTED"
    );
  }

  const accessToken = decrypt(new Uint8Array(connection.accessTokenEnc));

  // Check if token is expired or about to expire
  if (connection.tokenExpiresAt) {
    const isExpiring =
      connection.tokenExpiresAt.getTime() - Date.now() < EXPIRY_BUFFER_MS;

    if (isExpiring) {
      const providerKey = PROVIDER_TO_KEY[provider];
      if (!providerKey || !connection.refreshTokenEnc) {
        throw new TokenError(
          `Your ${provider.toLowerCase()} connection has expired. Please reconnect in Settings.`,
          "TOKEN_EXPIRED"
        );
      }

      const refreshToken = decrypt(new Uint8Array(connection.refreshTokenEnc));
      return await refreshAndStore(userId, provider, providerKey, refreshToken);
    }
  }

  return {
    accessToken,
    providerAccountId: connection.providerAccountId,
  };
}

/**
 * Refresh the token, re-encrypt, and store the new values.
 */
async function refreshAndStore(
  userId: string,
  provider: OAuthProvider,
  providerKey: OAuthProviderKey,
  refreshToken: string
): Promise<ResolvedToken> {
  try {
    const tokens = await refreshAccessToken(providerKey, refreshToken);

    const accessTokenEnc = encrypt(tokens.access_token);
    const refreshTokenEnc = tokens.refresh_token
      ? encrypt(tokens.refresh_token)
      : encrypt(refreshToken); // Keep old refresh token if new one not provided
    const tokenExpiresAt = tokens.expires_in
      ? new Date(Date.now() + tokens.expires_in * 1000)
      : null;

    const updated = await prisma.oAuthConnection.update({
      where: { userId_provider: { userId, provider } },
      data: {
        accessTokenEnc,
        refreshTokenEnc,
        tokenExpiresAt,
      },
    });

    return {
      accessToken: tokens.access_token,
      providerAccountId: updated.providerAccountId,
    };
  } catch (err) {
    throw new TokenError(
      `Failed to refresh ${provider.toLowerCase()} token. Please reconnect in Settings.`,
      "REFRESH_FAILED"
    );
  }
}

/**
 * Check if a user has a valid connection for a given provider.
 */
export async function hasConnection(
  userId: string,
  provider: OAuthProvider
): Promise<boolean> {
  const connection = await prisma.oAuthConnection.findUnique({
    where: { userId_provider: { userId, provider } },
    select: { id: true },
  });
  return !!connection;
}

export class TokenError extends Error {
  constructor(
    message: string,
    public code: "NOT_CONNECTED" | "TOKEN_EXPIRED" | "REFRESH_FAILED"
  ) {
    super(message);
    this.name = "TokenError";
  }
}
