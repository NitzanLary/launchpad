const VERCEL_API = "https://api.vercel.com";

/**
 * Vercel API client for LaunchPad operations.
 * Used for: project creation, deployment management, env var injection.
 */
export class VercelClient {
  constructor(private accessToken: string) {}

  private async request<T>(
    path: string,
    options: RequestInit = {}
  ): Promise<T> {
    const response = await fetch(`${VERCEL_API}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
        ...options.headers,
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
