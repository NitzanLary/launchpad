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
   * Check if the Vercel account has the GitHub integration (Vercel GitHub App) installed.
   * Returns true/false when known, or null when detection failed (don't show a warning).
   *
   * The `git-namespaces` endpoint is user-scoped (not team-scoped) per the Vercel
   * OpenAPI spec — its only query params are `host` and `provider`. Passing `teamId`
   * causes Vercel to return an empty array, which is why the previous version always
   * said "not connected" even when the app was installed.
   */
  async hasGitHubIntegration(): Promise<boolean | null> {
    try {
      const namespaces = await this.request<
        Array<{ provider: string }> | { error?: unknown }
      >("/v1/integrations/git-namespaces", {
        skipTeamId: true,
        query: { provider: "github" },
      });
      if (!Array.isArray(namespaces)) {
        console.error(
          "[vercel.hasGitHubIntegration] unexpected response shape:",
          namespaces
        );
        return null;
      }
      return namespaces.some((ns) => ns.provider.startsWith("github"));
    } catch (err) {
      console.error("[vercel.hasGitHubIntegration] request failed:", err);
      return null;
    }
  }

  /** Create a new project linked to a GitHub repo. */
  async createProject(
    name: string,
    githubRepoFullName: string
  ): Promise<{ id: string; name: string }> {
    return this.request("/v10/projects", {
      method: "POST",
      body: JSON.stringify({
        name,
        framework: "nextjs",
        gitRepository: {
          type: "github",
          repo: githubRepoFullName,
        },
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
