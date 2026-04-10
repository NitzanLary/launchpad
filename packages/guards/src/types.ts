import type { GuardContext, GuardResult } from "@launchpad/shared";

export type Guard = (context: GuardContext) => Promise<GuardResult>;

export type { GuardContext, GuardResult };
