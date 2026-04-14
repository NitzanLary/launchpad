import { inngest } from "../client";
import { prisma } from "@/lib/db";
import { STALE_PREVIEW_HOURS } from "@launchpad/shared";

/**
 * Scheduled cleanup of stale preview schemas.
 * Runs every hour, removes schemas for branches inactive > 48 hours.
 */
export const cleanupStalePreviews = inngest.createFunction(
  { id: "cleanup-stale-previews" },
  { cron: "0 * * * *" },
  async ({ step }) => {
    const cutoff = new Date();
    cutoff.setHours(cutoff.getHours() - STALE_PREVIEW_HOURS);

    const stalePreviews = await step.run("find-stale-previews", async () => {
      return prisma.previewSchema.findMany({
        where: {
          status: "ACTIVE",
          lastActivityAt: { lt: cutoff },
        },
        include: {
          project: {
            include: {
              environments: { where: { type: "STAGING" } },
            },
          },
        },
      });
    });

    await Promise.all(
      stalePreviews.map((preview) =>
        step.run(`cleanup-${preview.id}`, async () => {
          // TODO: Implement in Phase 4
          // Connect to staging DB, DROP SCHEMA preview.schemaName CASCADE

          await prisma.previewSchema.update({
            where: { id: preview.id },
            data: { status: "DELETED" },
          });
        })
      )
    );

    return { cleaned: stalePreviews.length };
  }
);
