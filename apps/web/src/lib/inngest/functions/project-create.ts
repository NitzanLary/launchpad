import { randomBytes } from "crypto";
import { inngest } from "../client";
import { prisma } from "@/lib/db";
import { encrypt } from "@/lib/encryption";
import { getProviderToken, hasConnection } from "@/lib/tokens";
import {
  GitHubClient,
  VercelClient,
  SupabaseClient,
  buildDatabaseUrl,
} from "@/lib/integrations";
import { generateTemplateFiles } from "@/lib/template";
import {
  TEMPLATE_VERSION,
  LAUNCHPAD_VERSION,
} from "@launchpad/shared";

/**
 * Multi-step project creation pipeline.
 * Triggered when a user creates a new project.
 *
 * Steps:
 *  1. Validate prerequisites (OAuth connections, Supabase slots, org ID)
 *  2. Create GitHub repo
 *  3. Create Supabase staging project
 *  4. Create Supabase production project
 *  5. Wait for Supabase staging ready + fetch credentials
 *  6. Wait for Supabase production ready + fetch credentials
 *  7. Create Vercel project linked to GitHub
 *  8. Configure Vercel env vars
 *  9. Push scaffolded template to GitHub
 * 10. Register GitHub webhook
 * 11. Finalize project record → ACTIVE
 */
