import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/encryption";
import { inngest } from "@/lib/inngest/client";

function verifySignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  const expected = `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;

  try {
    return timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expected)
    );
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  const payload = await request.text();
  const signature = request.headers.get("x-hub-signature-256") ?? "";
  const event = request.headers.get("x-github-event");

  // Parse payload to extract repo ID (before signature check)
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(payload);
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const repoId = (body.repository as { id?: number })?.id;
  if (!repoId) {
    return NextResponse.json({ error: "Missing repository ID" }, { status: 400 });
  }

  // Look up project by GitHub repo ID to get per-project webhook secret
  const project = await prisma.project.findFirst({
    where: { githubRepoId: repoId, status: "ACTIVE" },
    select: { id: true, webhookSecretEnc: true },
  });

  if (!project || !project.webhookSecretEnc) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  // Decrypt and verify signature with per-project secret
  const webhookSecret = decrypt(new Uint8Array(project.webhookSecretEnc));
  if (!verifySignature(payload, signature, webhookSecret)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  if (event === "push") {
    return handlePush(body as unknown as PushPayload, project.id);
  }

  return NextResponse.json({ ok: true });
}

interface PushPayload {
  ref: string;
  repository: { id: number };
  head_commit: {
    id: string;
    message: string;
    author: { name: string };
  } | null;
  after: string;
}

async function handlePush(body: PushPayload, projectId: string) {
  const branch = body.ref.replace("refs/heads/", "");
  const commitSha = body.after;
  const commitMessage = body.head_commit?.message ?? "";
  const author = body.head_commit?.author?.name ?? "";

  const isMainBranch = branch === "main" || branch === "master";

  // Create a deploy record
  const deploy = await prisma.deploy.create({
    data: {
      projectId,
      type: isMainBranch ? "STAGING" : "PREVIEW",
      status: "PENDING",
      gitBranch: branch,
      gitCommitSha: commitSha,
      gitCommitMessage: commitMessage,
      gitAuthor: author,
    },
  });

  // Trigger the appropriate pipeline
  const eventName = isMainBranch
    ? "deploy/staging.requested"
    : "deploy/preview.requested";

  await inngest.send({
    name: eventName,
    data: {
      projectId,
      deployId: deploy.id,
      branch,
      commitSha,
    },
  });

  return NextResponse.json({ deployId: deploy.id }, { status: 202 });
}
