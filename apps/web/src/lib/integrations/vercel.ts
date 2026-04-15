const VERCEL_API = "https://api.vercel.com";

/**
 * Vercel API client for LaunchPad operations.
 * Used for: project creation, deployment management, env var injection.
 *
 * Integration OAuth tokens are team-scoped — pass `teamId` (from the
 * token response's `team_id`) so every request targets the correct team.
 */
export class VercelClient {
  constructor(private accessToken: string, private teamId?: string) {}

  private async request<T>(
    path: string,
    options: RequestInit & { skipTeamId?: boolean; query?: Record<string, string> } = {}
  ): Promise<T> {
    const { skipTeamId, query, ...fetchOptions } = options;
    const url = new URL(`${VERCEL_API}${path}`);
    if (this.teamId && !skipTeamId) {
      url.searchParams.set("teamId", this.teamId);
    }
    if (query) {
      for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    }

    const response = await fetch(url.toString(), {
      ...fetchOptions,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
        ...fetchOptions.headers,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Vercel API error ${response.status}: ${error}`);
    }

    return response.json();
  }

  /** Get the authenticated user or team info. */
  async getUser(): Promise<{ user: { id: string; username: string; name: string } }> {
    return this.request("/v2/user");
  }

  /** List all projects. */
  async listProjects(): Promise<{ projects: Array<{ id: string; name: string }> }> {
    return this.request("/v9/projects");
  }

  /**
   * List Git namespaces (installed Git provider accounts) visible to this token.
   * User-scoped endpoint — must omit `teamId`.
   */
  async listGitNamespaces(
    provider: "github" | "gitlab" | "bitbucket" = "github"
  ): Promise<Array<{ id: number | string; provider: string; name?: string }>> {
    const result = await this.request<
      Array<{ id: number | string; provider: string; name?: string }>
    >("/v1/integrations/git-namespaces", {
      skipTeamId: true,
      query: { provider },
    });
    if (!Array.isArray(result)) {
      throw new Error(
        `Unexpected git-namespaces response shape: ${JSON.stringify(result)}`
      );
    }
    return result;
  }

  /**
   * Check if the Vercel account has the GitHub integration (Vercel GitHub App) installed.
   * Returns true/false when known, or null when detection failed (don't show a warning).
   */
  async hasGitHubIntegration(): Promise<boolean | null> {
    try {
      const namespaces = await this.listGitNamespaces("github");
      return namespaces.some((ns) => ns.provider.startsWith("github"));
    } catch (err) {
      console.error("[vercel.hasGitHubIntegration] request failed:", err);
      return null;
    }
  }

  /**
   * Search for repos visible to the Vercel Git integration for a given namespace.
   * Used to verify a newly-created GitHub repo has been picked up by Vercel's
   * GitHub App cache before trying to link it to a Vercel project.
   */
  async searchGitRepo(params: {
    namespaceId: number | string;
    query: string;
    provider?: "github" | "gitlab" | "bitbucket";
  }): Promise<
    Array<{ id: number; slug: string; name: string; namespace: string; url: string }>
  > {
    const result = await this.request<{
      repos?: Array<{
        id: number;
        slug: string;
        name: string;
        namespace: string;
        url: string;
      }>;
    }>("/v1/integrations/search-repo", {
      skipTeamId: true,
      query: {
        provider: params.provider ?? "github",
        namespaceId: String(params.namespaceId),
        query: params.query,
      },
    });
    return result.repos ?? [];
  }

  /**
   * Create a new project linked to a GitHub repo.
   * Prefer `repoId` (numeric GitHub repo id) over `repo` (full name) — the
   * numeric id bypasses slug resolution against Vercel's cached namespace list,
   * which is unreliable for very recently created repos.
   */
  async createProject(
    name: string,
    gitRepo: { repoId: number } | { repoFullName: string }
  ): Promise<{ id: string; name: string }> {
    const gitRepository =
      "repoId" in gitRepo
        ? { type: "github" as const, repoId: gitRepo.repoId }
        : { type: "github" as const, repo: gitRepo.repoFullName };

    return this.request("/v10/projects", {
      method: "POST",
      body: JSON.stringify({
        name,
        framework: "nextjs",
        gitRepository,
      }),
    });
  }

  /** Set environment variables on a project. */
  async setEnvVars(
    projectId: string,
    envVars: Array<{
      key: string;
      value: string;
      target: ("production" | "preview" | "development")[];
      type?: "encrypted" | "plain";
    }>
  ): Promise<void> {
    await this.request(`/v10/projects/${projectId}/env`, {
      method: "POST",
      body: JSON.stringify(envVars),
    });
  }

  /** Trigger a new deployment. */
  async createDeployment(
    projectId: string,
    ref: string,
    target?: "production" | "preview"
  ): Promise<{ id: string; url: string; readyState: string }> {
    return this.request("/v13/deployments", {
      method: "POST",
      body: JSON.stringify({
        name: projectId,
        target: target || "preview",
        gitSource: { type: "github", ref },
      }),
    });
  }

  /** Get deployment status. */
  async getDeployment(
    deploymentId: string
  ): Promise<{ id: string; url: string; readyState: string }> {
    return this.request(`/v13/deployments/${deploymentId}`);
  }

  /** Delete a Vercel project. Used for cleanup on pipeline failure. */
  async deleteProject(projectId: string): Promise<void> {
    await this.request(`/v9/projects/${projectId}`, { method: "DELETE" });
  }
}
