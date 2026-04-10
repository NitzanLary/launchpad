import type { TemplateData } from "../types";

export function renderPackageJson(data: TemplateData): string {
  const pkg = {
    name: data.projectSlug,
    version: "0.1.0",
    private: true,
    scripts: {
      dev: "next dev",
      build: "next build",
      start: "next start",
      lint: "next lint",
      postinstall: "prisma generate",
    },
    dependencies: {
      "@prisma/client": "^6.9.0",
      "@supabase/supabase-js": "^2.49.4",
      next: "14.2.20",
      react: "^18.3.1",
      "react-dom": "^18.3.1",
    },
    devDependencies: {
      "@types/node": "^22.15.3",
      "@types/react": "^18.3.20",
      "@types/react-dom": "^18.3.6",
      prisma: "^6.9.0",
      typescript: "^5.8.3",
    },
  };

  return JSON.stringify(pkg, null, 2) + "\n";
}
