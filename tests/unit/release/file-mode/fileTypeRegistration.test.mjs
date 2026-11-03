import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { applyLinuxBuilderConfig } from "../../../../scripts/desktop/build/platforms/linux.mjs";
import { applyMacosBuilderConfig } from "../../../../scripts/desktop/build/platforms/macos.mjs";
import { applyWindowsBuilderConfig } from "../../../../scripts/desktop/build/platforms/windows.mjs";

const identity = {
  applicationName: "PuppyOne",
  platformBuildNumber: "1",
  release: { baseVersion: "1.0.0", channel: "stable" },
};
const config = { protocols: [{ schemes: ["puppyone"] }] };
const repositoryFile = (path) => new URL(`../../../../${path}`, import.meta.url);

describe("system file type registration", () => {
  const types = applyMacosBuilderConfig({ config, baseBuild: {}, identity }).mac.extendInfo.CFBundleDocumentTypes;

  it("declares Markdown, CSV and HTML on macOS", () => {
    expect(types.flatMap((type) => type.LSItemContentTypes)).toEqual([
      "net.daringfireball.markdown",
      "public.comma-separated-values-text",
      "public.html",
    ]);
  });

  it("never claims the user's default app on macOS", () => {
    for (const type of types) {
      expect(type.LSHandlerRank).toBe("Alternate");
      expect(type.CFBundleTypeRole).toBe("Editor");
    }
  });

  it("does not mix content types and extensions in one macOS declaration", () => {
    for (const type of types) expect(type.CFBundleTypeExtensions).toBeUndefined();
  });

  it("does not use electron-builder fileAssociations, which replace Windows defaults", () => {
    const windows = applyWindowsBuilderConfig({ config, identity });
    expect(windows.fileAssociations).toBeUndefined();
    expect(applyMacosBuilderConfig({ config, baseBuild: {}, identity }).fileAssociations).toBeUndefined();
  });

  it("adds Windows Open with entries without touching default handlers", () => {
    const { nsis } = applyWindowsBuilderConfig({ config, identity });
    const script = fs.readFileSync(repositoryFile(nsis.include), "utf8");

    for (const extension of ["md", "markdown", "csv", "html", "htm"]) {
      expect(script).toContain(`FileModeRegisterExtension "${extension}"`);
      expect(script).toContain(`FileModeUnregisterExtension "${extension}"`);
    }
    expect(script).toContain("OpenWithProgids");
    // Writing a value on the extension key itself would change its default handler.
    expect(script).not.toMatch(/WriteRegStr SHELL_CONTEXT "Software\\Classes\\\.\$\{EXT\}" ""/);
  });

  it("offers the same types on Linux and keeps the return link", () => {
    expect(applyLinuxBuilderConfig({ config, identity }).linux.mimeTypes).toEqual([
      "x-scheme-handler/puppyone",
      "text/markdown",
      "text/csv",
      "text/html",
    ]);
  });
});
