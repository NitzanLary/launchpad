import { inngest } from "../client";
import { prisma } from "@/lib/db";

/**
 * Staging deploy pipeline.
 * Triggered on push/merge to main branch.
 *
 * Steps:
 * 1. Run guards
 * 2. Generate migration via prisma migrate diff
 * 3. Commit migration file back to repo
 * 4. Apply migration via prisma migrate deploy
 * 5. Clean up merged branch's preview schema
 * 6. Trigger Vercel staging deploy
 * 7. Finalize
 */
export const pipelineStaging = inngest.createFunction(
  {
    id: "pipeline-staging",
    retries: 1,
    onFailure: async ({ event }) => {
      const { deployId } = event.data.event.data as { deployId: string };
      await prisma.deploy.update({
        where: { id: deployId },
        data: { status: "FAILED", completedAt: new Date() },
      });
    },
  },
  { event: "deploy/staging.requested" },
  async ({ event, step }) => {
    const { projectId, deployId, branch, commitSha } = event.data;

    await prisma.deploy.update({
      where: { id: deployId },
      data: { status: "VALIDATING", startedAt: new Date() },
    });

    // Step 1: Run guards
    await step.run("run-guards", async () => {
      // TODO: Implement in Phase 5
      await prisma.guardResult.create({
        data: {
          deployId,
          guard: "structure",
          status: "PASS",
          message: "Project structure is valid.",
        },
      });
    });

    // Steps 2-3: Run migrations + clean up previews in parallel
    await Promise.all([
      step.run("run-migrations", async () => {
        await prisma.deploy.update({
          where: { id: deployId },
          data: { status: "MIGRATING" },
        });

        // TODO: Implement in Phase 5
        // 1. Fetch schema.prisma from GitHub
        // 2. Run prisma migrate diff against staging DB
        // 3. If diff exists, create migration file
        // 4. Commit migration file to repo via GitHub API
        // 5. Run prisma migrate deploy
      }),

      step.run("cleanup-previews", async () => {
        // Find and drop preview schemas for the merged branch
        const previews = await prisma.previewSchema.findMany({
          where: { projectId, status: "ACTIVE" },
        });

        for (const preview of previews) {
          // TODO: DROP SCHEMA in staging DB
          await prisma.previewSchema.update({
            where: { id: preview.id },
            data: { status: "DELETED" },
          });
        }
      }),
    ]);

    // Step 4: Deploy to Vercel staging
    await step.run("trigger-vercel-deploy", async () => {
      await prisma.deploy.update({
        where: { id: deployId },
        data: { status: "DEPLOYING" },
      });

      // TODO: Implement in Phase 5
      // Trigger Vercel deployment to staging environment
    });

    // Step 5: Wait for Vercel deploy
    // TODO: Replace with Vercel deployment webhook via step.waitForEvent
    // or polling. Vercel builds typically take 60-180s.
    await step.sleep("wait-for-vercel", "90s");

    await step.run("finalize-deploy", async () => {
      const staging = await prisma.environment.findFirst({
        where: { projectId, type: "STAGING" },
      });

      await prisma.deploy.update({
        where: { id: deployId },
        data: {
          status: "SUCCESS",
          completedAt: new Date(),
          environmentId: staging?.id,
        },
      });

      if (staging) {
        await prisma.environment.update({
          where: { id: staging.id },
          data: { lastDeployId: deployId },
        });
      }
    });

    return { deployId, status: "SUCCESS" };
  }
);
