# LaunchPad

Zero-config deployment platform for Claude Code projects. Users create a project, LaunchPad scaffolds a Next.js + Prisma + Supabase repo on their GitHub, wires it to Vercel and Supabase, and manages the full deploy pipeline (preview → staging → production) with database migrations, guardrails, and rollbacks.

Full product spec: `PRD_DeployPlatform.md` (read this before any major feature work).

## Tech Stack

- **Framework:** Next.js 15 (App Router) — TypeScript, Tailwind CSS v4, server components by default
- **Database:** Supabase Postgres via Prisma ORM
- **Auth:** Auth.js v5 (next-auth) with GitHub OAuth + Prisma adapter
- **Job Queue:** Inngest — durable multi-step pipelines, runs on Vercel serverless
- **Monorepo:** Turborepo + pnpm workspaces
- **CLI:** Commander.js, bundled with tsup
- **Testing:** Vitest (planned)
- **Hosting:** Vercel (Hobby tier)

## Monorepo Structure

```
apps/web/             → Next.js dashboard + API (the main app)
packages/shared/      → Types, constants, error messages (imported as @launchpad/shared)
packages/guards/      → Validation guard logic, shared by API + CLI (imported as @launchpad/guards)
packages/cli/         → CLI tool (`npx launchpad`), stubs only for now
```

## Key Directories (apps/web)

```
src/app/(auth)/              → Login page (GitHub OAuth)
src/app/(dashboard)/         → Authenticated pages: projects list, project detail, settings
src/app/api/auth/            → Auth.js route handler
src/app/api/projects/        → Project CRUD
src/app/api/webhooks/github/ → GitHub webhook receiver (HMAC-verified)
src/app/api/inngest/         → Inngest function handler

src/lib/auth.ts              → Auth.js config (GitHub provider, Prisma adapter)
src/lib/db.ts                → Prisma client singleton
src/lib/encryption.ts        → AES-256-GCM encrypt/decrypt for stored tokens
src/lib/cn.ts                → clsx + tailwind-merge utility
src/lib/inngest/client.ts    → Inngest client instance
src/lib/inngest/functions/   → Pipeline functions (project-create, preview, staging, production, cleanup)
src/lib/integrations/        → GitHub, Vercel, Supabase API clients
src/lib/template/            → Scaffolded project template generator (Handlebars + static files)

src/components/layout/       → Sidebar, header (dashboard shell)
src/components/ui/           → Reusable UI components (empty, add shadcn/ui components as needed)

prisma/schema.prisma         → LaunchPad's own database schema
```

## Database Schema

The Prisma schema at `apps/web/prisma/schema.prisma` defines LaunchPad's own data. Key models:

- **User** / **Account** / **Session** — Auth.js models
- **OAuthConnection** — Encrypted tokens for GitHub, Vercel, Supabase (separate from Auth.js Account)
- **Project** — User's LaunchPad project (name, slug, GitHub/Vercel IDs, status)
- **Environment** — Staging or Production env per project (Supabase creds, deploy state)
- **PreviewSchema** — Isolated Postgres schema per feature branch (max 5, 48h stale cleanup)
- **Deploy** — Central audit record for every pipeline run (status, git info, Vercel deploy ID)
- **GuardResult** — Per-deploy, per-guard validation result (PASS/WARN/BLOCK)
- **MigrationLog** — SQL applied per deploy
- **Extension** — Installed extensions (stripe, resend, upstash) with encrypted credentials

All sensitive data (tokens, passwords, API keys) is encrypted with AES-256-GCM via `src/lib/encryption.ts`. The encryption key is a 32-byte hex string in the `ENCRYPTION_KEY` env var.

## Inngest Pipelines

All background work runs as Inngest durable functions. Each function is a series of `step.run()` calls — independently retryable, each step runs in its own serverless invocation.

| Function | Trigger | What it does |
|---|---|---|
| `project-create` | `project/create.requested` | 11-step project scaffolding across GitHub, Supabase, Vercel |
| `pipeline-preview` | `deploy/preview.requested` | Guard check → create preview schema → prisma db push → Vercel preview deploy |
| `pipeline-staging` | `deploy/staging.requested` | Guard check → generate migration → apply → Vercel staging deploy |
| `pipeline-production` | `deploy/production.requested` | Pre-flight → migrate prod DB → promote Vercel build → health check |
| `cleanup-stale-previews` | Cron (hourly) | Drop preview schemas inactive > 48 hours |

