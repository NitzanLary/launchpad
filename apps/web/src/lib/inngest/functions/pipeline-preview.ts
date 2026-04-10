import { inngest } from "../client";
import { prisma } from "@/lib/db";
import { MAX_PREVIEW_SCHEMAS, PREVIEW_SCHEMA_PREFIX } from "@launchpad/shared";

/**
 * Preview deploy pipeline.
 * Triggered on push to non-main branch.
 *
 * Steps:
 * 1. Check preview schema count (cap at 5)
 * 2. Run guards
 * 3. Create isolated Postgres schema in staging DB
 * 4. Run prisma db push against preview schema
 * 5. Apply seed data
 * 6. Trigger Vercel preview deploy
 * 7. Poll until Vercel deploy is ready
 * 8. Store deploy record + preview URL
 */
export const pipelinePreview = inngest.createFunction(
  {
    id: "pipeline-preview",
    retries: 2,
    onFailure: async ({ event }) => {
      const { deployId } = event.data.event.data as { deployId: string };
      await prisma.deploy.update({
        where: { id: deployId },
        data: { status: "FAILED", completedAt: new Date() },
      });
    },
  },
  { event: "deploy/preview.requested" },
  async ({ event, step }) => {
    const { projectId, deployId, branch, commitSha } = event.data;

    await prisma.deploy.update({
      where: { id: deployId },
      data: { status: "VALIDATING", startedAt: new Date() },
    });

    // Step 1: Check preview schema limit
    await step.run("check-preview-limit", async () => {
      const activeCount = await prisma.previewSchema.count({
        where: {
          projectId,
          status: { in: ["CREATING", "ACTIVE"] },
        },
      });

      if (activeCount >= MAX_PREVIEW_SCHEMAS) {
        await prisma.deploy.update({
          where: { id: deployId },
          data: { status: "BLOCKED", completedAt: new Date() },
        });
        await prisma.guardResult.create({
          data: {
            deployId,
            guard: "preview-limit",
            status: "BLOCK",
            message: `You have ${activeCount} active preview environments (max ${MAX_PREVIEW_SCHEMAS}). Merge or delete a branch to free up a slot.`,
          },
        });
        throw new Error("Preview schema limit reached");
      }
    });

    // Step 2: Run guards
    const guardsPassed = await step.run("run-guards", async () => {
      // TODO: Implement in Phase 3-4
      // Fetch repo contents from GitHub API, run guards
      await prisma.guardResult.create({
        data: {
          deployId,
          guard: "structure",
          status: "PASS",
          message: "Project structure is valid.",
        },
      });
      return true;
    });

    if (!guardsPassed) return { deployId, status: "BLOCKED" };

    // Step 3: Create isolated Postgres schema
    const schemaName = `${PREVIEW_SCHEMA_PREFIX}${branch.replace(/[^a-z0-9_]/gi, "_")}`;

    const previewSchema = await step.run("create-preview-schema", async () => {
      // TODO: Implement in Phase 4
      // Connect to staging Supabase DB, run CREATE SCHEMA
      // Run prisma db push against the new schema
      await prisma.deploy.update({
        where: { id: deployId },
        data: { status: "MIGRATING" },
      });

      return prisma.previewSchema.upsert({
        where: {
          projectId_branchName: { projectId, branchName: branch },
        },
        update: {
          status: "ACTIVE",
          lastActivityAt: new Date(),
        },
        create: {
          projectId,
          branchName: branch,
          schemaName,
          connectionString: Buffer.from("placeholder"),
          status: "ACTIVE",
        },
      });
    });

    // Step 4: Trigger Vercel preview deploy
    await step.run("trigger-vercel-deploy", async () => {
      // TODO: Implement in Phase 4
      // Trigger Vercel deployment with preview schema connection string
      await prisma.deploy.update({
        where: { id: deployId },
        data: { status: "DEPLOYING" },
      });
    });

    // Step 5: Wait for Vercel deploy
    await step.sleep("wait-for-vercel", "10s");

    // Step 6: Verify and finalize
    await step.run("finalize-deploy", async () => {
      // TODO: Poll Vercel deployment status
      await prisma.deploy.update({
        where: { id: deployId },
        data: {
          status: "SUCCESS",
          completedAt: new Date(),
          // vercelDeployUrl: deployUrl,
        },
      });

      await prisma.previewSchema.update({
        where: { id: previewSchema.id },
        data: {
          status: "ACTIVE",
          lastActivityAt: new Date(),
          // previewUrl: deployUrl,
        },
      });
    });

    return { deployId, status: "SUCCESS" };
  }
);
