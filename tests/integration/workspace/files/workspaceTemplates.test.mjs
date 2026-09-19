import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  BUILT_IN_SLIDES_TEMPLATE_ID,
  instantiateWorkspaceTemplate,
} from "../../../../local-api/workspace-templates.mjs";
import { parseAppPreviewManifest } from "../../../../shared/appPreviewManifest.js";

let workspaceRoot = null;

afterEach(async () => {
  if (workspaceRoot) await rm(workspaceRoot, { recursive: true, force: true });
  workspaceRoot = null;
});

describe("built-in Slides workspace template", () => {
  it("atomically creates a portable, configured PuppyOne App bundle", async () => {
    workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "puppyone-slides-"));
    const result = await instantiateWorkspaceTemplate(workspaceRoot, {
      templateId: BUILT_IN_SLIDES_TEMPLATE_ID,
      parentPath: null,
      name: "Quarterly & Plan",
    }, { fontBytes: Buffer.from("font-fixture") });

    expect(result).toEqual({
      rootPath: "Quarterly & Plan",
      openPath: "Quarterly & Plan/Quarterly & Plan.puppyoneapp",
      createdPaths: [
        "Quarterly & Plan",
        "Quarterly & Plan/Quarterly & Plan.puppyoneapp",
        "Quarterly & Plan/index.html",
        "Quarterly & Plan/puppyone-slides.css",
        "Quarterly & Plan/puppyone-slides.js",
        "Quarterly & Plan/assets",
        "Quarterly & Plan/assets/geist-sans.woff2",
      ],
      template: { id: "slides.default", version: 1 },
    });

    const manifestText = await readFile(
      path.join(workspaceRoot, result.openPath),
      "utf8",
    );
    expect(parseAppPreviewManifest(manifestText, { appPath: result.openPath })).toMatchObject({
      name: "Quarterly & Plan",
      launch: { kind: "static-file", path: "index.html" },
      permissions: { workspace: [] },
    });
    const html = await readFile(path.join(workspaceRoot, result.rootPath, "index.html"), "utf8");
    const css = await readFile(path.join(workspaceRoot, result.rootPath, "puppyone-slides.css"), "utf8");
    expect(html).toContain("Quarterly &amp; Plan");
    expect(html).not.toMatch(/https?:\/\//);
    expect(css).toContain("--po-slide-accent");
    expect(css).toContain('url("assets/geist-sans.woff2")');
    expect(await readFile(path.join(workspaceRoot, result.rootPath, "assets/geist-sans.woff2"), "utf8"))
      .toBe("font-fixture");
    expect((await readdir(workspaceRoot)).some((name) => name.startsWith(".puppyone-template-")))
      .toBe(false);
  });

  it("keeps both bundles on name collision and leaves no partial output on validation failure", async () => {
    workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "puppyone-slides-"));
    const request = {
      templateId: BUILT_IN_SLIDES_TEMPLATE_ID,
      parentPath: null,
      name: "Deck",
    };
    const results = await Promise.all([
      instantiateWorkspaceTemplate(workspaceRoot, request, { fontBytes: Buffer.from("font") }),
      instantiateWorkspaceTemplate(workspaceRoot, request, { fontBytes: Buffer.from("font") }),
    ]);
    expect(results.map((result) => result.rootPath).sort()).toEqual(["Deck", "Deck 2"]);

    await expect(instantiateWorkspaceTemplate(workspaceRoot, {
      ...request,
      name: "Broken",
    })).rejects.toThrow(/font asset is unavailable/i);
    expect(await readdir(workspaceRoot)).toEqual(["Deck", "Deck 2"]);
  });

  it("rejects traversal and unknown template ids before writing", async () => {
    workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "puppyone-slides-"));
    await expect(instantiateWorkspaceTemplate(workspaceRoot, {
      templateId: BUILT_IN_SLIDES_TEMPLATE_ID,
      parentPath: null,
      name: "../escape",
    }, { fontBytes: Buffer.from("font") })).rejects.toThrow(/invalid/i);
    await expect(instantiateWorkspaceTemplate(workspaceRoot, {
      templateId: "slides.remote",
      parentPath: null,
      name: "Deck",
    }, { fontBytes: Buffer.from("font") })).rejects.toThrow(/unsupported/i);
    expect(await readdir(workspaceRoot)).toEqual([]);
  });
});
