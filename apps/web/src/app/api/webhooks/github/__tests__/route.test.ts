import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "crypto";
import fs from "fs";
import path from "path";

// Mock dependencies before importing the route
vi.mock("@/lib/db", () => ({
  prisma: {
    project: { findFirst: vi.fn() },
    deploy: { create: vi.fn() },
  },
}));

vi.mock("@/lib/inngest/client", () => ({
  inngest: { send: vi.fn() },
}));

vi.mock("@/lib/encryption", () => ({
  decrypt: vi.fn(),
}));

import { POST } from "../route";
import { prisma } from "@/lib/db";
import { inngest } from "@/lib/inngest/client";
import { decrypt } from "@/lib/encryption";

function makePayload(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    repository: { id: 12345 },
    ref: "refs/heads/main",
    after: "abc123",
    head_commit: { id: "abc", message: "test", author: { name: "user" } },
    ...overrides,
  });
}

function makeRequest(payload: string, signature: string) {
  return new Request("https://example.com/api/webhooks/github", {
    method: "POST",
    headers: {
      "x-hub-signature-256": signature,
      "x-github-event": "push",
      "content-type": "application/json",
    },
    body: payload,
  }) as unknown as Parameters<typeof POST>[0];
}

describe("Webhook Handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("verifySignature accepts correct HMAC", async () => {
    const secret = "test-secret-hex";
    const payload = makePayload();
    const sig = `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;

    vi.mocked(prisma.project.findFirst).mockResolvedValue({
      id: "proj1",
      webhookSecretEnc: Buffer.from("encrypted"),
    } as never);
    vi.mocked(decrypt).mockReturnValue(secret);
    vi.mocked(prisma.deploy.create).mockResolvedValue({ id: "deploy1" } as never);
    vi.mocked(inngest.send).mockResolvedValue(undefined as never);

    const response = await POST(makeRequest(payload, sig));
    expect(response.status).toBe(202);
  });

  it("invalid signature returns 401", async () => {
    const secret = "test-secret-hex";
    const payload = makePayload();

    vi.mocked(prisma.project.findFirst).mockResolvedValue({
      id: "proj1",
      webhookSecretEnc: Buffer.from("encrypted"),
    } as never);
    vi.mocked(decrypt).mockReturnValue(secret);

    const response = await POST(makeRequest(payload, "sha256=wrong"));
    expect(response.status).toBe(401);
  });

  it("missing repository ID returns 400", async () => {
    const payload = JSON.stringify({ ref: "refs/heads/main" });
    const response = await POST(makeRequest(payload, "sha256=whatever"));
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.error).toBe("Missing repository ID");
  });

  it("unknown repo ID returns 404", async () => {
    const payload = makePayload();
    vi.mocked(prisma.project.findFirst).mockResolvedValue(null);

    const response = await POST(makeRequest(payload, "sha256=whatever"));
    expect(response.status).toBe(404);
  });

  it("does NOT read from process.env.GITHUB_WEBHOOK_SECRET", () => {
    const sourceFile = fs.readFileSync(
      path.resolve(__dirname, "../route.ts"),
      "utf-8"
    );
    expect(sourceFile).not.toContain("process.env.GITHUB_WEBHOOK_SECRET");
  });
});
