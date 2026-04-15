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
 *  2-4. [parallel] Create GitHub repo + Supabase staging + Supabase production
 *  5. Wait for both Supabase projects ready + fetch credentials
 *  6. Create Vercel project + configure env vars
 *  7-8. [parallel] Push scaffolded template + register GitHub webhook
 *  9. Finalize project record → ACTIVE
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
          const { accessToken, providerAccountId } = await getProviderToken(userId, "VERCEL");
          const vercel = new VercelClient(accessToken, providerAccountId);
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

        // Safety net: verify Vercel has GitHub integration
        // (primary check is in POST /api/projects, but re-check here in case of race)
        const { accessToken: vercelToken, providerAccountId: vercelAccountId } = await getProviderToken(
          userId,
          "VERCEL"
        );
        const hasGitHub = await new VercelClient(
          vercelToken, vercelAccountId
        ).hasGitHubIntegration();
        // Only block on a definitive `false`. `null` = detection failed; let the
        // pipeline proceed and surface a real Vercel error if the App is missing.
        if (hasGitHub === false) {
          throw new Error(
            "Vercel does not have the GitHub integration installed. Please install the Vercel GitHub App at https://github.com/apps/vercel and try again."
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

    // ── Steps 2-4: Create GitHub repo + both Supabase projects in parallel ─

    const [repo, staging, production] = await Promise.all([
      step.run("create-github-repo", async () => {
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
      }),

      step.run("create-supabase-staging", async () => {
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
      }),

      step.run("create-supabase-production", async () => {
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
      }),
    ]);

    // ── Wait for Supabase projects to provision ──────────────────────────────

    await step.sleep("wait-supabase-provision", "30s");

    // ── Step 5: Check both Supabase projects ready + fetch credentials ──────

    const { stagingDb, prodDb } = await step.run(
      "check-supabase-ready",
      async () => {
        const { accessToken } = await getProviderToken(userId, "SUPABASE");
        const supabase = new SupabaseClient(accessToken);

        const projects = await supabase.listProjects();
        const stagingProject = projects.find((p) => p.id === staging.ref);
        const prodProject = projects.find((p) => p.id === production.ref);

        if (!stagingProject || stagingProject.status !== "ACTIVE_HEALTHY") {
          throw new Error(
            `Staging project not ready yet (status: ${stagingProject?.status ?? "not found"}). Retrying...`
          );
        }
        if (!prodProject || prodProject.status !== "ACTIVE_HEALTHY") {
          throw new Error(
            `Production project not ready yet (status: ${prodProject?.status ?? "not found"}). Retrying...`
          );
        }

        const [stagingKeys, prodKeys] = await Promise.all([
          supabase.getProjectApiKeys(staging.ref),
          supabase.getProjectApiKeys(production.ref),
        ]);

        const stagingAnon = stagingKeys.find((k) => k.name === "anon")?.api_key;
        const stagingService = stagingKeys.find(
          (k) => k.name === "service_role"
        )?.api_key;
        const prodAnon = prodKeys.find((k) => k.name === "anon")?.api_key;
        const prodService = prodKeys.find(
          (k) => k.name === "service_role"
        )?.api_key;

        if (!stagingAnon || !stagingService) {
          throw new Error("Staging API keys not available yet. Retrying...");
        }
        if (!prodAnon || !prodService) {
          throw new Error("Production API keys not available yet. Retrying...");
        }

        return {
          stagingDb: {
            projectId: staging.ref,
            host: `db.${staging.ref}.supabase.co`,
            url: `https://${staging.ref}.supabase.co`,
            anonKey: stagingAnon,
            serviceKey: stagingService,
            region: stagingProject.region,
          },
          prodDb: {
            projectId: production.ref,
            host: `db.${production.ref}.supabase.co`,
            url: `https://${production.ref}.supabase.co`,
            anonKey: prodAnon,
            serviceKey: prodService,
            region: prodProject.region,
          },
        };
      }
    );

    // ── Step 5b: Wait until Vercel's GitHub App has synced the new repo ────
    //
    // The Vercel GitHub App maintains a cached list of repos it has access to.
    // Brand-new repos take a few seconds to a couple of minutes to show up —
    // even when the App is installed with "All repositories" permission.
    // If we try to create the Vercel project before the sync completes,
    // /v10/projects returns "install GitHub integration first" even though it
    // IS installed. Poll /v1/integrations/search-repo until the repo appears.

    await step.run("wait-vercel-sees-github-repo", async () => {
      const { accessToken, providerAccountId } = await getProviderToken(
        userId,
        "VERCEL"
      );
      const vercel = new VercelClient(accessToken, providerAccountId);

      const namespaces = await vercel.listGitNamespaces("github");
      if (namespaces.length === 0) {
        throw new Error(
          "Vercel GitHub App is not installed. Please install it at https://github.com/apps/vercel and reconnect Vercel in Settings."
        );
      }

      const maxAttempts = 18; // ~90s @ 5s intervals
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        for (const ns of namespaces) {
          const repos = await vercel.searchGitRepo({
            namespaceId: ns.id,
            query: projectSlug,
          });
          if (repos.some((r) => r.id === repo.id)) {
            return { synced: true, attempts: attempt + 1 };
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }

      throw new Error(
        `Vercel GitHub App has not synced the new repo "${repo.fullName}" after ~90s. ` +
          `If you installed the App with "Only select repositories", grant it access to this repo or switch to "All repositories".`
      );
    });

    // ── Step 6: Create Vercel project + configure env vars ─────────────────

    const vercelProject = await step.run(
      "create-and-configure-vercel",
      async () => {
        const { accessToken, providerAccountId } = await getProviderToken(userId, "VERCEL");
        const vercel = new VercelClient(accessToken, providerAccountId);

        // Idempotency: check if Vercel project was already created
        const project = await prisma.project.findUniqueOrThrow({
          where: { id: projectId },
        });

        let vercelId = project.vercelProjectId;
        let vercelUrl = project.vercelProjectUrl;

        if (!vercelId) {
          const result = await vercel.createProject(projectSlug, {
            repoId: repo.id,
          });
          vercelId = result.id;
          vercelUrl = `https://${result.name}.vercel.app`;

          await prisma.project.update({
            where: { id: projectId },
            data: {
              vercelProjectId: vercelId,
              vercelProjectUrl: vercelUrl,
            },
          });
        }

        // Configure env vars (idempotent — Vercel overwrites)
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

        await vercel.setEnvVars(vercelId, envVars);

        return { id: vercelId, url: vercelUrl! };
      }
    );

    // ── Steps 7-8: Push template + register webhook in parallel ────────────

    const [{ claudeMdPlatformHash }] = await Promise.all([
      step.run("push-template", async () => {
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
      }),

      step.run("register-webhook", async () => {
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
      }),
    ]);

    // ── Step 9: Finalize project record ─────────────────────────────────────

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
