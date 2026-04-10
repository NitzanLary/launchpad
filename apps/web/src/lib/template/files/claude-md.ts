import Handlebars from "handlebars";
import { CLAUDE_MD_DELIMITER } from "@launchpad/shared";
import type { TemplateData } from "../types";

const template = Handlebars.compile(`# LaunchPad Project: {{projectName}}
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
   Never run \\\`npx prisma migrate dev\\\` directly — LaunchPad's pipeline
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
and can be added via \\\`npx launchpad add <extension>\\\`:
- stripe — Stripe payments (adds STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET)
- resend — Resend email (adds RESEND_API_KEY)
- upstash — Upstash Redis (adds UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN)

Install the relevant npm package and use process.env for credentials.
LaunchPad will prompt the user to provide keys for new extensions.

---
${CLAUDE_MD_DELIMITER}

## Your Project Notes
Add any custom instructions for Claude Code here. For example:
- Coding style preferences
- Architecture decisions
- Business logic rules
- Component naming conventions
`);

export function renderClaudeMd(data: TemplateData): string {
  return template(data);
}
