import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../../../..", import.meta.url));
const registryFile = "packages/shared-ui/src/icons/productIcons.tsx";
// File-icon themes own their own complete drawing sets; the default theme
// draws its folder from the registry's FOLDER_ICON_PATHS.
const fileIconThemes = "packages/shared-ui/src/file/icon-themes/";

/** Lucide drawings that state a product meaning and so belong to the registry only. */
const REGISTERED_DRAWINGS = new Map([
  ["House", "HomeIcon"],
  ["Home", "HomeIcon"],
  ["Folder", "FolderIcon"],
  ["FolderOpen", "FolderIcon"],
  ["FolderClosed", "FolderIcon"],
  ["Laptop", "LocalIcon"],
  ["HardDriveDownload", "LocalIcon"],
  ["Cloud", "CloudIcon"],
  ["CloudUpload", "CloudUploadIcon"],
  ["CloudOff", "CloudOffIcon"],
]);

function sourceFiles(directory: string): string[] {
  return readdirSync(path.join(repositoryRoot, directory)).flatMap((name) => {
    const relative = path.posix.join(directory, name);
    if (statSync(path.join(repositoryRoot, relative)).isDirectory()) return sourceFiles(relative);
    return /\.(?:ts|tsx)$/.test(name) ? [relative] : [];
  });
}

function lucideImports(source: string) {
  return [...source.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']lucide-react["']/g)]
    .flatMap((match) => match[1].split(","))
    .map((specifier) => specifier.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0].trim())
    .filter(Boolean);
}

describe("product icon architecture", () => {
  const files = [...sourceFiles("src"), ...sourceFiles("packages/shared-ui/src")]
    .filter((file) => file !== registryFile && !file.startsWith(fileIconThemes));

  it("asks the registry for home, folder, local and Cloud meanings instead of importing drawings", () => {
    const violations = files.flatMap((file) => lucideImports(readFileSync(path.join(repositoryRoot, file), "utf8"))
      .filter((name) => REGISTERED_DRAWINGS.has(name))
      .map((name) => `${file}: import ${REGISTERED_DRAWINGS.get(name)} from @puppyone/shared-ui instead of lucide ${name}`));
    expect(violations).toEqual([]);
  });

  it("draws every in-place expand arrow with the registry's DisclosureIcon", () => {
    const disclosureSites = [
      "packages/shared-ui/src/data/ExplorerTree.tsx",
      "src/features/cloud/sections/access/CreateAccessFolderTree.tsx",
      "src/features/cloud/sections/access/CreateAccessDialog.tsx",
      "src/features/cloud/sections/access/AccessMethodCard.tsx",
      "src/features/source-control/components.tsx",
      "src/features/source-control/GitHistoryTimeline.tsx",
      "src/features/automation/AutomationControls.tsx",
    ];
    for (const file of disclosureSites) {
      expect(readFileSync(path.join(repositoryRoot, file), "utf8"), file).toContain("<DisclosureIcon");
    }
    const drifts = files.flatMap((file) => {
      const source = readFileSync(path.join(repositoryRoot, file), "utf8");
      return [
        // Swapping a right chevron for a down chevron is a second disclosure drawing.
        /\?\s*<Chevron(?:Down|Right)\b[^\n]*:\s*<Chevron(?:Down|Right)\b/.test(source) && `${file}: chevron swap`,
        // The retired hand-drawn tree marker.
        source.includes("M4 2.5 7.5 6 4 9.5") && `${file}: hand-drawn disclosure copy`,
      ].filter(Boolean);
    });
    expect(drifts).toEqual([]);
  });

  it("keeps one Home drawing, owned by the registry", () => {
    const homeDrawings = [
      "M15 21h4a2 2 0 0 0 2-2v-9", // the product home
      "M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8", // lucide House's door, with its closed threshold
    ];
    const copies = files.filter((file) => {
      const source = readFileSync(path.join(repositoryRoot, file), "utf8");
      return homeDrawings.some((drawing) => source.includes(drawing));
    });
    expect(copies).toEqual([]);
  });

  it("keeps one Cloud drawing, owned by the registry", () => {
    const cloudDrawings = [
      "M6.8 19A3.8 3.8 0 1 1 5.927 11.502", // the product cloud
      "M811.4 418.7C765.6 297.9", // the retired Ant Design outline
    ];
    const copies = files.filter((file) => {
      const source = readFileSync(path.join(repositoryRoot, file), "utf8");
      return cloudDrawings.some((drawing) => source.includes(drawing));
    });
    expect(copies).toEqual([]);
  });
});
