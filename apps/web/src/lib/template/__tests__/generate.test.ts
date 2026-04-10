import { describe, it, expect } from "vitest";
import { generateTemplateFiles } from "../index";
import { CLAUDE_MD_DELIMITER } from "@launchpad/shared";
import type { TemplateData } from "../types";

const mockData: TemplateData = {
  projectName: "My Cool App",
  projectSlug: "my-cool-app",
  projectId: "lp_test123",
  templateVersion: "1.0.0",
  launchpadVersion: "0.1",
  createdAt: "2026-04-08T12:00:00Z",
  supabaseStagingProjectId: "staging-ref-abc",
  supabaseProdProjectId: "prod-ref-xyz",
  githubOwner: "testuser",
};

describe("Template Generator", () => {
  it("generates all required files", () => {
    const { files } = generateTemplateFiles(mockData);

    const expectedPaths = [
      "CLAUDE.md",
      ".launchpad/config.json",
      "package.json",
      "README.md",
      "prisma/schema.prisma",
      "supabase/seed.sql",
      "src/lib/prisma.ts",
      "src/lib/supabase.ts",
      "src/lib/supabase-server.ts",
      "src/app/layout.tsx",
      "src/app/globals.css",
      "src/app/page.tsx",
      "src/app/api/.gitkeep",
      "vercel.json",
      "tsconfig.json",
      ".gitignore",
      "next.config.mjs",
      "tailwind.config.ts",
      "postcss.config.mjs",
      "public/.gitkeep",
      ".launchpad/validators/.gitkeep",
    ];

    const filePaths = files.map((f) => f.path);
    for (const expected of expectedPaths) {
      expect(filePaths).toContain(expected);
    }

    expect(files.length).toBeGreaterThanOrEqual(21);
  });

  it("CLAUDE.md contains project name", () => {
    const { files } = generateTemplateFiles(mockData);
    const claudeMd = files.find((f) => f.path === "CLAUDE.md")!;
    expect(claudeMd.content).toContain("# LaunchPad Project: My Cool App");
  });

  it("CLAUDE.md contains the delimiter exactly once", () => {
    const { files } = generateTemplateFiles(mockData);
    const claudeMd = files.find((f) => f.path === "CLAUDE.md")!;

    const occurrences = claudeMd.content.split(CLAUDE_MD_DELIMITER).length - 1;
    expect(occurrences).toBe(1);

    const belowDelimiter = claudeMd.content.split(CLAUDE_MD_DELIMITER)[1];
    expect(belowDelimiter).toContain("## Your Project Notes");
  });

  it("CLAUDE.md platform hash is deterministic", () => {
    const result1 = generateTemplateFiles(mockData);
    const result2 = generateTemplateFiles(mockData);
    expect(result1.claudeMdPlatformHash).toBe(result2.claudeMdPlatformHash);
  });

  it("CLAUDE.md platform hash format", () => {
    const { claudeMdPlatformHash } = generateTemplateFiles(mockData);
    expect(claudeMdPlatformHash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("config.json contains matching hash", () => {
    const { files, claudeMdPlatformHash } = generateTemplateFiles(mockData);
    const configFile = files.find((f) => f.path === ".launchpad/config.json")!;
    const parsed = JSON.parse(configFile.content);
    expect(parsed.claude_md_platform_hash).toBe(claudeMdPlatformHash);
  });

  it("config.json structure matches PRD", () => {
    const { files } = generateTemplateFiles(mockData);
    const configFile = files.find((f) => f.path === ".launchpad/config.json")!;
    const parsed = JSON.parse(configFile.content);

    expect(parsed.version).toBe("0.1");
    expect(parsed.project_id).toBe("lp_test123");
    expect(parsed.template).toBe("nextjs-supabase-prisma");
    expect(parsed.template_version).toBe("1.0.0");
    expect(parsed.created_at).toBe("2026-04-08T12:00:00Z");
    expect(parsed.environments.preview.db_provider).toBe("supabase");
    expect(parsed.environments.preview.db_project_id).toBe("staging-ref-abc");
    expect(parsed.environments.preview.db_strategy).toBe("isolated_schema");
    expect(parsed.environments.staging.db_project_id).toBe("staging-ref-abc");
    expect(parsed.environments.staging.db_schema).toBe("public");
    expect(parsed.environments.production.db_project_id).toBe("prod-ref-xyz");
    expect(parsed.environments.production.db_schema).toBe("public");
    expect(parsed.extensions).toEqual([]);
    expect(parsed.managed_files).toContain("CLAUDE.md");
    expect(parsed.managed_files).toContain(".launchpad/config.json");
    expect(parsed.managed_files).toContain("vercel.json");
  });

  it("package.json uses project slug as name", () => {
    const { files } = generateTemplateFiles(mockData);
    const pkgFile = files.find((f) => f.path === "package.json")!;
    const parsed = JSON.parse(pkgFile.content);

    expect(parsed.name).toBe("my-cool-app");
    expect(parsed.dependencies).toHaveProperty("next");
    expect(parsed.dependencies).toHaveProperty("react");
    expect(parsed.dependencies).toHaveProperty("@prisma/client");
    expect(parsed.dependencies).toHaveProperty("@supabase/supabase-js");
  });

  it("README includes clone URL with owner", () => {
    const { files } = generateTemplateFiles(mockData);
    const readme = files.find((f) => f.path === "README.md")!;
    expect(readme.content).toContain(
      "git clone https://github.com/testuser/my-cool-app.git"
    );
  });

  it("prisma/schema.prisma contains datasource with env", () => {
    const { files } = generateTemplateFiles(mockData);
    const schema = files.find((f) => f.path === "prisma/schema.prisma")!;
    expect(schema.content).toContain('env("DATABASE_URL")');
    expect(schema.content).toContain('provider = "postgresql"');
  });

  it("layout.tsx includes project name in metadata", () => {
    const { files } = generateTemplateFiles(mockData);
    const layout = files.find((f) => f.path === "src/app/layout.tsx")!;
    expect(layout.content).toContain("My Cool App");
  });

  it(".gitignore includes required entries", () => {
    const { files } = generateTemplateFiles(mockData);
    const gitignore = files.find((f) => f.path === ".gitignore")!;
    expect(gitignore.content).toContain(".env*.local");
    expect(gitignore.content).toContain(".env");
    expect(gitignore.content).toContain("node_modules");
    expect(gitignore.content).toContain(".next/");
    expect(gitignore.content).toContain(".vercel");
  });

  it("project name with special characters", () => {
    const specialData: TemplateData = {
      ...mockData,
      projectName: "Café & Lounge",
      projectSlug: "caf-lounge",
    };
    const { files } = generateTemplateFiles(specialData);

    const claudeMd = files.find((f) => f.path === "CLAUDE.md")!;
    // Handlebars HTML-escapes `&` → `&amp;`, so check for the escaped form
    expect(claudeMd.content).toContain("Café &amp; Lounge");

    const pkg = files.find((f) => f.path === "package.json")!;
    const parsed = JSON.parse(pkg.content);
    expect(parsed.name).toBe("caf-lounge");
  });
});
