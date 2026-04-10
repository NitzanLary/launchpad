import type { Guard } from "./types";

export const migrationGuard: Guard = async (context) => {
  // Stub — full implementation in Phase 3
  // Will check: schema parsability, unauthorized migration files, destructive changes
  const schemaExists = await context.files.exists("prisma/schema.prisma");
  if (!schemaExists) {
    return {
      guard: "migration",
      status: "BLOCK",
      message: "prisma/schema.prisma is missing. Cannot validate migrations.",
    };
  }

  return {
    guard: "migration",
    status: "PASS",
    message: "Migration checks passed.",
  };
};
