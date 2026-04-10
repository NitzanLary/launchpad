import Handlebars from "handlebars";
import type { TemplateData, TemplateFile } from "../types";

// ─── prisma/schema.prisma ────────────────────────────────────────────────────

const schemaPrisma = `generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
`;

// ─── supabase/seed.sql ───────────────────────────────────────────────────────

const seedSql = `-- Seed data for your project.
-- This file is applied to preview environments automatically.
-- Add INSERT statements here to populate preview databases with test data.
`;

// ─── src/lib/prisma.ts ───────────────────────────────────────────────────────

const prismaClient = `import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma = globalForPrisma.prisma || new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
`;

// ─── src/lib/supabase.ts ─────────────────────────────────────────────────────

const supabaseBrowser = `import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
`;

// ─── src/lib/supabase-server.ts ──────────────────────────────────────────────

const supabaseServer = `import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * Supabase client for server-side operations (Server Components, Route Handlers).
 * Uses the service role key — do NOT expose this client to the browser.
 */
export const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
`;

// ─── src/app/layout.tsx ──────────────────────────────────────────────────────

const layoutTemplate = Handlebars.compile(`import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "{{projectName}}",
  description: "Built with LaunchPad",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
`);

// ─── src/app/globals.css ─────────────────────────────────────────────────────

const globalsCss = `@tailwind base;
@tailwind components;
@tailwind utilities;
`;

// ─── src/app/page.tsx ────────────────────────────────────────────────────────

const pageTsx = `export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <h1 className="text-4xl font-bold mb-4">Welcome to your LaunchPad project</h1>
      <p className="text-lg text-gray-600">
        Start building with Claude Code. Edit <code>src/app/page.tsx</code> to get started.
      </p>
    </main>
  );
}
`;

// ─── vercel.json ─────────────────────────────────────────────────────────────

const vercelJson = `{
  "framework": "nextjs"
}
`;

// ─── tsconfig.json ───────────────────────────────────────────────────────────

const tsconfigJson = `{
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
`;

// ─── .gitignore ──────────────────────────────────────────────────────────────

const gitignore = `# dependencies
/node_modules
/.pnp
.pnp.js

# next.js
/.next/
/out/

# production
/build

# misc
.DS_Store
*.pem

# debug
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# local env files
.env*.local
.env

# vercel
.vercel

# typescript
*.tsbuildinfo
next-env.d.ts
`;

// ─── next.config.mjs ────────────────────────────────────────────────────────

const nextConfig = `/** @type {import('next').NextConfig} */
const nextConfig = {};

export default nextConfig;
`;

// ─── tailwind.config.ts ──────────────────────────────────────────────────────

const tailwindConfig = `import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};

export default config;
`;

// ─── postcss.config.mjs ─────────────────────────────────────────────────────

const postcssConfig = `/** @type {import('postcss-load-config').Config} */
const config = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};

export default config;
`;

// ─── Export all static files ─────────────────────────────────────────────────

export function getStaticFiles(data: TemplateData): TemplateFile[] {
  return [
    { path: "prisma/schema.prisma", content: schemaPrisma },
    { path: "supabase/seed.sql", content: seedSql },
    { path: "src/lib/prisma.ts", content: prismaClient },
    { path: "src/lib/supabase.ts", content: supabaseBrowser },
    { path: "src/lib/supabase-server.ts", content: supabaseServer },
    { path: "src/app/layout.tsx", content: layoutTemplate(data) },
    { path: "src/app/globals.css", content: globalsCss },
    { path: "src/app/page.tsx", content: pageTsx },
    { path: "src/app/api/.gitkeep", content: "" },
    { path: "vercel.json", content: vercelJson },
    { path: "tsconfig.json", content: tsconfigJson },
    { path: ".gitignore", content: gitignore },
    { path: "next.config.mjs", content: nextConfig },
    { path: "tailwind.config.ts", content: tailwindConfig },
    { path: "postcss.config.mjs", content: postcssConfig },
    { path: "public/.gitkeep", content: "" },
    { path: ".launchpad/validators/.gitkeep", content: "" },
  ];
}
