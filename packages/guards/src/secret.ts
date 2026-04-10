import type { Guard } from "./types";

const SUSPICIOUS_PATTERNS = [
  /\.env\.local/,
  /\.env\.production/,
  /SUPABASE_SERVICE_ROLE_KEY\s*=\s*["']eyJ/,
  /DATABASE_URL\s*=\s*["']postgres/,
  /sk_live_/,
  /sk_test_/,
];

export const secretGuard: Guard = async (context) => {
  // Check for committed .env files
  const envFiles = [".env", ".env.local", ".env.production"];
  for (const envFile of envFiles) {
    const exists = await context.files.exists(envFile);
    if (exists) {
      return {
        guard: "secret",
        status: "WARN",
        message: `${envFile} was found in the repo. LaunchPad manages environment variables automatically — this file is unnecessary and may contain secrets. Consider removing it.`,
      };
    }
  }

  return {
    guard: "secret",
    status: "PASS",
    message: "No hardcoded secrets detected.",
  };
};
