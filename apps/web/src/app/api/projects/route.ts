import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { inngest } from "@/lib/inngest/client";
import { hasConnection, getProviderToken, TokenError } from "@/lib/tokens";
import { SupabaseClient, VercelClient } from "@/lib/integrations";
import { ERROR_CODES } from "@launchpad/shared";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const projects = await prisma.project.findMany({
    where: { userId: session.user.id, status: { not: "DELETED" } },
    orderBy: { createdAt: "desc" },
    include: {
      environments: true,
      _count: { select: { deploys: true } },
    },
  });

  return NextResponse.json(projects);
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { name } = body;

  if (!name || typeof name !== "string") {
    return NextResponse.json(
      { error: "Project name is required" },
      { status: 400 }
    );
  }

  const slug = slugify(name);
  if (slug.length < 2) {
    return NextResponse.json(
      { error: "Project name is too short" },
      { status: 400 }
    );
  }

  // Check for existing project with same slug
  const existing = await prisma.project.findUnique({ where: { slug } });
  if (existing) {
    return NextResponse.json(
      { error: "A project with this name already exists" },
      { status: 409 }
    );
  }

  // Check user's project limit (1 project on free tier)
  const projectCount = await prisma.project.count({
    where: {
      userId: session.user.id,
      status: { notIn: ["DELETED", "ERROR"] },
    },
  });
  if (projectCount >= 1) {
    return NextResponse.json(
      {
        error:
          "You already have a LaunchPad project. Free-tier users are limited to 1 project.",
      },
      { status: 403 }
    );
  }

  // Check all OAuth connections
  const [hasGithub, hasVercel, hasSupabase] = await Promise.all([
    hasConnection(session.user.id, "GITHUB"),
    hasConnection(session.user.id, "VERCEL"),
    hasConnection(session.user.id, "SUPABASE"),
  ]);

  if (!hasGithub || !hasVercel || !hasSupabase) {
    const missing = [
      !hasGithub && "GitHub",
      !hasVercel && "Vercel",
      !hasSupabase && "Supabase",
    ].filter(Boolean);
    return NextResponse.json(
      {
        error: `Please connect your ${missing.join(", ")} account(s) in Settings before creating a project.`,
      },
      { status: 400 }
    );
  }

  // Check that Vercel has the GitHub integration installed.
  // Without it, Vercel can't link to the user's GitHub repos and project creation will fail.
  try {
    const { accessToken: vercelToken } = await getProviderToken(
      session.user.id,
      "VERCEL"
    );
    const vercel = new VercelClient(vercelToken);
    const hasGitHub = await vercel.hasGitHubIntegration();
    if (!hasGitHub) {
      return NextResponse.json(
        {
          error: ERROR_CODES.VERCEL_GITHUB_NOT_CONNECTED,
          code: "VERCEL_GITHUB_NOT_CONNECTED",
        },
        { status: 400 }
      );
    }
  } catch (err) {
    if (err instanceof TokenError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("[project-create] Vercel GitHub check failed (non-fatal):", err);
  }

  // Validate Supabase has free project slots (best-effort).
  // If validation fails (API unreachable, token issue), log and proceed —
  // the Inngest pipeline re-validates at step 1 with retries.
  try {
    const { accessToken } = await getProviderToken(session.user.id, "SUPABASE");
    const supabase = new SupabaseClient(accessToken);
    const activeCount = await supabase.countActiveProjects();
    if (activeCount > 0) {
      return NextResponse.json(
        { error: ERROR_CODES.SUPABASE_SLOTS_FULL },
        { status: 400 }
      );
    }
  } catch (err) {
    // Token errors mean the user needs to reconnect — block creation.
    if (err instanceof TokenError) {
      return NextResponse.json(
        { error: err.message },
        { status: 400 }
      );
    }
    // API errors (transient failures, rate limits) — log and let the pipeline handle it.
    console.error("[project-create] Supabase pre-validation failed (non-fatal):", err);
  }

  // Create the project record and trigger the pipeline
  let project;
  try {
    project = await prisma.project.create({
      data: {
        name,
        slug,
        userId: session.user.id,
        status: "CREATING",
      },
    });
  } catch (err) {
    console.error("[project-create] Failed to create project record:", err);
    return NextResponse.json(
      { error: "Failed to create project. Please try again." },
      { status: 500 }
    );
  }

  try {
    await inngest.send({
      name: "project/create.requested",
      data: {
        projectId: project.id,
        userId: session.user.id,
        projectName: name,
        projectSlug: slug,
      },
    });
  } catch (err) {
    console.error("[project-create] Failed to trigger pipeline:", err);
    // Mark the project as errored since the pipeline won't run
    await prisma.project.update({
      where: { id: project.id },
      data: { status: "ERROR" },
    }).catch(() => {});
    return NextResponse.json(
      { error: "Project created but the build pipeline failed to start. Please check that Inngest is configured and try again." },
      { status: 500 }
    );
  }

  return NextResponse.json(project, { status: 201 });
}
