import type { TemplateData } from "../types";

export function renderConfigJson(
  data: TemplateData,
  claudeMdPlatformHash: string
): string {
  const config = {
    version: data.launchpadVersion,
    project_id: data.projectId,
    template: "nextjs-supabase-prisma",
    template_version: data.templateVersion,
    created_at: data.createdAt,
    environments: {
      preview: {
        db_provider: "supabase",
        db_project_id: data.supabaseStagingProjectId,
        db_strategy: "isolated_schema",
      },
      staging: {
        db_provider: "supabase",
        db_project_id: data.supabaseStagingProjectId,
        db_schema: "public",
      },
      production: {
        db_provider: "supabase",
        db_project_id: data.supabaseProdProjectId,
        db_schema: "public",
      },
    },
    extensions: [],
    managed_files: ["CLAUDE.md", ".launchpad/config.json", "vercel.json"],
    claude_md_platform_hash: claudeMdPlatformHash,
  };

  return JSON.stringify(config, null, 2) + "\n";
}
