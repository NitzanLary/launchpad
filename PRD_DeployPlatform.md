# LaunchPad — Product Requirements Document

## Zero-Config Deployment Platform for Claude Code Projects

**Version:** 0.1 (MVP)
**Author:** Nitzan
**Last Updated:** April 2026
**Status:** Draft

---

## 1. Vision

LaunchPad is a deployment platform for developers who build with Claude Code and don't want to think about infrastructure. The user creates a project, clones a repo, builds with Claude Code, and pushes. LaunchPad handles everything else — database provisioning, environment management, deploys, migrations, and rollbacks — with zero manual configuration.

Think of it as "Lovable meets Claude Code": the creative freedom of a local AI coding agent, with the operational simplicity of a fully managed platform.

## 2. Target User

**Primary:** "Vibe coders" — developers building with AI-assisted tools (primarily Claude Code) who have limited or no experience with DevOps, CI/CD, database administration, or cloud infrastructure. They can build features but get stuck when it's time to ship.

**Secondary:** Experienced developers who want to skip boilerplate setup for new projects and go from idea to production in minutes.

## 3. Core Principles

- **Greenfield only.** LaunchPad creates the project from a controlled template. It does not retrofit existing repos. This constraint is what makes zero-config possible.
- **The CLAUDE.md is the control plane.** A platform-managed instruction file guides Claude Code's behavior, enforcing conventions that keep the project deployable.
- **Users never open Vercel, Supabase, or GitHub settings.** Every interaction with those services is abstracted behind LaunchPad's dashboard and pipeline.
- **Fail clearly, not silently.** When something breaks the deploy contract, the user gets a human-readable explanation and a suggested fix — not a stack trace.

## 4. MVP Stack (Fixed, Opinionated)

| Layer | Technology | Rationale |
|---|---|---|
| Framework | Next.js 14 (App Router) | Dominant choice in the Claude Code ecosystem; Vercel-native |
| Database | Supabase (Postgres) | Generous free tier, good API, familiar to target audience |
| ORM | Prisma | Strong migration system, readable schema, Claude Code handles it well |
| Hosting | Vercel | Seamless Next.js deploys, preview URLs, environment support |
| Source Control | GitHub | Universal; webhook system is mature |
| AI Agent | Claude Code | Reads CLAUDE.md, follows project conventions |

No other stacks are supported in MVP. Expansion comes later.

## 5. User Journey

### 5.1 Onboarding (One-Time)

1. User signs up on LaunchPad (email or GitHub SSO).
2. OAuth flow connects three services:
   - **GitHub** — grants repo creation and webhook access.
   - **Vercel** — grants project creation, deploy, and env var management.
   - **Supabase** — grants project creation and database management.
3. **Supabase account validation:** LaunchPad checks the user's Supabase account via the Management API. The user must have **0 existing projects** to proceed, since the Supabase free tier allows a maximum of 2 active projects and LaunchPad will create exactly 2 (staging and production). If existing projects are found, the user is shown: *"Your Supabase account already has projects. LaunchPad needs 2 free project slots (for staging and production). Please delete existing projects or upgrade your Supabase plan, then try again."*
4. All tokens are stored encrypted. The user never provides API keys manually.
5. User lands on the LaunchPad dashboard.

### 5.2 Project Creation

User clicks **"New Project"** and provides only a project name (e.g., `my-cool-app`).

LaunchPad performs the following automatically:

**GitHub:**
- Creates repo `user/my-cool-app`.
- Pushes the scaffolded template (see Section 6).
- Registers a webhook to listen for push and merge events.

**Supabase:**
- Creates `my-cool-app-staging` project (used for both staging and preview environments).
- Creates `my-cool-app-prod` project (production only).
- This consumes the user's entire Supabase free tier (2/2 projects). LaunchPad enforces a **one project per user** limit on the platform to stay within this constraint.
- Stores all connection strings, anon keys, and service role keys.

**Vercel:**
- Creates a Vercel project linked to the GitHub repo.
- Configures two environments:
  - **Preview + Staging** → `my-cool-app-staging` Supabase credentials.
  - **Production** → `my-cool-app-prod` Supabase credentials.
