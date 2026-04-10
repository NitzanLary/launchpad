import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GitHubClient } from "../github";

describe("GitHubClient", () => {
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

  it("createBlob sends correct request", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ sha: "blob-sha-123" }),
    });

    const client = new GitHubClient("test-token");
    const result = await client.createBlob("owner", "repo", "file content");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/repos/owner/repo/git/blobs",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ content: "file content", encoding: "utf-8" }),
      })
    );

    // Verify Authorization header
    const callArgs = fetchMock.mock.calls[0];
    expect(callArgs[1].headers.Authorization).toBe("Bearer test-token");

    expect(result.sha).toBe("blob-sha-123");
  });

  it("createTree sends correct request", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({ sha: "tree-sha" }),
    });

    const client = new GitHubClient("test-token");
    const tree = [
      { path: "file.txt", mode: "100644", type: "blob", sha: "abc" },
    ];
    await client.createTree("owner", "repo", tree);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/repos/owner/repo/git/trees",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ tree }),
      })
    );
  });

  it("createCommitObject sends correct request", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ sha: "commit-sha" }),
    });

    const client = new GitHubClient("test-token");
    await client.createCommitObject(
      "owner",
      "repo",
      "commit msg",
      "tree-sha",
      []
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/repos/owner/repo/git/commits",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          message: "commit msg",
          tree: "tree-sha",
          parents: [],
        }),
      })
    );
  });

  it("createRef sends correct request", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({}),
    });

    const client = new GitHubClient("test-token");
    await client.createRef("owner", "repo", "refs/heads/main", "commit-sha");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/repos/owner/repo/git/refs",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          ref: "refs/heads/main",
          sha: "commit-sha",
        }),
      })
    );
  });

  it("pushFiles orchestrates blob -> tree -> commit -> ref", async () => {
    // Mock sequential responses: 2 blobs, 1 tree, 1 commit, 1 ref
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ sha: "blob-sha-1" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ sha: "blob-sha-2" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ sha: "tree-sha" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ sha: "commit-sha" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      });

    const client = new GitHubClient("test-token");
    await client.pushFiles(
      "owner",
      "repo",
      [
        { path: "a.txt", content: "aaa" },
        { path: "b.txt", content: "bbb" },
      ],
      "test commit"
    );

    // At least 5 calls: 2 blobs + 1 tree + 1 commit + 1 ref
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(5);

    // Verify tree call includes both blobs with correct mode and type
    const treeCalls = fetchMock.mock.calls.filter((c: [string, RequestInit]) =>
      c[0].includes("/git/trees")
    );
    expect(treeCalls.length).toBe(1);
    const treeBody = JSON.parse(treeCalls[0][1].body as string);
    expect(treeBody.tree).toHaveLength(2);
    expect(treeBody.tree[0].mode).toBe("100644");
    expect(treeBody.tree[0].type).toBe("blob");
    expect(treeBody.tree[1].mode).toBe("100644");
    expect(treeBody.tree[1].type).toBe("blob");

    // Verify commit call has parents: []
    const commitCalls = fetchMock.mock.calls.filter(
      (c: [string, RequestInit]) => c[0].includes("/git/commits")
    );
    expect(commitCalls.length).toBe(1);
    const commitBody = JSON.parse(commitCalls[0][1].body as string);
    expect(commitBody.parents).toEqual([]);

    // Verify ref call creates refs/heads/main
    const refCalls = fetchMock.mock.calls.filter((c: [string, RequestInit]) =>
      c[0].includes("/git/refs")
    );
    expect(refCalls.length).toBe(1);
    const refBody = JSON.parse(refCalls[0][1].body as string);
    expect(refBody.ref).toBe("refs/heads/main");
  });

  it("deleteRepo sends DELETE request", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({}),
    });

    const client = new GitHubClient("test-token");
    await client.deleteRepo("owner", "repo");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/repos/owner/repo",
      expect.objectContaining({ method: "DELETE" })
    );
  });

  it("API error throws with status and body", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 422,
      text: () => Promise.resolve("Validation Failed"),
    });

    const client = new GitHubClient("test-token");
    await expect(client.createRepo("name")).rejects.toThrow("422");
    // Re-mock for the second assertion
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 422,
      text: () => Promise.resolve("Validation Failed"),
    });
    await expect(client.createRepo("name")).rejects.toThrow(
      "Validation Failed"
    );
  });
});
