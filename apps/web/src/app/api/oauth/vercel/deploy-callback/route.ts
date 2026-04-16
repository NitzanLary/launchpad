import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { inngest } from "@/lib/inngest/client";
import { getProviderToken } from "@/lib/tokens";
import { GitHubClient, VercelClient } from "@/lib/integrations";

/**
 * GET /api/oauth/vercel/deploy-callback
 *
 * Vercel redirects here after the user completes the /new/clone flow, which
 * both created a new GitHub repo under the user's account (cloned from the
 * canonical LaunchPad template) and a new Vercel project linked to it.
 *
 * We look up the resulting Vercel project (preferring query-param hints from
 * Vercel, falling back to a name search), pull its git link so we know which
 * GitHub repo Vercel created, persist everything on the Project row, and
 * emit `project/vercel.linked` to resume the suspended pipeline.
 */
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set(
      "next",
      request.nextUrl.pathname + request.nextUrl.search
    );
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

  if (
    project.status !== "AWAITING_VERCEL" ||
    project.vercelDeployNonce !== nonce
  ) {
    // Already linked (double-submit) or nonce mismatch. Land on the detail page.
    return NextResponse.redirect(new URL(`/projects/${projectId}`, request.url));
  }

  // Resolve the Vercel project. Prefer explicit query-param hints if Vercel
  // sent any; otherwise search by exact name (we pre-set project-name=slug).
  const { accessToken: vercelToken, providerAccountId: vercelAccountId } =
    await getProviderToken(session.user.id, "VERCEL");
  const vercel = new VercelClient(vercelToken, vercelAccountId);

  const hintedId =
    searchParams.get("projectId") ||
    searchParams.get("project-id") ||
    searchParams.get("vercelProjectId") ||
    null;

  type ResolvedProject = {
    id: string;
    name: string;
    link: {
      type: "github";
      repo: string;
      repoId?: number;
      org?: string;
      owner?: string;
    };
  };

  let resolved: ResolvedProject | null = null;

  if (hintedId) {
    try {
      const fetched = await vercel.getProject(hintedId);
      if (fetched.link?.type === "github" && fetched.link.repo) {
        resolved = {
          id: fetched.id,
          name: fetched.name,
          link: {
            type: "github",
            repo: fetched.link.repo,
            repoId: fetched.link.repoId,
            org: fetched.link.org,
            owner: fetched.link.owner,
          },
        };
      }
    } catch (err) {
      console.error("[vercel-deploy-callback] getProject(hinted) failed:", err);
    }
  }

  if (!resolved) {
    try {
      resolved = await vercel.findProjectByName(project.slug);
    } catch (err) {
      console.error("[vercel-deploy-callback] findProjectByName failed:", err);
    }
  }

  if (!resolved) {
    return NextResponse.redirect(
      new URL(
        `/projects/${projectId}?error=${encodeURIComponent(
          "Vercel completed the clone flow but we couldn't locate the new project. Check your Vercel dashboard and retry."
        )}`,
        request.url
      )
    );
  }

  // Normalize the GitHub repo info. Vercel sometimes returns `repo` as
  // "owner/name" and sometimes as just "name" with `org`/`owner` alongside.
  const { owner: githubOwner, repoName: githubRepoName } = parseLinkRepo(
    resolved.link
  );

  let finalOwner = githubOwner;
  if (!finalOwner) {
    try {
      const { accessToken: ghToken } = await getProviderToken(
        session.user.id,
        "GITHUB"
      );
      const ghUser = await new GitHubClient(ghToken).getUser();
      finalOwner = ghUser.login;
    } catch (err) {
      console.error(
        "[vercel-deploy-callback] could not resolve GitHub owner:",
        err
      );
    }
  }

  if (!finalOwner || !githubRepoName) {
    return NextResponse.redirect(
      new URL(
        `/projects/${projectId}?error=${encodeURIComponent(
          "Vercel returned an incomplete git link. Check the project in Vercel and retry."
        )}`,
        request.url
      )
    );
  }

  const githubRepoUrl = `https://github.com/${finalOwner}/${githubRepoName}`;
  const vercelProjectUrl = `https://${resolved.name}.vercel.app`;

  await prisma.project.update({
    where: { id: projectId },
    data: {
      vercelProjectId: resolved.id,
      vercelProjectUrl,
      githubRepoId: resolved.link.repoId ?? null,
      githubRepoUrl,
      githubOwner: finalOwner,
      vercelDeployNonce: null,
    },
  });

  try {
    await inngest.send({
      name: "project/vercel.linked",
      data: {
        projectId,
        userId: session.user.id,
        vercelProjectId: resolved.id,
        vercelProjectUrl,
        githubOwner: finalOwner,
        githubRepoName,
        githubRepoUrl,
        githubRepoId: resolved.link.repoId ?? null,
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

function parseLinkRepo(link: {
  repo: string;
  org?: string;
  owner?: string;
}): { owner: string; repoName: string } {
  if (link.repo.includes("/")) {
    const [owner, ...rest] = link.repo.split("/");
    return { owner, repoName: rest.join("/") };
  }
  return { owner: link.org || link.owner || "", repoName: link.repo };
}
