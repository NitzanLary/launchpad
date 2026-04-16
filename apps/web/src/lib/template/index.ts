import { createHash } from "crypto";
import { CLAUDE_MD_DELIMITER } from "@launchpad/shared";
import type { TemplateData, TemplateFile } from "./types";
import { renderClaudeMd } from "./files/claude-md";
import { renderConfigJson } from "./files/config-json";
import { renderPackageJson } from "./files/package-json";
import { renderReadme } from "./files/readme";
import { getStaticFiles } from "./files/static";

export type { TemplateData, TemplateFile };

/**
 * Compute the SHA-256 hash of the CLAUDE.md platform zone
 * (everything above the delimiter).
 */
function computePlatformHash(claudeMdContent: string): string {
  const parts = claudeMdContent.split(CLAUDE_MD_DELIMITER);
  const platformZone = parts[0];
  const hash = createHash("sha256").update(platformZone).digest("hex");
  return `sha256:${hash}`;
}

/**
 * Generate all template files for a new LaunchPad project.
 * Returns the files array and the CLAUDE.md platform hash (needed for DB storage).
 */
export function generateTemplateFiles(data: TemplateData): {
  files: TemplateFile[];
  claudeMdPlatformHash: string;
} {
  // Render CLAUDE.md first — we need it to compute the hash
  const claudeMdContent = renderClaudeMd(data);
  const claudeMdPlatformHash = computePlatformHash(claudeMdContent);

  // Render config.json with the hash
  const configJsonContent = renderConfigJson(data, claudeMdPlatformHash);

  // Collect all files
  const files: TemplateFile[] = [
    { path: "CLAUDE.md", content: claudeMdContent },
    { path: ".launchpad/config.json", content: configJsonContent },
    { path: "package.json", content: renderPackageJson(data) },
    { path: "README.md", content: renderReadme(data) },
    ...getStaticFiles(data),
  ];

  return { files, claudeMdPlatformHash };
}

/**
 * Generate only the per-project customization files that get pushed on top
 * of Vercel's `/new/clone` of the canonical template repo. Stock scaffold
 * files (src/, prisma/, public/, configs) already live in the template repo
 * and only need to be cloned, not re-pushed.
 */
export function generateCustomizationFiles(data: TemplateData): {
  files: TemplateFile[];
  claudeMdPlatformHash: string;
} {
  const claudeMdContent = renderClaudeMd(data);
  const claudeMdPlatformHash = computePlatformHash(claudeMdContent);
  const configJsonContent = renderConfigJson(data, claudeMdPlatformHash);

  const files: TemplateFile[] = [
    { path: "CLAUDE.md", content: claudeMdContent },
    { path: ".launchpad/config.json", content: configJsonContent },
    { path: "package.json", content: renderPackageJson(data) },
    { path: "README.md", content: renderReadme(data) },
  ];

  return { files, claudeMdPlatformHash };
}
