import { describe, expect, it } from "vitest";
import {
  AppPreviewManifestError,
  createUnconfiguredAppPreviewManifestContent,
  getAppPreviewManifestDisplayName,
  interpolateAppPreviewCommand,
  normalizeAppPreviewManifest,
  parseAppPreviewManifest,
} from "../../../../../shared/appPreviewManifest.js";

function manifest(overrides = {}) {
  return {
    type: "puppyone.app",
    version: 1,
    name: "Deck preview",
    launch: {
      kind: "local-server",
      command: ["npm", "run", "dev", "--", "--port", "${port}"],
      cwd: ".",
      env: { PREVIEW_PORT: "${port}" },
      url: "http://127.0.0.1:${port}/",
      health: { path: "/", expectStatus: 200 },
    },
    permissions: { workspace: ["read"] },
    ...overrides,
  };
}

describe("App Preview manifest contract", () => {
  it("treats a newly created app as a valid, unconfigured document", () => {
    const content = createUnconfiguredAppPreviewManifestContent();
    const parsed = parseAppPreviewManifest(content, { appPath: "Untitled App.puppyoneapp" });
    expect(parsed.name).toBe("Untitled App");
    expect(parsed.launch).toBeNull();
    expect(parsed.permissions.workspace).toEqual([]);
  });

  it("normalizes static HTML and existing URL launch definitions", () => {
    expect(normalizeAppPreviewManifest({
      type: "puppyone.app",
      version: 1,
      launch: { kind: "static-file", path: "slides/index.html" },
    }).launch).toEqual({ kind: "static-file", path: "slides/index.html" });
    expect(normalizeAppPreviewManifest({
      type: "puppyone.app",
      version: 1,
      launch: { kind: "existing-url", url: "http://localhost:4173" },
    }).launch).toEqual({ kind: "existing-url", url: "http://localhost:4173/" });
    expect(() => normalizeAppPreviewManifest({
      type: "puppyone.app",
      version: 1,
      launch: { kind: "existing-url", url: "javascript:alert(1)" },
    })).toThrow(/HTTP or HTTPS/i);
    expect(() => normalizeAppPreviewManifest({
      type: "puppyone.app",
      version: 1,
      launch: { kind: "existing-url", url: "https://example.com", command: ["unexpected"] },
    })).toThrow(/unsupported fields/i);
  });

  it("normalizes the versioned manifest and interpolates only declared variables", () => {
    const parsed = normalizeAppPreviewManifest(manifest(), { appPath: "decks/pitch.puppyoneapp" });
    expect(parsed.name).toBe("Deck preview");
    expect(parsed.launch.cwd).toBe(".");
    expect(parsed.permissions.workspace).toEqual(["read"]);
    expect(interpolateAppPreviewCommand(parsed.launch.command, { port: 4317 })).toEqual([
      "npm", "run", "dev", "--", "--port", "4317",
    ]);
  });

  it("rejects unknown fields, workspace escapes and undeclared templates", () => {
    expect(() => normalizeAppPreviewManifest({ ...manifest(), surprise: true }))
      .toThrow(/unsupported fields/i);
    expect(() => normalizeAppPreviewManifest({
      ...manifest(),
      launch: { ...manifest().launch, cwd: "../../outside" },
    })).toThrow(/inside the workspace/i);
    expect(() => normalizeAppPreviewManifest({
      ...manifest(),
      launch: { ...manifest().launch, cwd: "/absolute/path" },
    })).toThrow(/relative path/i);
    expect(() => normalizeAppPreviewManifest({
      ...manifest(),
      launch: { ...manifest().launch, cwd: "C:\\absolute\\path" },
    })).toThrow(/relative path/i);
    expect(() => normalizeAppPreviewManifest({
      ...manifest(),
      launch: { ...manifest().launch, command: ["npm", "--token", "${secret}"] },
    })).toThrow(/unsupported variable/i);
  });

  it("returns stable display fallback while preserving structured parse failures", () => {
    expect(getAppPreviewManifestDisplayName("not-json", "decks/company.puppyoneapp"))
      .toBe("company");
    expect(() => parseAppPreviewManifest("not-json"))
      .toThrow(AppPreviewManifestError);
  });
});
