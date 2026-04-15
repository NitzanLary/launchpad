const GITHUB_API = "https://api.github.com";

/**
 * GitHub API client for LaunchPad operations.
 * Used for: repo creation, file pushing, webhook management.
 */
export class GitHubClient {
  constructor(private accessToken: string) {}

  private async request<T>(
    path: string,
    options: RequestInit = {}
  ): Promise<T> {
    const response = await fetch(`${GITHUB_API}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`GitHub API error ${response.status}: ${error}`);
    }

    return response.json();
  }

  /** Get the authenticated user's profile. */
  async getUser(): Promise<{ login: string; id: number; avatar_url: string }> {
    return this.request("/user");
  }

  /**
   * Create a new repository under the authenticated user.
   * `auto_init: true` is required so the repo has an initial commit — the
   * Git DB API (/git/blobs, /git/trees, …) returns 409 "Git Repository is
   * empty." on repos with zero commits, which breaks pushFiles otherwise.
   */
  async createRepo(
    name: string,
    isPrivate = true
  ): Promise<{
    id: number;
    full_name: string;
    html_url: string;
    clone_url: string;
    default_branch: string;
  }> {
    return this.request("/user/repos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, private: isPrivate, auto_init: true }),
    });
  }

  /** Register a webhook on a repository. */
  async createWebhook(
    owner: string,
    repo: string,
    webhookUrl: string,
    secret: string
  ): Promise<{ id: number }> {
    return this.request(`/repos/${owner}/${repo}/hooks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        config: {
          url: webhookUrl,
          content_type: "json",
          secret,
          insecure_ssl: "0",
        },
        events: ["push", "pull_request"],
        active: true,
      }),
    });
  }

  /** Push file contents to a repository (create or update). */
  async putFileContents(
    owner: string,
    repo: string,
    path: string,
    content: string,
    message: string,
    sha?: string
  ): Promise<{ content: { sha: string } }> {
    return this.request(`/repos/${owner}/${repo}/contents/${path}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        content: Buffer.from(content).toString("base64"),
        ...(sha ? { sha } : {}),
      }),
    });
  }

  // ─── Git Trees API (bulk file operations) ──────────────────────────────────

  /** Create a blob in the repo's Git database. */
  async createBlob(
    owner: string,
    repo: string,
    content: string
  ): Promise<{ sha: string }> {
    return this.request(`/repos/${owner}/${repo}/git/blobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, encoding: "utf-8" }),
    });
  }

  /** Create a tree object in the repo's Git database. */
  async createTree(
    owner: string,
    repo: string,
    tree: Array<{ path: string; mode: string; type: string; sha: string }>,
    baseTree?: string
  ): Promise<{ sha: string }> {
    return this.request(`/repos/${owner}/${repo}/git/trees`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tree, ...(baseTree ? { base_tree: baseTree } : {}) }),
    });
  }

  /** Read a Git reference (e.g. "heads/main"). */
  async getRef(
    owner: string,
    repo: string,
    ref: string
  ): Promise<{ object: { sha: string } }> {
    return this.request(`/repos/${owner}/${repo}/git/refs/${ref}`);
  }

  /** Read a commit object by SHA. */
  async getCommit(
    owner: string,
    repo: string,
    sha: string
  ): Promise<{ sha: string; tree: { sha: string } }> {
    return this.request(`/repos/${owner}/${repo}/git/commits/${sha}`);
  }

  /** Fast-forward an existing Git reference to a new commit SHA. */
  async updateRef(
    owner: string,
    repo: string,
    ref: string,
    sha: string,
    force = false
  ): Promise<void> {
    await this.request(`/repos/${owner}/${repo}/git/refs/${ref}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sha, force }),
    });
  }

  /** Create a commit object in the repo's Git database. */
  async createCommitObject(
    owner: string,
    repo: string,
    message: string,
    treeSha: string,
    parents: string[]
  ): Promise<{ sha: string }> {
    return this.request(`/repos/${owner}/${repo}/git/commits`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, tree: treeSha, parents }),
    });
  }

  /** Create a Git reference (branch pointer). */
  async createRef(
    owner: string,
    repo: string,
    ref: string,
    sha: string
  ): Promise<void> {
    await this.request(`/repos/${owner}/${repo}/git/refs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ref, sha }),
    });
  }

  /**
   * Push multiple files to a repo in a single commit using the Git Trees API.
   *
   * Requires the repo to have at least one commit (created via auto_init or a
   * prior push). GitHub's /git/blobs endpoint returns 409 on truly empty
   * repos, so createRepo now uses auto_init: true.
   *
   * The new commit is built on top of the existing main tip and merged with
   * the existing tree via base_tree, so auto_init's README.md survives unless
   * the pushed files explicitly override it.
   */
  async pushFiles(
    owner: string,
    repo: string,
    files: Array<{ path: string; content: string }>,
    message: string
  ): Promise<void> {
    if (files.length === 0) return;

    const mainRef = await this.getRef(owner, repo, "heads/main");
    const parentCommitSha = mainRef.object.sha;
    const parentCommit = await this.getCommit(owner, repo, parentCommitSha);
    const baseTreeSha = parentCommit.tree.sha;

    const blobs = await Promise.all(
      files.map(async (file) => {
        const blob = await this.createBlob(owner, repo, file.content);
        return { path: file.path, sha: blob.sha };
      })
    );

    const tree = blobs.map((blob) => ({
      path: blob.path,
      mode: "100644" as const,
      type: "blob" as const,
      sha: blob.sha,
    }));

    const treeResult = await this.createTree(owner, repo, tree, baseTreeSha);

    const commit = await this.createCommitObject(
      owner,
      repo,
      message,
      treeResult.sha,
      [parentCommitSha]
    );

    await this.updateRef(owner, repo, "heads/main", commit.sha);
  }

  /** Delete a repository. */
  async deleteRepo(owner: string, repo: string): Promise<void> {
    await this.request(`/repos/${owner}/${repo}`, { method: "DELETE" });
  }
}
