import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../../../..", import.meta.url));
const read = (relativePath: string) => readFileSync(path.join(repositoryRoot, relativePath), "utf8");

function sourceFiles(relativeDirectory: string, extensions: readonly string[]): string[] {
  const directory = path.join(repositoryRoot, relativeDirectory);
  return readdirSync(directory).flatMap((entry) => {
    const absolute = path.join(directory, entry);
    const relative = path.join(relativeDirectory, entry);
    if (statSync(absolute).isDirectory()) return sourceFiles(relative, extensions);
    return extensions.some((extension) => entry.endsWith(extension)) ? [relative] : [];
  });
}

const stylesheets = [...sourceFiles("src", [".css"]), ...sourceFiles("packages/shared-ui/src", [".css"])]
  .filter((file) => !file.endsWith(".generated.css"));
const components = [...sourceFiles("src", [".tsx"]), ...sourceFiles("packages/shared-ui/src", [".tsx"])]
  .filter((file) => !file.includes(`${path.sep}primitives${path.sep}`));

describe("loading placeholder styles", () => {
  it("ships both styles with the shared UI patterns", () => {
    expect(read("packages/shared-ui/src/styles/shared-ui-patterns.css")).toContain('@import "./loading-placeholder.css";');
    const index = read("packages/shared-ui/src/index.ts");
    expect(index).toContain("PlaceholderLayer,");
    expect(index).toContain("LoadingPlaceholderStyleProvider,");
    expect(index).not.toContain("OrderedDither");
  });

  it("is an Appearance preference applied at the surface appearance boundary", () => {
    // Stored styles are read through the list of styles Appearance offers.
    expect(read("src/features/appearance/appearancePreferences.ts")).toContain("loadingPlaceholderStyle: parseSelectableLoadingStyle(");
    expect(read("src/features/settings/preferencesPersistence.ts")).toContain("loadingPlaceholderStyle: s.loadingPlaceholderStyle,");
    const runtime = read("src/features/appearance/AppearanceRuntime.tsx");
    expect(runtime).toContain('"data-loading-placeholder-style": loadingPlaceholderStyle,');
    expect(runtime).toContain("<LoadingPlaceholderStyleProvider style={value.loadingPlaceholderStyle}>");
    // One Appearance control sets the style of loading placeholders and loading marks alike.
    const settings = read("src/features/settings/main/AppearanceSettingsView.tsx");
    expect(settings).toContain("<LoadingStyleSetting />");
    expect(settings).not.toContain("LoadingAnimationSetting");
  });

  it("keeps both styles still for reduced motion", () => {
    expect(read("packages/shared-ui/src/primitives/OrderedDither.tsx")).toContain('matchMedia?.("(prefers-reduced-motion: reduce)")');
    expect(read("packages/shared-ui/src/styles/loading-placeholder.css")).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\[data-placeholder-shape\]\s*\{\s*animation: none;/,
    );
  });

  it("retires highlight sweeps from placeholders", () => {
    const sweeps = stylesheets.filter((file) => /--po-skeleton-shimmer|skeleton-shimmer|placeholder-shimmer|thumbnail-pending/.test(read(file)));
    expect(sweeps).toEqual([]);
  });

  it("gives every placeholder surface marked shapes and the style layer", () => {
    const surfaces = components.filter((file) => read(file).includes("po-placeholder-surface"));
    expect(surfaces.length).toBeGreaterThan(0);
    for (const file of surfaces) {
      const source = read(file);
      expect(source, file).toMatch(/<PlaceholderLayer[\s/]/);
      expect(source, file).toContain("data-placeholder-shape");
    }
  });
});
