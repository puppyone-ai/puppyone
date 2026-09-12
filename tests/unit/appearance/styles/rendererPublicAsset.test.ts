import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  RENDERER_ASSET_PATHS,
  resolveRendererPublicAssetUrl,
} from "@puppyone/shared-ui";

describe("renderer public asset URLs", () => {
  it("keeps assets relative to Electron's packaged renderer document", () => {
    const source = resolveRendererPublicAssetUrl(RENDERER_ASSET_PATHS.icons.agents.codex.light, "./");

    expect(source).toBe("./assets/icons/agents/codex-light.png");
    expect(new URL(
      source,
      "file:///Applications/PuppyOne.app/Contents/Resources/app.asar/dist/index.html",
    ).href).toBe(
      "file:///Applications/PuppyOne.app/Contents/Resources/app.asar/dist/assets/icons/agents/codex-light.png",
    );
  });

  it("supports development and nested deployment bases", () => {
    expect(resolveRendererPublicAssetUrl(RENDERER_ASSET_PATHS.icons.ui.folder, "/"))
      .toBe("/assets/icons/ui/folder.svg");
    expect(resolveRendererPublicAssetUrl(RENDERER_ASSET_PATHS.icons.ui.folder, "/desktop/"))
      .toBe("/desktop/assets/icons/ui/folder.svg");
  });

  it("keeps the catalog unique and backed by files in public", () => {
    const paths = collectAssetPaths(RENDERER_ASSET_PATHS);

    expect(new Set(paths).size).toBe(paths.length);
    for (const assetPath of paths) {
      expect(existsSync(path.join(process.cwd(), "public", assetPath)), assetPath).toBe(true);
    }
  });

  it.each([
    "/assets/icons/ui/folder.svg",
    "../assets/icons/ui/folder.svg",
    "assets/icons/../folder.svg",
    "assets\\icons\\ui\\folder.svg",
    "https://example.com/icon.svg",
    "assets/icons/ui/folder.svg?theme=dark",
    "assets/icons/ui/folder.svg#mark",
  ])("rejects an unsafe public asset path: %s", (assetPath) => {
    expect(() => resolveRendererPublicAssetUrl(assetPath, "./")).toThrow(
      "Renderer public asset paths must be safe repository-relative paths",
    );
  });
});

function collectAssetPaths(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (!value || typeof value !== "object") return [];
  return Object.values(value).flatMap(collectAssetPaths);
}