Pipeline functions are in `src/lib/inngest/functions/`. The `project-create` function is fully implemented. Other pipelines have step structure with TODO placeholders.

## Implementation Status

Phase 0 (Foundation) is complete:
- Monorepo scaffold, all packages, dependency wiring
- Prisma schema defined and client generated
- Auth.js with GitHub OAuth
- Dashboard shell (sidebar, header, authenticated layout)
- Pages: landing, login, projects list, new project, project detail, settings
- API routes: projects CRUD, GitHub webhook handler, Inngest handler
- All 5 Inngest pipeline functions (scaffolded with step structure)
- AES-256-GCM encryption module
- Guard stubs (structure, config, migration, secret)

Phase 1 (OAuth Integrations) is complete:
- Vercel + Supabase OAuth flows (initiate, callback, disconnect)
- Token management with auto-refresh (`src/lib/tokens.ts`)
- Integration API clients (`src/lib/integrations/`)
- Settings page with connected accounts UI
- Supabase account validation (check free project slots)

Phase 2 (Project Creation) is complete:
- Full 11-step project creation pipeline (`src/lib/inngest/functions/project-create.ts`)
- Template generator (`src/lib/template/`) — generates all scaffold files with CLAUDE.md hash
- GitHubClient Git Trees API methods for bulk file push (single commit)
- Pre-creation validation (OAuth + Supabase slots) in POST /api/projects
- Per-project webhook secrets (encrypted, stored on Project model)
- DATABASE_URL builder utility using Supavisor pooler format
- Enhanced onFailure handler with Supabase/Vercel cleanup
- Supabase provisioning wait strategy (45s sleep + poll with retries)

What's next (see plan at `~/.claude/plans/nested-rolling-valley.md`):
- **Phase 3:** Guard implementations with tests
- **Phase 4:** Preview deploy pipeline (schema isolation, prisma db push, Vercel deploy)
- **Phase 5:** Staging deploy pipeline (migration generation + application)
- **Phase 6:** Production promotion + rollback
- **Phase 7:** CLI commands
- **Phase 8:** Extensions, drift guard, polish

## Commands

```bash
pnpm install                          # Install all dependencies
pnpm dev                              # Start all packages in dev mode (turbo)
cd apps/web && pnpm dev               # Start just the web app
cd apps/web && npx prisma generate    # Regenerate Prisma client after schema changes
cd apps/web && npx prisma db push     # Push schema to database
cd apps/web && npx next build         # Production build (use to verify compilation)
```

## Conventions

- **Server components by default.** Only add `"use client"` when you need interactivity (forms, state, effects).
- **API routes use Next.js Route Handlers** (`route.ts` files), not pages API routes.
- **All database access goes through Prisma** — import `prisma` from `@/lib/db`.
- **Auth checks:** Use `await auth()` from `@/lib/auth` in server components/route handlers. The dashboard layout already gates on session — individual pages can trust `session!.user!.id!`.
- **Shared types/constants** live in `@launchpad/shared`, not duplicated across packages.
- **Guards** are pure async functions with a `GuardContext` abstraction — they work against both local filesystem and GitHub API (via the `files` interface).
- **Encrypted fields** in the DB use `Bytes` type. Use `encrypt()`/`decrypt()` from `@/lib/encryption.ts`.
- **Inngest functions** use the step pattern: `step.run("step-name", async () => { ... })`. Each step must be idempotent.
- **Styling:** Tailwind utility classes directly in JSX. Dark theme. Use `cn()` from `@/lib/cn` for conditional classes.
- **No `.env` files in the repo.** Copy `.env.example` to `.env.local` for local development. Required vars: `DATABASE_URL`, `AUTH_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `ENCRYPTION_KEY`.

## Design Decisions

- **Inngest over BullMQ** — no Redis to manage; each pipeline step is a separate serverless invocation, stays under Vercel Hobby's 60s timeout.
- **OAuthConnection separate from Auth.js Account** — Auth.js manages sessions; OAuthConnection gives us fine-grained control over token encryption, refresh, and scopes for GitHub/Vercel/Supabase API calls.
- **Preview schemas, not preview databases** — Multiple branches share the staging Supabase project but each gets an isolated Postgres schema (`preview_feat_x`). Stays within free tier (2 Supabase projects total: staging + production).
- **Pipeline owns migrations** — Users run `prisma db push` locally. The pipeline runs `prisma migrate diff` + `prisma migrate deploy` on staging/production. No migration conflicts possible.
- **Vercel Hobby tier** — Platform starts on free tier. Upgrade to Pro only if 60s function timeout causes issues.
