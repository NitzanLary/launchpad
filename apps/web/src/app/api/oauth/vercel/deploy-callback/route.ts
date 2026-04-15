import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { inngest } from "@/lib/inngest/client";
import { getProviderToken } from "@/lib/tokens";
import { VercelClient } from "@/lib/integrations";

/**
 * GET /api/oauth/vercel/deploy-callback
 *
 * Vercel redirects here after the user completes the /new/clone Deploy Button
 * flow. We validate the nonce in the `state` query param, resolve the newly
 * created Vercel project id (preferring query-param hints from Vercel, falling
 * back to a listProjects lookup by repo), persist it, and emit the
 * `project/vercel.linked` event so the suspended Inngest pipeline resumes.
 */
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }

  const { searchParams } = new URL(request.url);
  const state = searchParams.get("state");

  if (!state || !state.includes(".")) {
    return NextResponse.redirect(
      new URL("/projects?error=Invalid+deploy+callback+state", request.url)
    );
  }

  const [projectId, nonce] = state.split(".");

  const project = await prisma.project.findFirst({
    where: { id: projectId, userId: session.user.id },
  });

  if (!project) {
    return NextResponse.redirect(
      new URL("/projects?error=Project+not+found", request.url)
    );
  }

  if (project.status !== "AWAITING_VERCEL" || project.vercelDeployNonce !== nonce) {
    // Already linked (double-submit) or nonce mismatch. Land on the detail page.
    return NextResponse.redirect(
      new URL(`/projects/${projectId}`, request.url)
    );
  }

  // Prefer the Vercel project id from query params if Vercel returned one.
  // Fall back to listing projects and matching on the linked GitHub repo.
  let vercelProjectId =
    searchParams.get("projectId") ||
    searchParams.get("project-id") ||
    searchParams.get("vercelProjectId") ||
    null;
  let vercelProjectName: string | null = null;

  if (!vercelProjectId) {
    try {
      const { accessToken, providerAccountId } = await getProviderToken(
        session.user.id,
        "VERCEL"
      );
      const vercel = new VercelClient(accessToken, providerAccountId);
      const owner = project.githubOwner;
      if (owner) {
        const found = await vercel.findProjectByRepo(owner, project.slug);
        if (found) {
          vercelProjectId = found.id;
          vercelProjectName = found.name;
        }
      }
    } catch (err) {
      console.error("[vercel-deploy-callback] findProjectByRepo failed:", err);
    }
  }

  if (!vercelProjectId) {
    return NextResponse.redirect(
      new URL(
        `/projects/${projectId}?error=${encodeURIComponent(
          "Vercel did not return a project id and we couldn't find the linked project. Please try again."
        )}`,
        request.url
      )
    );
  }

  const vercelProjectUrl = `https://${vercelProjectName ?? project.slug}.vercel.app`;

  await prisma.project.update({
    where: { id: projectId },
    data: {
      vercelProjectId,
      vercelProjectUrl,
      vercelDeployNonce: null,
    },
  });

  try {
    await inngest.send({
      name: "project/vercel.linked",
      data: {
        projectId,
        userId: session.user.id,
        vercelProjectId,
        vercelProjectUrl,
      },
    });
  } catch (err) {
    console.error("[vercel-deploy-callback] inngest.send failed:", err);
    return NextResponse.redirect(
      new URL(
        `/projects/${projectId}?error=${encodeURIComponent(
          "Saved Vercel link but failed to resume the pipeline. Please refresh."
        )}`,
        request.url
      )
    );
  }

  return NextResponse.redirect(
    new URL(`/projects/${projectId}?vercel=connected`, request.url)
  );
}
