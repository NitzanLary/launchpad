import { inngest } from "../client";
import { prisma } from "@/lib/db";
import { ROLLBACK_WINDOW_HOURS } from "@launchpad/shared";

/**
 * Production promotion pipeline.
 * Triggered when user clicks "Promote to Production".
 *
 * Steps:
 * 1. Snapshot current prod state
 * 2. Apply pending migrations to prod DB
 * 3. Promote Vercel staging build to production
 * 4. Health check production URL
 * 5. Set rollback window
 */
export const pipelineProduction = inngest.createFunction(
  {
    id: "pipeline-production",
    retries: 0,
    onFailure: async ({ event }) => {
      const { deployId } = event.data.event.data as { deployId: string };
      await prisma.deploy.update({
        where: { id: deployId },
        data: { status: "FAILED", completedAt: new Date() },
      });
    },
  },
  { event: "deploy/production.requested" },
  async ({ event, step }) => {
    const { projectId, deployId } = event.data;

    await prisma.deploy.update({
      where: { id: deployId },
      data: { status: "VALIDATING", startedAt: new Date() },
    });

    // Step 1: Pre-flight checks
    await step.run("preflight", async () => {
      // TODO: Implement in Phase 6
      // Compare staging vs prod migration history
      // Detect destructive changes
      // Generate change summary
    });

    // Step 2: Apply migrations to production
    await step.run("run-migrations", async () => {
      await prisma.deploy.update({
        where: { id: deployId },
        data: { status: "MIGRATING" },
      });

      // TODO: Implement in Phase 6
      // Run prisma migrate deploy against production DB
    });

    // Step 3: Promote Vercel deployment
    await step.run("promote-vercel", async () => {
      await prisma.deploy.update({
        where: { id: deployId },
        data: { status: "DEPLOYING" },
      });

      // TODO: Implement in Phase 6
      // Use Vercel API to promote staging build artifact to production
    });

    // Step 4: Health check
    await step.sleep("wait-for-deploy", "10s");

    const healthy = await step.run("health-check", async () => {
      await prisma.deploy.update({
        where: { id: deployId },
        data: { status: "VERIFYING" },
      });

      // TODO: Implement in Phase 6
      // Fetch production URL and check for 200 response
      return true;
    });

    // Step 5: Finalize
    await step.run("finalize-deploy", async () => {
      const rollbackUntil = new Date();
      rollbackUntil.setHours(
        rollbackUntil.getHours() + ROLLBACK_WINDOW_HOURS
      );

      const production = await prisma.environment.findFirst({
        where: { projectId, type: "PRODUCTION" },
      });

      await prisma.deploy.update({
        where: { id: deployId },
        data: {
          status: healthy ? "SUCCESS" : "FAILED",
          completedAt: new Date(),
          environmentId: production?.id,
          rollbackAvailableUntil: healthy ? rollbackUntil : null,
        },
      });

      if (production && healthy) {
        await prisma.environment.update({
          where: { id: production.id },
          data: { lastDeployId: deployId },
        });
      }
    });

    return { deployId, status: healthy ? "SUCCESS" : "FAILED" };
  }
);
