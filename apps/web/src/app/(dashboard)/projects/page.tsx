import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

export default async function ProjectsPage() {
  const session = await auth();
  const projects = await prisma.project.findMany({
    where: { userId: session!.user!.id!, status: { not: "DELETED" } },
    orderBy: { createdAt: "desc" },
    include: {
      environments: true,
      _count: { select: { deploys: true } },
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Projects</h1>
        <Link
          href="/projects/new"
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          New Project
        </Link>
      </div>

      {projects.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-16">
          <p className="text-lg font-medium">No projects yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Create your first project to get started
          </p>
          <Link
            href="/projects/new"
            className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            New Project
          </Link>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => {
            const staging = project.environments.find(
              (e) => e.type === "STAGING"
            );
            const production = project.environments.find(
              (e) => e.type === "PRODUCTION"
            );

            return (
              <Link
                key={project.id}
                href={`/projects/${project.id}`}
                className="group rounded-xl border border-border bg-card p-5 transition-colors hover:border-primary/50"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="font-semibold group-hover:text-primary">
                      {project.name}
                    </h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {project._count.deploys} deploys
                    </p>
                  </div>
                  <StatusBadge status={project.status} />
                </div>
                <div className="mt-4 flex gap-4 text-xs text-muted-foreground">
                  {staging?.currentUrl && (
                    <span>Staging: live</span>
                  )}
                  {production?.currentUrl && (
                    <span>Production: live</span>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    ACTIVE: "bg-green-500/10 text-green-400",
    CREATING: "bg-yellow-500/10 text-yellow-400",
    ERROR: "bg-red-500/10 text-red-400",
    DELETING: "bg-red-500/10 text-red-400",
  };

  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${colors[status] ?? "bg-muted text-muted-foreground"}`}
    >
      {status.toLowerCase()}
    </span>
  );
}
