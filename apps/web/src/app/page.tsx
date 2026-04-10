import Link from "next/link";

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 p-8">
      <div className="text-center">
        <h1 className="text-5xl font-bold tracking-tight">
          Launch<span className="text-primary">Pad</span>
        </h1>
        <p className="mt-4 text-lg text-muted-foreground">
          Zero-config deployment for Claude Code projects
        </p>
      </div>
      <Link
        href="/login"
        className="rounded-lg bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
      >
        Get Started
      </Link>
    </div>
  );
}
