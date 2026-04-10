import type { Guard } from "./types";

export const structureGuard: Guard = async (context) => {
  const checks = [
    { path: "src/app", label: "src/app/ directory" },
    { path: "prisma/schema.prisma", label: "prisma/schema.prisma" },
    { path: "package.json", label: "package.json" },
  ];

  for (const check of checks) {
    const exists = await context.files.exists(check.path);
    if (!exists) {
      return {
        guard: "structure",
        status: "BLOCK",
        message: `Your project is missing ${check.label}. This file is required. If you removed it intentionally, re-scaffold with \`launchpad init\`.`,
      };
    }
  }

  return {
    guard: "structure",
    status: "PASS",
    message: "Project structure is valid.",
  };
};
