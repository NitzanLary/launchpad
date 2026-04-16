import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getAppUrl } from "@/lib/app-url";

const DEFAULT_TEMPLATE_REPO_URL =
  "https://github.com/NitzanLary/launchpad-template";

/**
 * GET /api/projects/:id/vercel-deploy-url
 *
 * Returns the Vercel Deploy Button URL the browser should redirect to when
 * the project is in AWAITING_VERCEL state.
 *
 * Vercel's `/new/clone` flow clones a source template repo into a NEW repo
 * under the user's GitHub account and creates a Vercel project linked to it
 * — so we point it at the canonical LaunchPad template and let Vercel create
 * both the user's repo and the Vercel project in their browser session.
 * When the user returns, /api/oauth/vercel/deploy-callback looks up the
 * resulting project and resumes the Inngest pipeline.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { projectId } = await params;
  const project = await prisma.project.findFirst({
    where: { id: projectId, userId: session.user.id },
  });

  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (project.status !== "AWAITING_VERCEL") {
    return NextResponse.json(
      { error: `Project is not awaiting Vercel link (status: ${project.status}).` },
      { status: 409 }
    );
  }

  if (!project.vercelDeployNonce) {
    return NextResponse.json(
      { error: "Project is missing the deploy nonce." },
      { status: 500 }
    );
  }

  const templateRepoUrl =
    process.env.LAUNCHPAD_TEMPLATE_REPO_URL || DEFAULT_TEMPLATE_REPO_URL;
  const redirectUrl = `${getAppUrl()}/api/oauth/vercel/deploy-callback?state=${project.id}.${project.vercelDeployNonce}`;

  const clone = new URL("https://vercel.com/new/clone");
  clone.searchParams.set("repository-url", templateRepoUrl);
  clone.searchParams.set("project-name", project.slug);
  clone.searchParams.set("repository-name", project.slug);
  clone.searchParams.set("redirect-url", redirectUrl);

  // Binds LaunchPad's Vercel integration to the new project during the clone
  // flow so that our vci token can manage env vars and deployments afterward.
  // Vercel uses the same `oac_…` value for both the OAuth client id and the
  // integration id consumed by the `integration-ids` query param.
  const integrationId = process.env.INTEGRATION_VERCEL_CLIENT_ID;
  if (integrationId) {
    clone.searchParams.set("integration-ids", integrationId);
  }

  return NextResponse.json({ url: clone.toString() });
}
