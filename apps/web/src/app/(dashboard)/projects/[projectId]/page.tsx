import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const session = await auth();

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      environments: true,
      previewSchemas: {
        where: { status: { not: "DELETED" } },
        orderBy: { createdAt: "desc" },
      },
      deploys: {
        orderBy: { createdAt: "desc" },
        take: 10,
        include: {
          guardResults: true,
        },
      },
    },
  });

  if (!project || project.userId !== session!.user!.id!) {
    notFound();
  }

  const staging = project.environments.find((e) => e.type === "STAGING");
  const production = project.environments.find((e) => e.type === "PRODUCTION");

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">{project.name}</h1>
          {project.githubRepoUrl && (
            <a
              href={project.githubRepoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 text-sm text-muted-foreground hover:text-primary"
            >
              {project.githubRepoUrl}
            </a>
          )}
        </div>
        <StatusBadge status={project.status} />
      </div>

      {/* Clone instructions for new projects */}
      {project.status === "ACTIVE" && project.githubRepoUrl && (
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-medium">Get started</h2>
          <code className="mt-2 block rounded-lg bg-background px-4 py-3 text-sm text-muted-foreground">
            git clone {project.githubRepoUrl}.git && cd {project.name} && npx
            launchpad dev
          </code>
        </div>
      )}

      {/* Environment cards */}
      <div className="grid gap-4 md:grid-cols-2">
        <EnvironmentCard
          title="Staging"
          environment={staging}
          promotable={false}
        />
        <EnvironmentCard
          title="Production"
          environment={production}
          promotable={
            !!staging?.lastDeployId &&
            staging.lastDeployId !== production?.lastDeployId
          }
        />
      </div>

      {/* Active previews */}
      {project.previewSchemas.length > 0 && (
        <div>
          <h2 className="mb-3 text-lg font-semibold">Active Previews</h2>
          <div className="space-y-2">
            {project.previewSchemas.map((preview) => (
              <div
                key={preview.id}
                className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3"
              >
                <div>
                  <span className="text-sm font-medium">
                    {preview.branchName}
                  </span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {preview.schemaName}
                  </span>
                </div>
                {preview.previewUrl && (
                  <a
                    href={preview.previewUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-primary hover:underline"
                  >
                    Open preview
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent deploys */}
      <div>
        <h2 className="mb-3 text-lg font-semibold">Recent Deploys</h2>
        {project.deploys.length === 0 ? (
          <p className="text-sm text-muted-foreground">No deploys yet</p>
        ) : (
          <div className="space-y-2">
            {project.deploys.map((deploy) => (
              <div
                key={deploy.id}
                className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <DeployStatusDot status={deploy.status} />
                  <div>
                    <span className="text-sm font-medium">
                      {deploy.gitBranch}
                    </span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {deploy.gitCommitMessage?.slice(0, 50)}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
                    {deploy.type.toLowerCase()}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(deploy.createdAt).toLocaleString()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function EnvironmentCard({
  title,
  environment,
  promotable,
}: {
  title: string;
  environment:
    | {
        currentUrl: string | null;
        migrationCount: number;
        lastDeployId: string | null;
      }
    | undefined;
  promotable: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">{title}</h3>
        {promotable && (
          <button className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90">
            Promote to Production
          </button>
        )}
      </div>
      {environment ? (
        <div className="mt-3 space-y-2 text-sm">
          {environment.currentUrl ? (
            <a
              href={environment.currentUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              {environment.currentUrl}
            </a>
          ) : (
            <span className="text-muted-foreground">Not deployed yet</span>
          )}
          <p className="text-xs text-muted-foreground">
            {environment.migrationCount} migrations applied
          </p>
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">Not configured</p>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    ACTIVE: "bg-green-500/10 text-green-400",
    CREATING: "bg-yellow-500/10 text-yellow-400",
    ERROR: "bg-red-500/10 text-red-400",
  };

  return (
    <span
      className={`rounded-full px-2.5 py-1 text-xs font-medium ${colors[status] ?? "bg-muted text-muted-foreground"}`}
    >
      {status.toLowerCase()}
    </span>
  );
}

function DeployStatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    SUCCESS: "bg-green-400",
    FAILED: "bg-red-400",
    BLOCKED: "bg-red-400",
    PENDING: "bg-yellow-400",
    VALIDATING: "bg-yellow-400",
    MIGRATING: "bg-yellow-400",
    DEPLOYING: "bg-blue-400",
    VERIFYING: "bg-blue-400",
  };

  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${colors[status] ?? "bg-muted-foreground"}`}
    />
  );
}
