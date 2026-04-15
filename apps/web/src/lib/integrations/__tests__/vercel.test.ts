import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { VercelClient } from "../vercel";

describe("VercelClient", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const originalFetch = global.fetch;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
      text: () => Promise.resolve(""),
    });
    global.fetch = fetchMock;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("deleteProject sends DELETE to correct URL with teamId", async () => {
    const client = new VercelClient("test-token", "team_abc");
    await client.deleteProject("prj_abc123");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.vercel.com/v9/projects/prj_abc123?teamId=team_abc",
      expect.objectContaining({ method: "DELETE" })
    );

    const callArgs = fetchMock.mock.calls[0];
    expect(callArgs[1].headers.Authorization).toBe("Bearer test-token");
  });
});