- Injects the correct Supabase credentials into each environment.

**LaunchPad DB:**
- Stores the project record mapping all external IDs, tokens, environment configs, and metadata.

The user sees: *"my-cool-app — Ready. Clone and start building."* along with the git clone command and instructions to open Claude Code.

### 5.3 Building (Claude Code)

The user clones the repo, opens the directory, and runs `claude`. Claude Code reads the `CLAUDE.md` at session start and follows the project conventions.

The user builds features entirely through conversation with Claude Code. LaunchPad is invisible during this phase. The user's workflow is:

```
"Build me a todo app with auth"
→ Claude Code creates pages, API routes, Prisma models
→ Claude Code runs `npx prisma db push` (applies schema to staging DB)
→ User tests locally via `npx launchpad dev`
→ git add, commit, push
```

LaunchPad's pipeline handles proper migration generation and application on deploy. The user never manages migrations directly.

### 5.4 Push → Preview Deploy

Every push to a non-main branch triggers the LaunchPad pipeline:

1. **Preview slot check** — verify the user has fewer than 5 active preview schemas. If at the limit, block with a clear message.
2. **Validate** — check project structure, config integrity, schema parsability (see Section 8).
3. **Database** — preview deploys share the **staging Supabase project**. LaunchPad creates an isolated schema (e.g., `preview_feat_todo_app`) within the staging database, applies the current `prisma/schema.prisma` to it via `prisma db push` (since previews are ephemeral, formal migrations aren't needed), and applies seed data. The connection string uses the format: `postgresql://user:pass@host:6543/postgres?schema=preview_feat_todo_app&pgbouncer=true&connection_limit=1`
4. **Deploy** — trigger Vercel preview deployment with env vars pointing to the staging Supabase instance (with the preview schema's connection string).
5. **Report** — update the LaunchPad dashboard with preview URL, build status, migration count, and any warnings.

If validation fails, the deploy is blocked and the dashboard displays a clear, actionable message. Stale preview schemas (branches inactive for 48+ hours) are automatically cleaned up.

> **Note on preview schema isolation:** Multiple preview branches share the same staging Supabase project but use separate Postgres schemas. This keeps the user within Supabase free tier limits while providing real data isolation between previews. A maximum of **5 concurrent preview schemas** is enforced on the free tier to stay within connection pool limits. Schemas are cleaned up when the branch is merged, deleted, or goes stale.

### 5.5 Merge → Staging

When a PR is merged into `main` (or the user clicks "Deploy to Staging" in the dashboard):

1. **Validate** — same structural checks.
2. **Migration generation** — LaunchPad compares the committed `prisma/schema.prisma` against the current staging DB state (default `public` schema). If there are differences, the pipeline generates a migration using `prisma migrate diff`, creates the migration file, and applies it via `prisma migrate deploy`. This means the **pipeline owns migration history**, not the user. Generated migration files are committed back to the repo automatically.
3. **Deploy** — Vercel deploys to the staging environment. Env vars point to the staging Supabase instance (default `public` schema).
4. **Cleanup** — drop the preview schema (`preview_feat_*`) from the staging database.
5. **Report** — dashboard shows staging URL, migration status, and a "Promote to Production" button.

> **Note on migration ownership:** Since users apply schema changes locally via `prisma db push` (which doesn't create migration files), LaunchPad's pipeline is the single source of truth for migration history. This eliminates migration conflicts entirely — no two developers can create conflicting migration files because no developer creates them at all.

### 5.6 Promote → Production

User clicks **"Promote to Production"** in the dashboard:

1. **Pre-flight** — snapshot current prod state for rollback. Compare staging vs prod migration history. Show the user a plain-language summary of what will change (e.g., "2 new migrations, 1 new table, 0 destructive changes").
2. **User confirms.**
3. **Migrate** — run pending migrations on the production Supabase database.
4. **Deploy** — Vercel promotes the staging build artifact to production. No rebuild needed.
5. **Verify** — health check against the production URL.
6. **Report** — dashboard shows production URL, deploy timestamp, and a "Rollback" option available for 24 hours.

If the health check fails, the user is prompted to roll back immediately.

## 6. Scaffolded Template

When a project is created, LaunchPad pushes the following structure to the new repo:

```
my-cool-app/
├── src/
│   ├── app/
│   │   ├── layout.tsx          # Root layout with Supabase provider
│   │   ├── page.tsx            # Landing page placeholder
│   │   └── api/                # API route directory
│   └── lib/
│       ├── supabase.ts         # Pre-configured Supabase client (browser)
│       ├── supabase-server.ts  # Pre-configured Supabase client (server)
│       └── prisma.ts           # Prisma client singleton
├── prisma/
│   └── schema.prisma           # Base schema with datasource config
├── supabase/
│   └── seed.sql                # Optional seed data (empty by default)
├── public/
├── CLAUDE.md                   # AI agent instructions (platform-managed)
├── .launchpad/
│   ├── config.json             # Platform metadata (system-managed, do not edit)
│   └── validators/             # Optional custom validation scripts
├── vercel.json                 # Minimal Vercel config
├── package.json                # Deps pre-installed
├── tsconfig.json
├── .gitignore                  # Includes .env*, node_modules, .next
└── README.md                   # Auto-generated with project info
```

Key files are described in detail below.

### 6.1 CLAUDE.md

This is the most critical file in the system. It is the bridge between LaunchPad and Claude Code.

The file is divided into two zones separated by a clear delimiter:
- **Platform zone** (above the delimiter) — managed by LaunchPad. Users should not modify this section. If modified, the pipeline warns but does **not** auto-restore; the user is expected to fix it.
- **User zone** (below the delimiter) — fully owned by the user. They can add any custom instructions for Claude Code here: coding style, project-specific conventions, architectural notes, etc.

```markdown
# LaunchPad Project: {{project_name}}
# Managed by LaunchPad — do not delete or rename this file.

## Stack
- Framework: Next.js 14 (App Router)
- Database: Supabase (Postgres) via Prisma ORM
- Hosting: Vercel (managed by LaunchPad)

## Project Structure
/src/app/           → Pages and layouts (App Router)
/src/app/api/       → API Route Handlers
/src/lib/           → Shared utilities (Supabase clients, Prisma client)
/prisma/schema.prisma → Database schema (single source of truth)
/prisma/migrations/ → Generated migrations (do not edit manually)

## Rules
1. All database changes MUST go through prisma/schema.prisma.
   For local development, run: npx prisma db push
   Never run `npx prisma migrate dev` directly — LaunchPad's pipeline
   handles migration generation and application on deploy.
2. NEVER create .env or .env.local files. Environment variables are
   injected by LaunchPad at deploy time. For local dev, run: npx launchpad dev
3. NEVER hardcode database URLs, API keys, or secrets. Always use process.env.
4. Use the Supabase client from /src/lib/supabase.ts (browser) or
   /src/lib/supabase-server.ts (server components/route handlers).
5. Do not restructure the top-level directory layout.
6. Do not modify vercel.json beyond adding redirects or headers.
7. Do not modify .launchpad/ directory contents.

## Environment Variables Available
- DATABASE_URL — Prisma connection string (auto-injected)
- NEXT_PUBLIC_SUPABASE_URL — Supabase project URL
- NEXT_PUBLIC_SUPABASE_ANON_KEY — Supabase anonymous key
- SUPABASE_SERVICE_ROLE_KEY — Supabase service role key (server only)

## Supported Extensions
If the user needs additional services, the following are pre-validated
and can be added via `npx launchpad add <extension>`:
- stripe — Stripe payments (adds STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET)
- resend — Resend email (adds RESEND_API_KEY)
- upstash — Upstash Redis (adds UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN)

Install the relevant npm package and use process.env for credentials.
LaunchPad will prompt the user to provide keys for new extensions.

---
<!-- LAUNCHPAD:USER_SECTION_BELOW — Everything below this line is yours. -->

## Your Project Notes
Add any custom instructions for Claude Code here. For example:
- Coding style preferences
- Architecture decisions
- Business logic rules
- Component naming conventions
```

The Config Guard (Section 8.2) validates only the platform zone. It computes a hash of the content above the `LAUNCHPAD:USER_SECTION_BELOW` delimiter and compares it to the expected hash for the current template version. The user zone is never inspected by the pipeline.

### 6.2 .launchpad/config.json

System-managed metadata. Not meant for human editing.

```json
{
  "version": "0.1",
  "project_id": "lp_abc123",
  "template": "nextjs-supabase-prisma",
  "template_version": "1.0.0",
  "created_at": "2026-04-07T12:00:00Z",
  "environments": {
    "preview": {
      "db_provider": "supabase",
      "db_project_id": "supabase_staging_id",
      "db_strategy": "isolated_schema"
    },
    "staging": {
      "db_provider": "supabase",
      "db_project_id": "supabase_staging_id",
      "db_schema": "public"
    },
    "production": {
      "db_provider": "supabase",
      "db_project_id": "supabase_prod_id",
      "db_schema": "public"
    }
  },
  "extensions": [],
  "managed_files": [
    "CLAUDE.md",
    ".launchpad/config.json",
    "vercel.json"
  ],
  "claude_md_platform_hash": "sha256:abc123..."
}
```

## 7. LaunchPad CLI

A lightweight CLI tool (`npx launchpad`) that provides local development support:

| Command | Description |
|---|---|
| `launchpad dev` | Starts Next.js dev server with env vars pulled from LaunchPad (staging Supabase credentials). Connects directly to the remote staging database — no local DB setup required. No `.env` file needed. Schema changes are applied locally via `prisma db push` (invoked by Claude Code per CLAUDE.md rules). |
| `launchpad validate` | Runs the same validation checks the pipeline runs. Lets the user catch issues before pushing. |
| `launchpad add <ext>` | Adds a supported extension (Stripe, Resend, etc.). Updates config and prompts for API keys. |
| `launchpad status` | Shows current project status: environments, last deploy, migration state. |
| `launchpad db reset` | Resets the staging database's `public` schema and re-applies the current `prisma/schema.prisma` via `db push`, then runs seed data. Useful when schema drift occurs during local development. |
| `launchpad logs` | Tails recent deploy and runtime logs from Vercel. |

The CLI authenticates via a locally stored token from the LaunchPad dashboard.

## 8. Guardrail System

On every push, the pipeline runs a series of guards before building. Each guard either passes, warns, or blocks.

### 8.1 Structure Guard (blocks)

Checks that the project structure matches the template. Specifically:
- `/src/app/` directory exists.
- `/prisma/schema.prisma` exists and parses without errors.
- `/package.json` exists and contains required dependencies.
- No unexpected top-level directories that conflict with the template.

**Failure message example:** *"Your project is missing prisma/schema.prisma. This file is required for database management. If you removed it intentionally, you may need to re-scaffold with `launchpad init`."*

### 8.2 Config Guard (blocks or warns)

Checks that platform-managed files are intact:
- **CLAUDE.md platform zone** — computes a hash of the content above the `LAUNCHPAD:USER_SECTION_BELOW` delimiter and compares it to the expected hash in `.launchpad/config.json`. If modified: **warns** (does NOT auto-restore). The user zone below the delimiter is never inspected.
- **`.launchpad/config.json`** — must not be modified. If modified: **blocks**.
- **`vercel.json`** — must match the expected base shape (additions like redirects are allowed). If broken: **blocks**.

**Warning message example (CLAUDE.md):** *"The LaunchPad section of your CLAUDE.md has been modified. This may cause Claude Code to generate code that doesn't work with the deploy pipeline. Please restore the platform section above the --- delimiter. Your custom notes below the delimiter are fine and won't be affected. You can see the expected content by running `launchpad validate --fix`."*

**Failure message example (.launchpad/config.json):** *".launchpad/config.json has been modified. This file is managed by LaunchPad and must not be edited. Run `launchpad validate --fix` to restore it, or re-scaffold with `launchpad init`."*

### 8.3 Migration Guard (blocks)

Since LaunchPad's pipeline owns migration generation (users use `prisma db push` locally), this guard checks:
- The committed `prisma/schema.prisma` parses correctly and represents a valid diff against the target environment's current state.
- No manually created migration files exist in `/prisma/migrations/` that weren't generated by the pipeline (detected via a marker comment LaunchPad adds to each generated migration).
- The schema diff does not contain destructive changes (column drops, table drops) without explicit user confirmation via the dashboard.

**Failure message example:** *"Your schema changes would drop the 'users' table, which would delete all data in that table. Please confirm this is intentional in the LaunchPad dashboard before deploying."*

**Warning message example:** *"A migration file was found in /prisma/migrations/ that wasn't generated by LaunchPad. LaunchPad manages migrations automatically — manually created files may cause conflicts. Consider deleting it and letting the pipeline handle migration generation."*

### 8.4 Secret Guard (warns)

Scans the codebase for patterns that look like hardcoded credentials:
- Strings matching Supabase key formats.
- `DATABASE_URL` assignments with actual connection strings.
- `.env` or `.env.local` files committed to the repo.

**Warning message example:** *"It looks like a .env.local file was committed to the repo. LaunchPad manages your environment variables automatically — this file is unnecessary and may contain secrets. Consider removing it and adding it to .gitignore."*

### 8.5 Drift Guard (warns, runs post-deploy)

After a successful staging or production deploy, LaunchPad periodically runs `prisma db pull` against the live database and compares it to the committed schema. If they diverge (e.g., someone modified tables via the Supabase dashboard), the dashboard shows a drift warning.

**Warning message example:** *"Your production database has a column 'notes' on the 'todos' table that isn't in your Prisma schema. This was probably added directly in the Supabase dashboard. To fix this, add the column to prisma/schema.prisma and create a migration."*

## 9. Dashboard

The LaunchPad dashboard is the user's single pane of glass. It replaces the need to visit GitHub, Vercel, or Supabase dashboards for day-to-day operations.

### 9.1 Project Overview Page

Displays:
- Project name and GitHub repo link.
- Two environment cards (Staging and Production) each showing:
  - Current URL.
  - Last deploy timestamp and status.
  - Migration count and schema version.
  - Quick actions (open URL, view logs, rollback).
- Active preview deploys section (expandable, shows branch name, preview URL, and schema name).
- Recent activity feed (pushes, deploys, migration runs, guard failures).
- "Promote to Production" button (visible when staging is ahead of prod).

### 9.2 Deploy Detail Page

For each deploy:
- Git commit info (message, author, branch).
- Build log (collapsible, from Vercel).
- Guard results (which passed, which warned, which blocked).
- Migration log (which migrations ran, duration).
- Environment variables that were injected (names only, not values).

### 9.3 Settings Page

- Connected accounts (GitHub, Vercel, Supabase) with re-auth options.
- Custom domain configuration (proxied through Vercel).
- Extension management (add/remove supported extensions).
- Danger zone: delete project (tears down Vercel project, both Supabase projects, and optionally the GitHub repo).

## 10. Extensions System

Extensions are pre-validated third-party service integrations. In MVP, they are limited to a curated list.

Adding an extension:
1. User runs `launchpad add stripe` (or uses dashboard).
2. LaunchPad prompts for required API keys.
3. Keys are encrypted and stored in LaunchPad.
4. Keys are injected into Vercel env vars for all environments.
5. `CLAUDE.md` is updated to document the new environment variables.
6. `.launchpad/config.json` is updated with the extension record.

MVP extensions:
- **Stripe** — `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
- **Resend** — `RESEND_API_KEY`
- **Upstash Redis** — `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`

Post-MVP, the extensions system could support community-contributed templates.

## 11. Rollback

Rollback is available for 24 hours after any production deploy. Triggering a rollback:

1. User clicks "Rollback" on the dashboard.
2. LaunchPad reverts the Vercel production deployment to the previous build artifact.
3. **Database rollback is NOT automatic.** Prisma migrations are forward-only by design. The dashboard warns the user: *"Your code has been rolled back, but database changes from the last migration are still in place. If the previous code version is compatible with the current schema, no action is needed. If not, you may need to create a corrective migration."*

This is an intentional limitation. Automatic DB rollback is dangerous and out of scope for MVP.

## 12. Technical Architecture

### 12.1 LaunchPad Backend

- **Runtime:** Node.js (or Next.js API routes if LaunchPad itself is a Next.js app — dogfooding the stack).
- **Database:** Postgres (Supabase) for project records, environment mappings, deploy history, and encrypted tokens.
- **Queue:** A job queue (e.g., BullMQ + Redis or Inngest) for pipeline steps. Each deploy is a multi-step job: validate → DB setup → deploy → verify → report.
- **Encryption:** All third-party tokens and user-provided secrets are encrypted at rest (AES-256 or similar). Decrypted only at pipeline runtime.

### 12.2 External API Integrations

| Service | APIs Used |
|---|---|
| GitHub | Repos, Contents, Webhooks, OAuth |
| Vercel | Projects, Deployments, Environment Variables, Domains, OAuth |
| Supabase | Management API (create/delete projects), Database (connection, migrations), OAuth |

### 12.3 Webhook Pipeline

```
GitHub push event
    → LaunchPad webhook endpoint
    → Enqueue pipeline job
    → Job runner executes: validate → DB → deploy → verify → report
    → Dashboard updated via WebSocket / polling
```

## 13. Pricing Model (Preliminary)

| Tier | Price | Includes |
|---|---|---|
| Free | $0/mo | 1 project (uses both Supabase free tier slots), community support |
| Pro | $19/mo | Multiple projects (requires user's Supabase Pro plan), priority builds, custom domains |
| Team | $49/mo | Team members, deploy approvals, audit log |

Users pay for LaunchPad on top of their existing Vercel/Supabase/GitHub plans. LaunchPad does not resell compute or storage — it orchestrates the user's own accounts.

**Important free tier constraint:** Since each LaunchPad project consumes 2 Supabase projects (staging + production), free-tier Supabase users are limited to exactly 1 LaunchPad project. Users who want multiple projects must upgrade their Supabase plan independently. LaunchPad checks available Supabase project slots before allowing project creation.

## 14. MVP Scope and Boundaries

### In Scope

- GitHub + Vercel + Supabase OAuth integration.
- Single template: Next.js 14 + Prisma + Supabase.
- Project creation with full scaffolding.
- CLAUDE.md generation and enforcement.
- Automated preview, staging, and production deploys.
- Migration management with safety checks.
- Five guardrails (structure, config, migration, secret, drift).
- Dashboard with project overview, deploy details, and settings.
- LaunchPad CLI (`dev`, `validate`, `add`, `status`, `db reset`, `logs`).
- Rollback (code only, with DB caveat).
- Three MVP extensions (Stripe, Resend, Upstash).

### Out of Scope (Post-MVP)

- Non-Next.js frameworks (SvelteKit, Remix, Astro, etc.).
- Non-Supabase databases (PlanetScale, Neon, Turso).
- Non-Vercel hosts (Netlify, Railway, Fly.io).
- Monorepo support.
- Multi-tenant team workspaces with role-based access.
- Automatic database rollback.
- Custom templates / community template marketplace.
- MCP server integration for Claude Code (conversational deploy).
- Mobile app deploys.
- Usage analytics / observability dashboard.

## 15. Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Claude Code ignores CLAUDE.md rules | Broken deploys | Pre-deploy validation guards catch violations before build |
| Users outgrow the template quickly | Churn | Extensions system from day one; clear path for unsupported features (proceed with warning) |
| Vercel/Supabase absorb this feature set | Existential | Speed of execution; deep Claude Code integration as moat; build community before incumbents move |
| Prisma migration conflicts | Blocked deploys, frustrated users | Migration guard with clear error messages; `db reset` escape hatch |
| Supabase dashboard edits cause drift | Schema inconsistency | Drift guard detects and warns; CLAUDE.md states Prisma as single source of truth |
| Third-party API rate limits or downtime | Deploy failures | Queue with retries; status page showing external service health |
| Security of stored OAuth tokens | Data breach | AES-256 encryption at rest; minimal token scopes; rotate on re-auth |
| Supabase free tier limits (2 projects) | Users limited to 1 LaunchPad project; preview schemas may hit connection pool limits | Validate slots before creation; cap at 5 concurrent previews; 48h stale cleanup; clear upgrade path messaging |
| Vercel Hobby commercial use restriction | Users violate Vercel TOS if they deploy commercial apps on Hobby | Position free tier as "personal/prototyping"; show TOS notice on production promote; detect plan via API and warn |

## 16. Success Metrics

- **Time to first production deploy:** Target under 30 minutes from sign-up.
- **Deploy success rate:** Target >95% of pushes result in successful deploys (after guardrail blocks are excluded).
- **Guardrail catch rate:** % of would-be-broken deploys caught by guards before reaching Vercel.
- **User retention:** % of users who deploy to production within 7 days of creating a project.
- **Support volume:** Proxy for UX clarity — lower is better.

## 17. Resolved Design Decisions

These questions were raised during the design process and have been resolved:

1. **Supabase preview branching vs. ephemeral projects.** **Decision: Neither.** Supabase branching requires a Pro plan, and ephemeral projects would exceed the free tier limit. Instead, preview deploys use **isolated Postgres schemas** within the staging Supabase project (e.g., `preview_feat_todo_app`). This provides real data isolation without consuming additional project slots. Schemas are cleaned up on branch merge or deletion.

2. **Local development experience.** **Decision: Remote staging DB.** `launchpad dev` connects directly to the remote staging Supabase database. This eliminates the need for local Supabase CLI installation, Docker, or any local database setup. Users with simple laptops and an internet connection can develop immediately. Trade-off: offline development is not supported; this is acceptable for the target audience.

3. **CLAUDE.md restoration policy.** **Decision: Warn only, never auto-restore.** The CLAUDE.md is split into two zones by a `LAUNCHPAD:USER_SECTION_BELOW` delimiter. The platform zone (above) is validated via hash comparison — if modified, the pipeline warns but does not block or restore. The user zone (below) is fully owned by the user for custom Claude Code instructions. This respects user autonomy while keeping the guardrail visible.

4. **Billing for Supabase projects.** **Decision: 2 databases total.** Each LaunchPad project uses exactly 2 Supabase projects: one for staging (shared with preview schemas) and one for production. This fits within the Supabase free tier (2 projects max). Consequence: free-tier users are limited to 1 LaunchPad project. The platform validates available Supabase slots before project creation and requires 0 existing projects for free-tier users.

5. **Name.** **Decision: LaunchPad (working title).** Staying with the current name. Trademark and domain search deferred to later.

## 18. Technical Specifications: Preview Isolation, Prisma, and Vercel Limits

These questions were investigated and resolved. The findings below inform implementation decisions throughout the PRD.

### 18.1 Supabase Schema Isolation Limits (Free Tier)

PostgreSQL has no hard cap on schema count — hundreds can coexist. The bottleneck is the **connection pool**. On Supabase's free-tier Nano instance:

- **60 direct connections** maximum.
- **200 pooler client connections** via Supavisor (routing to ~20 backend connections).
- Supabase internal services (Auth, PostgREST, Storage, health checks) consume ~10–15 baseline connections.
- Each active Vercel preview deployment holds at least 1 connection (with `connection_limit=1` in Prisma).
- Migration runs are connection-intensive and temporarily spike usage.
- Storage is capped at **500 MB** on the free tier — each preview schema duplicates table structures and seed data.

**Decision:** LaunchPad enforces a hard cap of **5 concurrent preview schemas** on the free tier. The pipeline refuses to create a 6th preview schema and shows: *"You have 5 active preview environments, which is the maximum for your plan. Merge or delete a branch to free up a slot, or upgrade your Supabase plan for more."* Additionally, LaunchPad automatically cleans up stale preview schemas for branches inactive for more than 48 hours. The dashboard shows active preview schema count and remaining slots.

### 18.2 Prisma + Postgres Schema Support

The `?schema=preview_feat_x` connection string parameter works by setting the Postgres `search_path`. All Prisma operations (queries, migrations via `prisma migrate deploy`) target that schema. This pattern is validated in production by developers using it for PR preview isolation.

**Key implementation details:**

1. **Shadow database.** `prisma migrate dev` (local development) requires a shadow database that the Supabase user typically cannot create. `prisma migrate deploy` (pipeline) does **not** need a shadow database. For local development via `launchpad dev`, the platform uses `prisma db push` instead of `prisma migrate dev`, which skips the shadow DB requirement entirely. The CLAUDE.md rules are updated accordingly: local schema changes use `npx prisma db push`, while the pipeline handles proper migration application.

2. **Supavisor + Prisma compatibility.** Supavisor in transaction mode (port 6543) does not support prepared statements. All connection strings must include `pgbouncer=true` to disable them. The standard preview connection string format is:
   ```
   postgresql://user:pass@host:6543/postgres?schema=preview_feat_x&pgbouncer=true&connection_limit=1
   ```

3. **Prisma multi-schema feature vs. connection string schema.** These are different mechanisms. LaunchPad uses the simpler connection string approach: the Prisma schema file targets `public` as written, and the `?schema=` parameter redirects all DDL and queries to the preview schema. The `@@schema()` annotation feature is not used.

4. **Prisma adapter-pg bug.** There is a known issue in Prisma 7 where the `@prisma/adapter-pg` driver adapter ignores the `?schema=` parameter entirely, routing all queries to `public`. The traditional Prisma engine (non-adapter mode) handles it correctly.

**Decision:** Pin to Prisma's **traditional engine (non-adapter mode)** for MVP. The pipeline owns migration generation: it uses `prisma migrate diff` to generate migrations from schema changes and `prisma migrate deploy` to apply them. Local development uses `prisma db push` exclusively (avoiding shadow DB issues and migration file conflicts). Add an integration test in LaunchPad's CI that creates a schema, runs `db push`, executes basic CRUD, and drops the schema — this serves as the canary for any upstream Prisma regressions.

### 18.3 Vercel Hobby Plan Limits

Vercel's Hobby plan includes **unlimited preview deployments** — there is no cap on concurrent previews. Preview deployments are static build artifacts on Vercel's CDN and remain accessible indefinitely.

**Constraints that matter:**

1. **Deploy rate limit:** 100 deployments per 24-hour period. Users who push after every small Claude Code change could approach this. LaunchPad should track deploy count and warn at 80/100: *"You've used 80 of your 100 daily Vercel deploys. Consider batching changes into fewer pushes."*

2. **Compute limits:** 1M function invocations, 4 hours Active CPU, 360 GB-hrs Provisioned Memory per month. Multiple active previews receiving traffic drain these faster. Not a blocking concern for development workflows but relevant for staging environments under load.

3. **Commercial use restriction:** The Hobby plan restricts usage to **non-commercial, personal projects only**. Users deploying production apps on Hobby violate Vercel's terms of service. This is a significant policy issue for LaunchPad.

4. **Project count:** 10 active projects on Hobby. Since LaunchPad free-tier users are already limited to 1 project (by the Supabase constraint), this is not a concern.

**Decision:** LaunchPad's free tier is positioned as **"for personal projects and prototyping"**, matching Vercel Hobby TOS. The production promote flow displays a notice: *"Vercel's free plan is for personal, non-commercial use. If this project is commercial, please upgrade to Vercel Pro ($20/mo)."* LaunchPad can verify the user's Vercel plan via the API and surface a warning (not a block) if they're on Hobby and promoting to production. For LaunchPad Pro/Team tiers, the onboarding flow recommends Vercel Pro and checks plan status.

### 18.4 Updated CLAUDE.md Rules (Local Dev)

Based on the Prisma findings above, the CLAUDE.md `Rules` section is updated:

```
## Rules
1. All database changes MUST go through prisma/schema.prisma.
   For local development: run `npx prisma db push` to apply schema changes.
   Never run `npx prisma migrate dev` directly — LaunchPad's pipeline
   handles migration generation and application on deploy.
2. NEVER create .env or .env.local files. Environment variables are
   injected by LaunchPad at deploy time. For local dev, run: npx launchpad dev
...
```

This change ensures Claude Code uses `db push` locally (avoiding the shadow DB issue) while the pipeline uses `prisma migrate deploy` for proper migration management.
