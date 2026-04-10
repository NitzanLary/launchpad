import { SUPABASE_POOLER_PORT } from "@launchpad/shared";

const SUPABASE_MANAGEMENT_API = "https://api.supabase.com";

/**
 * Supabase Management API client for LaunchPad operations.
 * Used for: project creation/deletion, database provisioning, credential retrieval.
 */
export class SupabaseClient {
  constructor(private accessToken: string) {}

  private async request<T>(
    path: string,
    options: RequestInit = {}
  ): Promise<T> {
    const response = await fetch(`${SUPABASE_MANAGEMENT_API}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Supabase API error ${response.status}: ${error}`);
    }

    return response.json();
  }

  /** List all projects on the user's Supabase account. */
  async listProjects(): Promise<
    Array<{
      id: string;
      name: string;
      organization_id: string;
      region: string;
      status: string;
    }>
  > {
    return this.request("/v1/projects");
  }

  /** Create a new Supabase project. */
  async createProject(
    name: string,
    organizationId: string,
    dbPassword: string,
    region = "us-east-1"
  ): Promise<{
    id: string;
    name: string;
    status: string;
    endpoint: string;
    anon_key: string;
    service_role_key: string;
  }> {
    return this.request("/v1/projects", {
      method: "POST",
      body: JSON.stringify({
        name,
        organization_id: organizationId,
        db_pass: dbPassword,
        region,
        plan: "free",
      }),
    });
  }

  /** Get project API keys. */
  async getProjectApiKeys(
    projectRef: string
  ): Promise<Array<{ name: string; api_key: string }>> {
    return this.request(`/v1/projects/${projectRef}/api-keys`);
  }

  /** Get project database connection info. */
  async getProjectDatabase(projectRef: string): Promise<{
    host: string;
    port: number;
    db_name: string;
    user: string;
  }> {
    return this.request(`/v1/projects/${projectRef}/database`);
  }

  /** Delete a Supabase project. */
  async deleteProject(projectRef: string): Promise<void> {
    await this.request(`/v1/projects/${projectRef}`, { method: "DELETE" });
  }

  /** Get user's organizations. */
  async listOrganizations(): Promise<
    Array<{ id: string; name: string }>
  > {
    return this.request("/v1/organizations");
  }

  /**
   * Validate that the user has enough free project slots.
   * Returns the count of existing active projects.
   */
  async countActiveProjects(): Promise<number> {
    const projects = await this.listProjects();
    // Filter to only active projects (not paused/removed)
    return projects.filter(
      (p) => p.status === "ACTIVE_HEALTHY" || p.status === "COMING_UP"
    ).length;
  }
}

/**
 * Build a Supabase DATABASE_URL using the Supavisor pooler.
 * Format per PRD Section 18.2: uses port 6543 with pgbouncer=true.
 */
export function buildDatabaseUrl(
  ref: string,
  password: string,
  region: string
): string {
  return `postgresql://postgres.${ref}:${encodeURIComponent(password)}@aws-0-${region}.pooler.supabase.com:${SUPABASE_POOLER_PORT}/postgres?pgbouncer=true&connection_limit=1`;
}
