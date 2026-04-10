import type { Guard, GuardContext, GuardResult } from "./types";
import { structureGuard } from "./structure";
import { configGuard } from "./config";
import { migrationGuard } from "./migration";
import { secretGuard } from "./secret";

const ALL_GUARDS: Guard[] = [
  structureGuard,
  configGuard,
  migrationGuard,
  secretGuard,
];

export async function runGuards(
  context: GuardContext,
  guards: Guard[] = ALL_GUARDS
): Promise<GuardResult[]> {
  return Promise.all(guards.map((guard) => guard(context)));
}
