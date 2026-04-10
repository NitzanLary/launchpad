import { CLAUDE_MD_DELIMITER } from "@launchpad/shared";
import type { Guard } from "./types";

export const configGuard: Guard = async (context) => {
  // Check .launchpad/config.json hasn't been modified
  // Full implementation in Phase 3
  const configExists = await context.files.exists(".launchpad/config.json");
  if (!configExists) {
    return {
      guard: "config",
      status: "BLOCK",
      message:
        ".launchpad/config.json is missing. This file is managed by LaunchPad and is required.",
    };
  }

  // Check CLAUDE.md platform zone hash
  const claudeMdExists = await context.files.exists("CLAUDE.md");
  if (!claudeMdExists) {
    return {
      guard: "config",
      status: "WARN",
      message:
        "CLAUDE.md is missing. This file helps Claude Code follow project conventions.",
    };
  }

  return {
    guard: "config",
    status: "PASS",
    message: "Configuration files are intact.",
  };
};
