// Template
export const TEMPLATE_NAME = "nextjs-supabase-prisma";
export const TEMPLATE_VERSION = "1.0.0";
export const LAUNCHPAD_VERSION = "0.1";

// Limits
export const MAX_PREVIEW_SCHEMAS = 5;
export const STALE_PREVIEW_HOURS = 48;
export const ROLLBACK_WINDOW_HOURS = 24;
export const VERCEL_DEPLOY_DAILY_LIMIT = 100;
export const VERCEL_DEPLOY_WARNING_THRESHOLD = 80;

// Managed files in the user's project
export const MANAGED_FILES = [
  "CLAUDE.md",
  ".launchpad/config.json",
  "vercel.json",
] as const;

// CLAUDE.md delimiter between platform and user zones
export const CLAUDE_MD_DELIMITER =
  "<!-- LAUNCHPAD:USER_SECTION_BELOW — Everything below this line is yours. -->";

// Preview schema naming
export const PREVIEW_SCHEMA_PREFIX = "preview_";

// Supabase connection string format
export const SUPABASE_POOLER_PORT = 6543;

// MVP extensions and their required env vars
export const EXTENSIONS = {
  stripe: {
    name: "Stripe",
    envVars: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"],
    npmPackage: "stripe",
  },
  resend: {
    name: "Resend",
    envVars: ["RESEND_API_KEY"],
    npmPackage: "resend",
  },
  upstash: {
    name: "Upstash Redis",
    envVars: ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"],
    npmPackage: "@upstash/redis",
  },
} as const;