export const projectCreate = inngest.createFunction(
  {
    id: "project-create",
    retries: 3,
    onFailure: async ({ event }) => {
      const { projectId, userId } = event.data.event.data as {
        projectId: string;
        userId: string;
      };

      const project = await prisma.project.findUnique({
        where: { id: projectId },
      });
      if (!project) return;

      // Clean up Supabase projects
      try {
        if (project.supabaseStagingRef || project.supabaseProdRef) {
          const { accessToken } = await getProviderToken(userId, "SUPABASE");
          const supabase = new SupabaseClient(accessToken);

          if (project.supabaseStagingRef) {
            await supabase
              .deleteProject(project.supabaseStagingRef)
              .catch(() => {});
          }
          if (project.supabaseProdRef) {
            await supabase
              .deleteProject(project.supabaseProdRef)
              .catch(() => {});
          }
        }
      } catch {
        // Token may be invalid — continue cleanup
      }

      // Clean up Vercel project
      try {
        if (project.vercelProjectId) {
          const { accessToken } = await getProviderToken(userId, "VERCEL");
          const vercel = new VercelClient(accessToken);
          await vercel.deleteProject(project.vercelProjectId).catch(() => {});
        }
      } catch {
        // Token may be invalid — continue cleanup
      }

      // Don't delete GitHub repo — user may want to inspect it

      await prisma.project.update({
        where: { id: projectId },
        data: { status: "ERROR" },
      });
    },
  },
  { event: "project/create.requested" },
  async ({ event, step }) => {
    const { projectId, userId, projectName, projectSlug } = event.data;

    // ── Step 1: Validate prerequisites ──────────────────────────────────────

    const { supabaseOrgId } = await step.run(
      "validate-prerequisites",
      async () => {
        const [hasGithub, hasVercel, hasSupabase] = await Promise.all([
          hasConnection(userId, "GITHUB"),
          hasConnection(userId, "VERCEL"),
          hasConnection(userId, "SUPABASE"),
        ]);

        if (!hasGithub || !hasVercel || !hasSupabase) {
          const missing = [
            !hasGithub && "GitHub",
            !hasVercel && "Vercel",
            !hasSupabase && "Supabase",
          ].filter(Boolean);
          throw new Error(
            `Missing OAuth connections: ${missing.join(", ")}. Please connect all services in Settings.`
          );
        }

        // Validate Supabase has free slots
        const { accessToken } = await getProviderToken(userId, "SUPABASE");
        const supabase = new SupabaseClient(accessToken);

        const activeCount = await supabase.countActiveProjects();
        if (activeCount > 0) {
          throw new Error(
            "Your Supabase account already has projects. LaunchPad needs 2 free project slots (for staging and production)."
          );
        }

        // Get org ID for project creation
        const orgs = await supabase.listOrganizations();
        if (orgs.length === 0) {
          throw new Error(
            "No Supabase organization found. Please create an organization at supabase.com."
          );
        }

        return { supabaseOrgId: orgs[0].id };
      }
    );

    // ── Step 2: Create GitHub repo ──────────────────────────────────────────

    const repo = await step.run("create-github-repo", async () => {
      // Idempotency: check if repo was already created
      const project = await prisma.project.findUniqueOrThrow({
        where: { id: projectId },
      });
      if (project.githubRepoId) {
        return {
          id: project.githubRepoId,
          url: project.githubRepoUrl!,
          owner: project.githubOwner!,
          fullName: `${project.githubOwner}/${projectSlug}`,
        };
      }

      const { accessToken } = await getProviderToken(userId, "GITHUB");
      const github = new GitHubClient(accessToken);

      const user = await github.getUser();
      const result = await github.createRepo(projectSlug, true);

      // Persist immediately for idempotency and cleanup
      await prisma.project.update({
        where: { id: projectId },
        data: {
          githubRepoId: result.id,
          githubRepoUrl: result.html_url,
          githubOwner: user.login,
        },
      });

      return {
        id: result.id,
        url: result.html_url,
        owner: user.login,
        fullName: result.full_name,
      };
    });

    // ── Step 3: Create Supabase staging project ─────────────────────────────

    const staging = await step.run("create-supabase-staging", async () => {
      const { accessToken } = await getProviderToken(userId, "SUPABASE");
      const supabase = new SupabaseClient(accessToken);

      const dbPassword = randomBytes(24).toString("base64url");
      const result = await supabase.createProject(
        `${projectSlug}-staging`,
        supabaseOrgId,
        dbPassword,
        "us-east-1"
      );

      // Persist ref for cleanup on failure
      await prisma.project.update({
        where: { id: projectId },
        data: { supabaseStagingRef: result.id },
      });

      return { ref: result.id, password: dbPassword, region: "us-east-1" };
    });

    // ── Step 4: Create Supabase production project ──────────────────────────

    const production = await step.run(
      "create-supabase-production",
      async () => {
        const { accessToken } = await getProviderToken(userId, "SUPABASE");
        const supabase = new SupabaseClient(accessToken);

        const dbPassword = randomBytes(24).toString("base64url");
        const result = await supabase.createProject(
          `${projectSlug}-prod`,
          supabaseOrgId,
          dbPassword,
          "us-east-1"
        );

        // Persist ref for cleanup on failure
        await prisma.project.update({
          where: { id: projectId },
          data: { supabaseProdRef: result.id },
        });

        return { ref: result.id, password: dbPassword, region: "us-east-1" };
      }
    );

    // ── Wait for Supabase projects to provision (~60s) ──────────────────────

    await step.sleep("wait-supabase-provision", "45s");

    // ── Step 5: Check staging ready + fetch credentials ─────────────────────

    const stagingDb = await step.run(
      "check-supabase-staging-ready",
      async () => {
        const { accessToken } = await getProviderToken(userId, "SUPABASE");
        const supabase = new SupabaseClient(accessToken);

        const projects = await supabase.listProjects();
        const project = projects.find((p) => p.id === staging.ref);

        if (!project || project.status !== "ACTIVE_HEALTHY") {
          throw new Error(
            `Staging project not ready yet (status: ${project?.status ?? "not found"}). Retrying...`
          );
        }

        const keys = await supabase.getProjectApiKeys(staging.ref);
        const anonKey = keys.find((k) => k.name === "anon")?.api_key;
        const serviceKey = keys.find(
          (k) => k.name === "service_role"
        )?.api_key;

        if (!anonKey || !serviceKey) {
          throw new Error("Staging API keys not available yet. Retrying...");
        }

        return {
          projectId: staging.ref,
          host: `db.${staging.ref}.supabase.co`,
          url: `https://${staging.ref}.supabase.co`,
          anonKey,
          serviceKey,
          region: project.region,
        };
      }
    );

    // ── Step 6: Check production ready + fetch credentials ──────────────────

    const prodDb = await step.run(
      "check-supabase-production-ready",
      async () => {
        const { accessToken } = await getProviderToken(userId, "SUPABASE");
        const supabase = new SupabaseClient(accessToken);

        const projects = await supabase.listProjects();
        const project = projects.find((p) => p.id === production.ref);

        if (!project || project.status !== "ACTIVE_HEALTHY") {
          throw new Error(
            `Production project not ready yet (status: ${project?.status ?? "not found"}). Retrying...`
          );
        }

        const keys = await supabase.getProjectApiKeys(production.ref);
        const anonKey = keys.find((k) => k.name === "anon")?.api_key;
        const serviceKey = keys.find(
          (k) => k.name === "service_role"
        )?.api_key;

        if (!anonKey || !serviceKey) {
          throw new Error(
            "Production API keys not available yet. Retrying..."
          );
        }

        return {
          projectId: production.ref,
          host: `db.${production.ref}.supabase.co`,
          url: `https://${production.ref}.supabase.co`,
          anonKey,
          serviceKey,
          region: project.region,
        };
      }
    );

    // ── Step 7: Create Vercel project ───────────────────────────────────────

    const vercelProject = await step.run(
      "create-vercel-project",
      async () => {
        const project = await prisma.project.findUniqueOrThrow({
          where: { id: projectId },
        });
        if (project.vercelProjectId) {
          return {
            id: project.vercelProjectId,
            url: project.vercelProjectUrl!,
          };
        }

        const { accessToken } = await getProviderToken(userId, "VERCEL");
        const vercel = new VercelClient(accessToken);

        const result = await vercel.createProject(projectSlug, repo.fullName);

        await prisma.project.update({
          where: { id: projectId },
          data: {
            vercelProjectId: result.id,
            vercelProjectUrl: `https://${result.name}.vercel.app`,
          },
        });

        return {
          id: result.id,
          url: `https://${result.name}.vercel.app`,
        };
      }
    );

    // ── Step 8: Configure Vercel environment variables ──────────────────────

    await step.run("configure-vercel-env", async () => {
      const { accessToken } = await getProviderToken(userId, "VERCEL");
      const vercel = new VercelClient(accessToken);

      // Build DATABASE_URLs using passwords from creation steps
      const stagingDbUrl = buildDatabaseUrl(
        staging.ref,
        staging.password,
        staging.region
      );
      const prodDbUrl = buildDatabaseUrl(
        production.ref,
        production.password,
        production.region
      );

      const envVars = [
        // Staging/Preview environment variables
        {
          key: "DATABASE_URL",
          value: stagingDbUrl,
          target: ["preview", "development"] as (
            | "production"
            | "preview"
            | "development"
          )[],
          type: "encrypted" as const,
        },
        {
          key: "NEXT_PUBLIC_SUPABASE_URL",
          value: stagingDb.url,
          target: ["preview", "development"] as (
            | "production"
            | "preview"
            | "development"
          )[],
          type: "plain" as const,
        },
        {
          key: "NEXT_PUBLIC_SUPABASE_ANON_KEY",
          value: stagingDb.anonKey,
          target: ["preview", "development"] as (
            | "production"
            | "preview"
            | "development"
          )[],
          type: "plain" as const,
        },
        {
          key: "SUPABASE_SERVICE_ROLE_KEY",
          value: stagingDb.serviceKey,
          target: ["preview", "development"] as (
            | "production"
            | "preview"
            | "development"
          )[],
          type: "encrypted" as const,
        },
        // Production environment variables
        {
          key: "DATABASE_URL",
          value: prodDbUrl,
          target: ["production"] as (
            | "production"
            | "preview"
            | "development"
          )[],
          type: "encrypted" as const,
        },
        {
          key: "NEXT_PUBLIC_SUPABASE_URL",
          value: prodDb.url,
          target: ["production"] as (
            | "production"
            | "preview"
            | "development"
          )[],
          type: "plain" as const,
        },
        {
          key: "NEXT_PUBLIC_SUPABASE_ANON_KEY",
          value: prodDb.anonKey,
          target: ["production"] as (
            | "production"
            | "preview"
            | "development"
          )[],
          type: "plain" as const,
        },
        {
          key: "SUPABASE_SERVICE_ROLE_KEY",
          value: prodDb.serviceKey,
          target: ["production"] as (
            | "production"
            | "preview"
            | "development"
          )[],
          type: "encrypted" as const,
        },
      ];

      await vercel.setEnvVars(vercelProject.id, envVars);
    });

    // ── Step 9: Push scaffolded template to GitHub ──────────────────────────

    const { claudeMdPlatformHash } = await step.run(
      "push-template",
      async () => {
        const { accessToken } = await getProviderToken(userId, "GITHUB");
        const github = new GitHubClient(accessToken);

        const { files, claudeMdPlatformHash } = generateTemplateFiles({
          projectName,
          projectSlug,
          projectId,
          templateVersion: TEMPLATE_VERSION,
          launchpadVersion: LAUNCHPAD_VERSION,
          createdAt: new Date().toISOString(),
          supabaseStagingProjectId: stagingDb.projectId,
          supabaseProdProjectId: prodDb.projectId,
          githubOwner: repo.owner,
        });

        await github.pushFiles(
          repo.owner,
          projectSlug,
          files,
          "Initial project scaffold by LaunchPad"
        );

        return { claudeMdPlatformHash };
      }
    );

    // ── Step 10: Register GitHub webhook ────────────────────────────────────

    const webhook = await step.run("register-webhook", async () => {
      const project = await prisma.project.findUniqueOrThrow({
        where: { id: projectId },
      });
      if (project.githubWebhookId) {
        return { id: project.githubWebhookId };
      }

      const { accessToken } = await getProviderToken(userId, "GITHUB");
      const github = new GitHubClient(accessToken);

      const webhookSecret = randomBytes(32).toString("hex");
      const appUrl =
        process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
      const webhookUrl = `${appUrl}/api/webhooks/github`;

      const result = await github.createWebhook(
        repo.owner,
        projectSlug,
        webhookUrl,
        webhookSecret
      );

      await prisma.project.update({
        where: { id: projectId },
        data: {
          githubWebhookId: result.id,
          webhookSecretEnc: encrypt(webhookSecret),
        },
      });

      return { id: result.id };
    });

    // ── Step 11: Finalize project record ────────────────────────────────────

    await step.run("finalize-project", async () => {
      await prisma.$transaction([
        prisma.project.update({
          where: { id: projectId },
          data: {
            status: "ACTIVE",
            claudeMdHash: claudeMdPlatformHash,
          },
        }),
        prisma.environment.create({
          data: {
            projectId,
            type: "STAGING",
            supabaseProjectId: stagingDb.projectId,
            supabaseDbHost: stagingDb.host,
            supabaseDbPassword: encrypt(staging.password),
            supabaseAnonKey: stagingDb.anonKey,
            supabaseServiceKey: encrypt(stagingDb.serviceKey),
            supabaseUrl: stagingDb.url,
            vercelEnvTarget: "preview",
            currentUrl: vercelProject.url,
          },
        }),
        prisma.environment.create({
          data: {
            projectId,
            type: "PRODUCTION",
            supabaseProjectId: prodDb.projectId,
            supabaseDbHost: prodDb.host,
            supabaseDbPassword: encrypt(production.password),
            supabaseAnonKey: prodDb.anonKey,
            supabaseServiceKey: encrypt(prodDb.serviceKey),
            supabaseUrl: prodDb.url,
            vercelEnvTarget: "production",
          },
        }),
      ]);
    });

    return { projectId, status: "ACTIVE" };
  }
);
