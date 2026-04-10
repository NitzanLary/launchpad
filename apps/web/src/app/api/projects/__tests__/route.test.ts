import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies before importing
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    project: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
    },
  },
}));

vi.mock("@/lib/inngest/client", () => ({
  inngest: { send: vi.fn() },
}));

vi.mock("@/lib/tokens", () => ({
  hasConnection: vi.fn(),
  getProviderToken: vi.fn(),
}));

vi.mock("@/lib/integrations", () => ({
  SupabaseClient: vi.fn().mockImplementation(() => ({
    countActiveProjects: vi.fn(),
  })),
}));

import { POST } from "../route";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { inngest } from "@/lib/inngest/client";
import { hasConnection, getProviderToken } from "@/lib/tokens";
import { SupabaseClient } from "@/lib/integrations";

function makeRequest(body: Record<string, unknown>) {
  return new Request("https://example.com/api/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as Parameters<typeof POST>[0];
}

function setupPassingChecks() {
  vi.mocked(auth).mockResolvedValue({
    user: { id: "user1" },
  } as never);
  vi.mocked(prisma.project.findUnique).mockResolvedValue(null);
  vi.mocked(prisma.project.count).mockResolvedValue(0);
  vi.mocked(hasConnection).mockResolvedValue(true);
  vi.mocked(getProviderToken).mockResolvedValue({
    accessToken: "sb-token",
    providerAccountId: "sb-account",
  });

  const mockCountActive = vi.fn().mockResolvedValue(0);
  vi.mocked(SupabaseClient).mockImplementation(
    () => ({ countActiveProjects: mockCountActive } as never)
  );

  vi.mocked(prisma.project.create).mockResolvedValue({
    id: "proj1",
    name: "test-project",
    slug: "test-project",
    status: "CREATING",
  } as never);
  vi.mocked(inngest.send).mockResolvedValue(undefined as never);
}

describe("POST /api/projects", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("missing OAuth connection returns 400 with provider names", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "user1" } } as never);
    vi.mocked(prisma.project.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.project.count).mockResolvedValue(0);

    // GitHub and Vercel connected, Supabase not
    vi.mocked(hasConnection).mockImplementation(async (_userId, provider) => {
      if (provider === "SUPABASE") return false;
      return true;
    });

    const response = await POST(makeRequest({ name: "test-project" }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain("Supabase");
  });

  it("all connections missing lists all three", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "user1" } } as never);
    vi.mocked(prisma.project.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.project.count).mockResolvedValue(0);
    vi.mocked(hasConnection).mockResolvedValue(false);

    const response = await POST(makeRequest({ name: "test-project" }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain("GitHub");
    expect(body.error).toContain("Vercel");
    expect(body.error).toContain("Supabase");
  });

  it("Supabase with existing projects returns SUPABASE_SLOTS_FULL", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "user1" } } as never);
    vi.mocked(prisma.project.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.project.count).mockResolvedValue(0);
    vi.mocked(hasConnection).mockResolvedValue(true);
    vi.mocked(getProviderToken).mockResolvedValue({
      accessToken: "sb-token",
      providerAccountId: "sb-account",
    });

    const mockCountActive = vi.fn().mockResolvedValue(2);
    vi.mocked(SupabaseClient).mockImplementation(
      () => ({ countActiveProjects: mockCountActive } as never)
    );

    const response = await POST(makeRequest({ name: "test-project" }));
    const body = await response.json();

    expect(response.status).toBe(400);
    // Should contain the SUPABASE_SLOTS_FULL error message
    expect(body.error).toContain("Supabase");
    expect(body.error).toContain("free project slots");
  });

  it("Supabase token failure returns descriptive error", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "user1" } } as never);
    vi.mocked(prisma.project.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.project.count).mockResolvedValue(0);
    vi.mocked(hasConnection).mockResolvedValue(true);
    vi.mocked(getProviderToken).mockRejectedValue(new Error("token expired"));

    const response = await POST(makeRequest({ name: "test-project" }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain("reconnect Supabase");
  });

  it("successful validation proceeds to create project", async () => {
    setupPassingChecks();

    const response = await POST(makeRequest({ name: "test-project" }));

    expect(response.status).toBe(201);
    expect(inngest.send).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "project/create.requested",
      })
    );
  });
});
