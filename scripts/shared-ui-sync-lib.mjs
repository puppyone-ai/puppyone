import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { cp } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const sharedUiSource = path.join(repoRoot, "frontend", "shared-ui");
export const desktopSharedUiVendor = path.join(repoRoot, "desktop", "vendor", "shared-ui");
export const generatedNoticePath = "GENERATED.md";

const generatedNotice = `# Generated Shared UI Copy

This directory is generated from \`frontend/shared-ui\`.

Do not edit files here by hand. Edit \`frontend/shared-ui\`, then run:

\`\`\`bash
node scripts/sync-desktop-shared-ui.mjs
\`\`\`
`;

export async function syncSharedUiTo(destination) {
  if (!existsSync(sharedUiSource)) {
    throw new Error(`Missing shared UI source: ${sharedUiSource}`);
  }

  rmSync(destination, { recursive: true, force: true });
  mkdirSync(path.dirname(destination), { recursive: true });
  await cp(sharedUiSource, destination, {
    recursive: true,
    force: true,
    filter: (sourcePath) => {
      const name = path.basename(sourcePath);
      return name !== "node_modules" && name !== ".next" && name !== "dist";
    },
  });
  writeFileSync(path.join(destination, generatedNoticePath), generatedNotice, "utf8");
}

export function compareDirectories(left, right) {
  const differences = [];
  compareDirectory(left, right, "", differences);
  return differences;
}

function compareDirectory(leftRoot, rightRoot, relativePath, differences) {
  const leftPath = path.join(leftRoot, relativePath);
  const rightPath = path.join(rightRoot, relativePath);
  const leftExists = existsSync(leftPath);
  const rightExists = existsSync(rightPath);

  if (!leftExists || !rightExists) {
    differences.push(`${relativePath || "."}: ${leftExists ? "missing on right" : "missing on left"}`);
    return;
  }

  const leftStat = statSync(leftPath);
  const rightStat = statSync(rightPath);

  if (leftStat.isDirectory() !== rightStat.isDirectory()) {
    differences.push(`${relativePath}: type mismatch`);
    return;
  }

  if (!leftStat.isDirectory()) {
    const leftBytes = readFileSync(leftPath);
    const rightBytes = readFileSync(rightPath);
    if (!leftBytes.equals(rightBytes)) {
      differences.push(`${relativePath}: content differs`);
    }
    return;
  }

  const names = new Set([
    ...readdirSync(leftPath),
    ...readdirSync(rightPath),
  ]);

  for (const name of [...names].sort()) {
    compareDirectory(leftRoot, rightRoot, path.join(relativePath, name), differences);
  }
}

