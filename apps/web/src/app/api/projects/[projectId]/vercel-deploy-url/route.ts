import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

/**
 * GET /api/projects/:id/vercel-deploy-url
 *
 * Returns the Vercel Deploy Button URL the browser should redirect to when
 * the project is in AWAITING_VERCEL state. The user completes the clone flow
 * on vercel.com and Vercel redirects back to /api/oauth/vercel/deploy-callback.
 *
 * Server-side project creation via the integration (vci) token is impossible
 * because Vercel isolates that token from the user's GitHub App binding, so
 * the link step must happen in the user's browser session.
 */
export async function GET(
  request: NextRequest,
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

  if (!project.vercelDeployNonce || !project.githubRepoUrl) {
    return NextResponse.json(
      { error: "Project is missing the data needed to build a Vercel deploy URL." },
      { status: 500 }
    );
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
  const redirectUrl = `${appUrl}/api/oauth/vercel/deploy-callback?state=${project.id}.${project.vercelDeployNonce}`;

  const clone = new URL("https://vercel.com/new/clone");
  clone.searchParams.set("repository-url", project.githubRepoUrl);
  clone.searchParams.set("project-name", project.slug);
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
