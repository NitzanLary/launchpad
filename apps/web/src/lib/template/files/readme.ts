import Handlebars from "handlebars";
import type { TemplateData } from "../types";

const template = Handlebars.compile(`# {{projectName}}

Built with [LaunchPad](https://launchpad.dev) — zero-config deployment for Claude Code projects.

## Getting Started

\\\`\\\`\\\`bash
git clone https://github.com/{{githubOwner}}/{{projectSlug}}.git
cd {{projectSlug}}
npm install
npx launchpad dev
\\\`\\\`\\\`

Open [http://localhost:3000](http://localhost:3000) to see your app.

## Development

This project uses:
- **Next.js 14** (App Router) for the frontend
- **Supabase** (Postgres) for the database
- **Prisma** as the ORM

### Database Changes

Edit \\\`prisma/schema.prisma\\\` and run:

\\\`\\\`\\\`bash
npx prisma db push
\\\`\\\`\\\`

LaunchPad handles migrations automatically on deploy.

### Deploy

Push to any branch to get a preview deploy. Merge to \\\`main\\\` to deploy to staging. Promote to production from the LaunchPad dashboard.

## Powered by LaunchPad

This project is managed by LaunchPad. See \\\`CLAUDE.md\\\` for AI coding conventions.
`);

export function renderReadme(data: TemplateData): string {
  return template(data);
}
