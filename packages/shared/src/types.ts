// OAuth providers supported by LaunchPad
export type OAuthProvider = "GITHUB" | "VERCEL" | "SUPABASE";

// Project lifecycle states
export type ProjectStatus =
  | "CREATING"
  | "ACTIVE"
  | "ERROR"
  | "DELETING"
  | "DELETED";

// Environment types
export type EnvironmentType = "STAGING" | "PRODUCTION";

// Preview schema lifecycle
export type PreviewStatus =
  | "CREATING"
  | "ACTIVE"
  | "STALE"
  | "CLEANING_UP"
  | "DELETED";

// Deploy types
export type DeployType = "PREVIEW" | "STAGING" | "PRODUCTION" | "ROLLBACK";

// Deploy pipeline states
export type DeployStatus =
  | "PENDING"
  | "VALIDATING"
  | "MIGRATING"
  | "DEPLOYING"
  | "VERIFYING"
  | "SUCCESS"
  | "FAILED"
  | "BLOCKED"
  | "CANCELLED";

// Guard results
export type GuardStatus = "PASS" | "WARN" | "BLOCK";

export interface GuardResult {
  guard: string;
  status: GuardStatus;
  message: string;
  details?: unknown;
}

// Guard context — abstraction for reading files from filesystem or GitHub API
export interface GuardFileSystem {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  list(dir: string): Promise<string[]>;
}

export interface GuardContext {
  files: GuardFileSystem;
  config: LaunchpadConfig;
  environment?: {
    type: "preview" | "staging" | "production";
    dbConnectionString: string;
  };
}

// .launchpad/config.json shape
export interface LaunchpadConfig {
  version: string;
  project_id: string;
  template: string;
  template_version: string;
  created_at: string;
  environments: {
    preview: {
      db_provider: string;
      db_project_id: string;
      db_strategy: string;
    };
    staging: {
      db_provider: string;
      db_project_id: string;
      db_schema: string;
    };
    production: {
      db_provider: string;
      db_project_id: string;
      db_schema: string;
    };
  };
  extensions: string[];
  managed_files: string[];
  claude_md_platform_hash: string;
}

// Migration log status
export type MigrationStatus = "APPLIED" | "FAILED" | "SKIPPED";

// Extension names (MVP)
export type ExtensionName = "stripe" | "resend" | "upstash";

export type ExtensionStatus = "ACTIVE" | "DISABLED";
