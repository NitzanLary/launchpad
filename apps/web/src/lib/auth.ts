import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "./db";
import { encrypt } from "./encryption";

export const { handlers, signIn, signOut, auth } = NextAuth({
  adapter: PrismaAdapter(prisma),
  providers: [
    GitHub({
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
      authorization: {
        params: {
          scope: "read:user user:email repo",
        },
      },
    }),
  ],
  pages: {
    signIn: "/login",
  },
  callbacks: {
    async signIn({ user, account }) {
      // Capture GitHub access token and store in OAuthConnection for API use
      if (account?.provider === "github" && account.access_token && user.id) {
        const accessTokenEnc = encrypt(account.access_token);
        const refreshTokenEnc = account.refresh_token
          ? encrypt(account.refresh_token)
          : null;

        await prisma.oAuthConnection.upsert({
          where: {
            userId_provider: {
              userId: user.id,
              provider: "GITHUB",
            },
          },
          update: {
            accessTokenEnc,
            refreshTokenEnc,
            tokenExpiresAt: account.expires_at
              ? new Date(account.expires_at * 1000)
              : null,
            scopes: account.scope?.split(",").map((s) => s.trim()) ?? [],
            providerAccountId: account.providerAccountId,
          },
          create: {
            userId: user.id,
            provider: "GITHUB",
            providerAccountId: account.providerAccountId,
            accessTokenEnc,
            refreshTokenEnc,
            tokenExpiresAt: account.expires_at
              ? new Date(account.expires_at * 1000)
              : null,
            scopes: account.scope?.split(",").map((s) => s.trim()) ?? [],
          },
        });
      }
      return true;
    },
    session({ session, user }) {
      if (session.user) {
        session.user.id = user.id;
      }
      return session;
    },
  },
});
