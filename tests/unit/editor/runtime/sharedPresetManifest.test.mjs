import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseDefinition, parsePresetViewerManifest } from "../../../../shared/presetViewerManifest.js";
import { canonicalManifest } from "../../../support/editor/preset-manifest-cases.mjs";

const expectedManifest = () => ({
  ...canonicalManifest,
  viewers: canonicalManifest.viewers.map((viewer) => ({ contractVersion: 8, ...viewer })),
});

describe("shared preset manifest parser", () => {
  it("returns unchanged canonical metadata through either diagnostics contract", () => {
    for (const diagnostics of ["main", "renderer"]) {
      expect(parsePresetViewerManifest(canonicalManifest, diagnostics)).toEqual(expectedManifest());
    }
  });

  it("copies and freezes definitions, arrays, and policies without freezing the input", () => {
    const input = structuredClone(canonicalManifest.viewers[0]);
    const result = parseDefinition(input, 0);
    for (const value of [result, result.formatViewerIds, result.surfaceTraits, result.resourcePolicy, result.recoveryPolicy]) {
      expect(Object.isFrozen(value)).toBe(true);
    }
    expect(Object.isFrozen(input)).toBe(false);
    input.formatViewerIds.push("new-alias");
    input.surfaceTraits.push("sandboxed");
    input.resourcePolicy.maxSourceBytes = 0;
    input.recoveryPolicy.maxAutomaticRetries = 99;
    expect(result).toEqual({ contractVersion: 8, ...canonicalManifest.viewers[0] });
  });

  it.each([
    ["formatViewerIds", null, "has invalid format viewer ids.", "has invalid or repeated format viewer ids."],
    ["formatViewerIds", ["alias", "alias"], "repeats a format viewer id.", "has invalid or repeated format viewer ids."],
    ["surfaceTraits", null, "has unsupported surface traits.", "has unsupported or repeated surface traits."],
    ["surfaceTraits", ["scrollable", "scrollable"], "repeats a surface trait.", "has unsupported or repeated surface traits."],
  ])("preserves distinct %s diagnostics for %j", (key, value, rendererMessage, mainMessage) => {
    const viewer = { ...canonicalManifest.viewers[0], [key]: value };
    expect(() => parseDefinition(viewer, 0)).toThrow(new TypeError(`Preset viewer ${viewer.id} ${mainMessage}`));
    expect(() => parseDefinition(viewer, 0, "renderer")).toThrow(new TypeError(`Preset viewer ${viewer.id} ${rendererMessage}`));
  });

  it("preserves index labels and unknown-field insertion order", () => {
    expect(() => parseDefinition(null, 7)).toThrow(new TypeError("Preset viewer definition at index 7 must be an object."));
    expect(() => parseDefinition({ z: true, a: true }, 7)).toThrow(new TypeError("Preset viewer definition at index 7 has unknown field(s): z, a."));
  });

  it("preserves the first semantic violation", () => {
    const viewer = { ...canonicalManifest.viewers[0], capability: "edit", source: "none", computeIsolation: "worker" };
    expect(() => parseDefinition(viewer, 0)).toThrow(new TypeError(`Editable preset viewer ${viewer.id} must receive content or a resource.`));
  });

  it("loads the same main-process output from a standalone packaged file layout", () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "preset-manifest-package-"));
    try {
      for (const file of [
        "electron/main/viewer-packs/preset-viewer-manifest.mjs",
        "shared/presetViewerManifest.js",
        "packages/shared-ui/src/editor/registry/presetViewerManifest.json",
      ]) {
        mkdirSync(path.dirname(path.join(directory, file)), { recursive: true });
        copyFileSync(new URL(`../../../../${file}`, import.meta.url), path.join(directory, file));
      }
      writeFileSync(path.join(directory, "package.json"), '{"type":"module"}');
      const output = execFileSync(process.execPath, ["--input-type=module", "-e", `
        import * as manifest from './electron/main/viewer-packs/preset-viewer-manifest.mjs';
        console.log(JSON.stringify({ keys: Object.keys(manifest), value: manifest.PRESET_VIEWER_MANIFEST }));
      `], { cwd: directory, encoding: "utf8" });
      expect(JSON.parse(output)).toEqual({
        keys: ["PRESET_VIEWER_MANIFEST", "capabilityForCoreViewer", "getPresetViewerDefinitionForViewerId"],
        value: expectedManifest(),
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
