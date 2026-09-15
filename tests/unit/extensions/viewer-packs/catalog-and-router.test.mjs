import { describe, expect, it } from "vitest";
import { createDisabledCatalogTransport, CatalogDisabledError } from "../../../../electron/main/viewer-packs/catalog-transport.mjs";
import { createViewerPackCatalogService } from "../../../../electron/main/viewer-packs/catalog-service.mjs";
import { resolveViewerPackRoute } from "../../../../electron/main/viewer-packs/router.mjs";
import { coreViewerCapability, resolveViewerRoute } from "../../../../packages/shared-ui/src/editor/registry/viewerCapability.ts";
import { EMPTY_VIEWER_PACK_SNAPSHOT } from "../../../../packages/shared-ui/src/editor/registry/viewerPackTypes.ts";
import { resolveCoreFormatPolicy } from "../../../../electron/main/viewer-packs/core-format-policy.mjs";
import {
  capabilityForCoreViewer as mainCoreViewerCapability,
  PRESET_VIEWER_MANIFEST as MAIN_PRESET_VIEWER_MANIFEST,
} from "../../../../electron/main/viewer-packs/preset-viewer-manifest.mjs";
import { PRESET_VIEWER_MANIFEST } from "../../../../packages/shared-ui/src/editor/registry/presetViewerManifest.ts";

describe("viewer pack catalog", () => {
  it("is disabled by default and never networks", async () => {
    const transport = createDisabledCatalogTransport();
    expect(transport.enabled).toBe(false);
    await expect(transport.fetchIndex()).rejects.toBeInstanceOf(CatalogDisabledError);
    await expect(transport.download()).rejects.toBeInstanceOf(CatalogDisabledError);

    const catalog = createViewerPackCatalogService({ transport });
    expect(catalog.getState().status).toBe("disabled");
    expect(catalog.findCachedCandidates()).toEqual([]);
    const refreshed = await catalog.refresh();
    expect(refreshed.status).toBe("disabled");
  });
});

describe("viewer pack router", () => {
  const contribution = {
    pluginId: "ai.puppyone.viewer.glb",
    publisher: "puppyone",
    version: "1.0.0",
    label: "glTF Binary Scene",
    enabled: true,
    contentHash: "abc",
    viewer: {
      entry: "viewer.html",
      source: "range-resource",
      sources: ["local"],
      runtime: ["worker"],
    },
    formats: [
      {
        id: "glb",
        label: "glTF Binary Scene",
        extensions: [".glb"],
        mimeTypes: ["model/gltf-binary"],
        category: "binary",
        defaultViewer: "plugin:ai.puppyone.viewer.glb",
        editable: false,
      },
    ],
    permissions: {
      currentDocument: ["metadata", "readRange"],
      relatedFiles: "none",
      network: [],
    },
    installedAt: "2026-01-01T00:00:00.000Z",
  };

  const snapshot = {
    sequence: 1,
    generatedAt: "2026-01-01T00:00:00.000Z",
    contributions: [contribution],
  };

  it("keeps core edit ownership for markdown", () => {
    expect(coreViewerCapability("markdown")).toBe("edit");
    const route = resolveViewerRoute({
      coreViewerId: "markdown",
      extensions: [".md"],
      mimeTypes: ["text/markdown"],
      snapshot,
      sourceKind: "local",
    });
    expect(route.kind).toBe("core");
    expect(route.capability).toBe("edit");
  });

  it("derives the authoritative core gate from the shared file-format registry", () => {
    expect(resolveCoreFormatPolicy({ name: "notes.md", mimeType: "text/markdown" }))
      .toMatchObject({ viewerId: "markdown-editor", capability: "edit" });
    expect(resolveCoreFormatPolicy({ name: "scene.glb", mimeType: "model/gltf-binary" }))
      .toMatchObject({ viewerId: "binary-placeholder", capability: "placeholder" });
  });

  it("keeps renderer and main capability policy on one canonical manifest", () => {
    expect(MAIN_PRESET_VIEWER_MANIFEST).toEqual(PRESET_VIEWER_MANIFEST);
    for (const definition of PRESET_VIEWER_MANIFEST.viewers) {
      for (const viewerId of [definition.id, ...definition.formatViewerIds]) {
        expect(mainCoreViewerCapability(viewerId)).toBe(coreViewerCapability(viewerId));
      }
    }
    expect(() => mainCoreViewerCapability("undeclared-viewer")).toThrow(/not declared/i);
  });

  it("routes local placeholder .glb to the installed pack", () => {
    const route = resolveViewerPackRoute({
      name: "scene.glb",
      mimeType: "model/gltf-binary",
      sourceKind: "local",
      coreViewerCapability: "placeholder",
      snapshot,
    });
    expect(route.kind).toBe("plugin");
    expect(route.pluginId).toBe("ai.puppyone.viewer.glb");
  });

  it("fail-closes cloud sources before activation", () => {
    const route = resolveViewerRoute({
      coreViewerId: "document-placeholder",
      extensions: [".glb"],
      mimeTypes: ["model/gltf-binary"],
      snapshot,
      sourceKind: "cloud",
    });
    expect(route).toEqual({ kind: "unsupported", reason: "cloud-source" });
    expect(resolveViewerRoute({
      coreViewerId: "document-placeholder",
      extensions: [".glb"],
      mimeTypes: [],
      snapshot,
      sourceKind: "unknown",
    })).toEqual({ kind: "unsupported", reason: "cloud-source" });
  });

  it("returns chooser when multiple packs match", () => {
    const second = {
      ...contribution,
      pluginId: "ai.puppyone.viewer.glb.alt",
      label: "Alt GLB",
    };
    const multi = {
      ...snapshot,
      contributions: [contribution, second],
    };
    const route = resolveViewerRoute({
      coreViewerId: "document-placeholder",
      extensions: [".glb"],
      mimeTypes: [],
      snapshot: multi,
      sourceKind: "local",
    });
    expect(route.kind).toBe("chooser");
    expect(route.candidates).toHaveLength(2);
  });

  it("returns no-match against an empty snapshot", () => {
    const route = resolveViewerRoute({
      coreViewerId: "document-placeholder",
      extensions: [".glb"],
      mimeTypes: [],
      snapshot: EMPTY_VIEWER_PACK_SNAPSHOT,
      sourceKind: "local",
    });
    expect(route).toEqual({ kind: "unsupported", reason: "no-match" });
  });

  it("matches compound extensions deterministically", () => {
    const compoundContribution = {
      ...contribution,
      pluginId: "ai.puppyone.viewer.tar-gz",
      formats: [{
        ...contribution.formats[0],
        extensions: [".tar.gz"],
        mimeTypes: [],
        defaultViewer: "plugin:ai.puppyone.viewer.tar-gz",
      }],
    };
    const route = resolveViewerPackRoute({
      name: "model.tar.gz",
      sourceKind: "local",
      coreViewerCapability: "placeholder",
      snapshot: {
        ...snapshot,
        contributions: [
          compoundContribution,
          {
            ...contribution,
            pluginId: "ai.puppyone.viewer.gz",
            formats: [{
              ...contribution.formats[0],
              extensions: [".gz"],
              mimeTypes: [],
              defaultViewer: "plugin:ai.puppyone.viewer.gz",
            }],
          },
        ],
      },
    });
    expect(route.kind).toBe("plugin");
    expect(route.pluginId).toBe(compoundContribution.pluginId);
  });
});
