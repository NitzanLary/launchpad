import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { projectCreate } from "@/lib/inngest/functions/project-create";
import { pipelinePreview } from "@/lib/inngest/functions/pipeline-preview";
import { pipelineStaging } from "@/lib/inngest/functions/pipeline-staging";
import { pipelineProduction } from "@/lib/inngest/functions/pipeline-production";
import { cleanupStalePreviews } from "@/lib/inngest/functions/cleanup-stale-previews";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    projectCreate,
    pipelinePreview,
    pipelineStaging,
    pipelineProduction,
    cleanupStalePreviews,
  ],
});
