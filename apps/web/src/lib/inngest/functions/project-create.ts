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
import { generateCustomizationFiles } from "@/lib/template";
import { getAppUrl } from "@/lib/app-url";
import {
  TEMPLATE_VERSION,
  LAUNCHPAD_VERSION,
} from "@launchpad/shared";

/**
 * Multi-step project creation pipeline.
 *
 * LaunchPad can't create GitHub-linked Vercel projects server-side: integration
 * (vci) tokens are isolated from the user's GitHub App binding, and Vercel
 * has no "import existing repo" deep-link. So we rely on Vercel's Deploy
 * Button flow, which clones a canonical template repo into a new repo under
 * the user's GitHub account AND creates a Vercel project linked to it — all
 * in the user's browser session.
 *
 * Steps:
 *  1. Validate prerequisites (OAuth connections, Supabase slots, org ID)
 *  2-3. [parallel] Create Supabase staging + production projects
 *  4. Wait for both Supabase projects ready + fetch credentials
 *  5. Mark AWAITING_VERCEL with a fresh nonce
 *  6. Wait for `project/vercel.linked` (user returns from Vercel)
 *  7. Push the per-project customization commit onto the cloned repo
 *     (CLAUDE.md, .launchpad/config.json, package.json, README.md)
 *  8. Register the GitHub webhook on the user's new repo
 *  9. Inject env vars on the Vercel project
 * 10. Trigger a redeploy so the first build picks up the env vars
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

      // Clean up Vercel project (only set if the user completed the browser
      // flow but the pipeline failed afterward)
      try {
        if (project.vercelProjectId) {
          const { accessToken, providerAccountId } = await getProviderToken(userId, "VERCEL");
          const vercel = new VercelClient(accessToken, providerAccountId);
          await vercel.deleteProject(project.vercelProjectId).catch(() => {});
        }
      } catch {
        // Token may be invalid — continue cleanup
      }

      // Don't delete the user's GitHub repo (Vercel created it in their
      // account via the clone flow) — leave it for the user to inspect.

      await prisma.project.update({
        where: { id: projectId },
        data: { status: "ERROR", vercelDeployNonce: null },
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

    // ── Steps 2-3: Create both Supabase projects in parallel ───────────────

    const [staging, production] = await Promise.all([
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

    // ── Step 4: Check both Supabase projects ready + fetch credentials ──────

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

    // ── Step 5: Mark AWAITING_VERCEL and issue a nonce ─────────────────────

    await step.run("mark-awaiting-vercel", async () => {
      const nonce = randomBytes(32).toString("hex");
      await prisma.project.update({
        where: { id: projectId },
        data: {
          status: "AWAITING_VERCEL",
          vercelDeployNonce: nonce,
        },
      });
    });

    // ── Step 6: Wait for the user to complete Vercel Deploy Button flow ────
    // /api/oauth/vercel/deploy-callback emits this event after looking up the
    // newly created Vercel project + linked GitHub repo.

    const linked = await step.waitForEvent("await-vercel-link", {
      event: "project/vercel.linked",
      timeout: "15m",
      match: "data.projectId",
    });

    if (!linked) {
      throw new Error(
        "Timed out waiting for Vercel project link. The user did not complete the Vercel Deploy Button flow within 15 minutes."
      );
    }

    const vercelProjectId = linked.data.vercelProjectId as string;
    const vercelProjectUrl = linked.data.vercelProjectUrl as string;
    const githubOwner = linked.data.githubOwner as string;
    const githubRepoName = linked.data.githubRepoName as string;

    // ── Step 7: Push per-project customization commit to the cloned repo ───
    // The stock template (CLAUDE.md/package.json/etc.) got cloned during the
    // Deploy Button flow. Overwrite those files with per-project versions
    // that carry the real project id, slug, supabase refs, and platform hash.

    const { claudeMdPlatformHash } = await step.run(
      "push-customization",
      async () => {
        const { accessToken } = await getProviderToken(userId, "GITHUB");
        const github = new GitHubClient(accessToken);

        const { files, claudeMdPlatformHash } = generateCustomizationFiles({
          projectName,
          projectSlug,
          projectId,
          templateVersion: TEMPLATE_VERSION,
          launchpadVersion: LAUNCHPAD_VERSION,
          createdAt: new Date().toISOString(),
          supabaseStagingProjectId: stagingDb.projectId,
          supabaseProdProjectId: prodDb.projectId,
          githubOwner,
        });

        await github.pushFiles(
          githubOwner,
          githubRepoName,
          files,
          "Apply LaunchPad project customization"
        );

        return { claudeMdPlatformHash };
      }
    );

    // ── Step 8: Register the GitHub webhook on the user's new repo ─────────

    await step.run("register-webhook", async () => {
      const project = await prisma.project.findUniqueOrThrow({
        where: { id: projectId },
      });
      if (project.githubWebhookId) return { id: project.githubWebhookId };

      const { accessToken } = await getProviderToken(userId, "GITHUB");
      const github = new GitHubClient(accessToken);

      const webhookSecret = randomBytes(32).toString("hex");
      const webhookUrl = `${getAppUrl()}/api/webhooks/github`;

      const result = await github.createWebhook(
        githubOwner,
        githubRepoName,
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

    // ── Step 9: Inject env vars on the newly linked Vercel project ─────────

    await step.run("inject-vercel-env-vars", async () => {
      const { accessToken, providerAccountId } = await getProviderToken(userId, "VERCEL");
      const vercel = new VercelClient(accessToken, providerAccountId);

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

      type Target = ("production" | "preview" | "development")[];
      const previewTargets: Target = ["preview", "development"];
      const productionTargets: Target = ["production"];

      const envVars = [
        // Staging/Preview
        { key: "DATABASE_URL", value: stagingDbUrl, target: previewTargets, type: "encrypted" as const },
        { key: "NEXT_PUBLIC_SUPABASE_URL", value: stagingDb.url, target: previewTargets, type: "plain" as const },
        { key: "NEXT_PUBLIC_SUPABASE_ANON_KEY", value: stagingDb.anonKey, target: previewTargets, type: "plain" as const },
        { key: "SUPABASE_SERVICE_ROLE_KEY", value: stagingDb.serviceKey, target: previewTargets, type: "encrypted" as const },
        // Production
        { key: "DATABASE_URL", value: prodDbUrl, target: productionTargets, type: "encrypted" as const },
        { key: "NEXT_PUBLIC_SUPABASE_URL", value: prodDb.url, target: productionTargets, type: "plain" as const },
        { key: "NEXT_PUBLIC_SUPABASE_ANON_KEY", value: prodDb.anonKey, target: productionTargets, type: "plain" as const },
        { key: "SUPABASE_SERVICE_ROLE_KEY", value: prodDb.serviceKey, target: productionTargets, type: "encrypted" as const },
      ];

      await vercel.setEnvVars(vercelProjectId, envVars);
    });

    // ── Step 10: Trigger a redeploy so the first build gets the env vars ───
    // The clone flow kicked off an initial build before we injected env vars
    // and before the customization commit landed. Kick a fresh build now.

    await step.run("trigger-redeploy", async () => {
      const { accessToken, providerAccountId } = await getProviderToken(userId, "VERCEL");
      const vercel = new VercelClient(accessToken, providerAccountId);
      try {
        await vercel.createDeployment(projectSlug, "main", "production");
      } catch (err) {
        // Don't fail the whole pipeline if the redeploy request hiccups —
        // the user can always redeploy from Vercel's UI. Log and continue.
        console.error("[project-create] trigger-redeploy failed:", err);
      }
    });

    // ── Step 11: Finalize project record ───────────────────────────────────

    await step.run("finalize-project", async () => {
      await prisma.$transaction([
        prisma.project.update({
          where: { id: projectId },
          data: {
            status: "ACTIVE",
            claudeMdHash: claudeMdPlatformHash,
            vercelDeployNonce: null,
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
            currentUrl: vercelProjectUrl,
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
