import { describe, expect, it } from "vitest";
import {
  FILE_FORMATS,
  resolveFileFormat,
  UNKNOWN_FORMAT,
} from "../../../../packages/shared-ui/src/core/fileFormats";
import {
  coreViewerCapability,
  PRESET_VIEWER_MANIFEST,
} from "../../../../packages/shared-ui/src/editor/registry/presetViewerManifest";
import { PRESET_VIEWER_CONTRACT_VERSION } from "../../../../packages/shared-ui/src/editor/registry/viewerContract";
import {
  createPresetViewerRegistry,
  definePresetViewer,
  PRESET_VIEWER_REGISTRY,
  PRESET_VIEWERS,
  resolveEditorViewer,
} from "../../../../packages/shared-ui/src/editor/registry/viewerRegistry";
import type {
  EditorDocument,
  EditorViewerMatch,
  PresetViewerContribution,
  PresetViewerImplementation,
} from "../../../../packages/shared-ui/src/editor/registry/viewerTypes";

function document(name: string, type: EditorDocument["type"] = "file", mimeType: string | null = null): EditorDocument {
  return { path: name, name, type, mimeType };
}

function matchFor(name: string): EditorViewerMatch {
  const input = document(name);
  return {
    document: input,
    format: resolveFileFormat({ name }),
    resolvedExtension: name.includes(".") ? name.split(".").pop() ?? null : null,
  };
}

function testPreviewContribution(
  match: PresetViewerContribution["match"],
): PresetViewerContribution {
  return definePresetViewer({
    id: "app-preview",
    match,
    render: () => null,
  });
}

const validFallback = definePresetViewer({
  id: "document-placeholder",
  match: () => true,
  render: () => null,
});

describe("preset viewer contribution contract", () => {
  it("publishes one immutable, versioned registry covering every source shape", () => {
    expect(Object.isFrozen(PRESET_VIEWER_REGISTRY)).toBe(true);
    expect(Object.isFrozen(PRESET_VIEWERS)).toBe(true);
    expect(new Set(PRESET_VIEWERS.map((viewer) => viewer.source))).toEqual(
      new Set(["content", "resource", "content-and-resource"]),
    );
    expect(PRESET_VIEWER_REGISTRY.fallback.source).toBe("none");
    expect(PRESET_VIEWER_REGISTRY.fallback.id).toBe(PRESET_VIEWER_MANIFEST.fallbackViewerId);
    expect(PRESET_VIEWERS.every((viewer) => (
      viewer.contractVersion === PRESET_VIEWER_CONTRACT_VERSION && Object.isFrozen(viewer)
    ))).toBe(true);
    expect(new Set([
      ...PRESET_VIEWERS.map(({ id }) => id),
      PRESET_VIEWER_REGISTRY.fallback.id,
    ])).toEqual(new Set(PRESET_VIEWER_MANIFEST.viewers.map(({ id }) => id)));
  });

  it("declares the layout and first-frame contract for every preset Viewer", () => {
    expect(PRESET_VIEWER_MANIFEST.viewers.every((viewer) => (
      viewer.surfacePreparation === "hidden-safe"
      || viewer.surfacePreparation === "requires-visible"
    ))).toBe(true);
    expect(resolveEditorViewer(document("report.pdf")).viewer).toMatchObject({
      runtime: "eager",
      surfaceIsolation: "inline",
      computeIsolation: "browser-engine",
      contentSandbox: "none",
      resourcePolicy: {
        memoryClass: "large",
        maxSourceBytes: 536_870_912,
        maxCanvasPixels: 0,
        maxActiveCanvases: 0,
        maxWorkers: 0,
      },
      recoveryPolicy: { maxAutomaticRetries: 0, supportsSafeMode: false },
      surfacePreparation: "requires-visible",
      readinessSignal: "frame-paint",
      render: expect.any(Function),
    });
    expect(resolveEditorViewer(document("page.html")).viewer.surfacePreparation)
      .toBe("hidden-safe");
    expect(resolveEditorViewer(document("movie.mp4")).viewer.surfacePreparation)
      .toBe("requires-visible");
    expect(resolveEditorViewer(document("photo.png")).viewer.surfacePreparation)
      .toBe("hidden-safe");
    expect(PRESET_VIEWER_MANIFEST.viewers.every((viewer) => (
      Object.isFrozen(viewer.resourcePolicy) && Object.isFrozen(viewer.recoveryPolicy)
    ))).toBe(true);
    expect(PRESET_VIEWER_MANIFEST.viewers.every((viewer) => (
      (viewer.source === "none") === (viewer.resourcePolicy.maxSourceBytes === 0)
    ))).toBe(true);
    expect(PRESET_VIEWER_MANIFEST.viewers.every((viewer) => (
      viewer.computeIsolation === "worker"
        ? viewer.resourcePolicy.maxWorkers > 0
        : viewer.resourcePolicy.maxWorkers === 0
    ))).toBe(true);
    expect(PRESET_VIEWER_MANIFEST.viewers.every((viewer) => (
      viewer.contentSandbox === "sandboxed-frame"
        ? viewer.surfaceTraits.includes("sandboxed")
        : !viewer.surfaceTraits.includes("sandboxed")
    ))).toBe(true);
  });

  it.each([
    [document("Knowledge.contextmap"), "context-map", "content", "edit"],
    [document("notes.md"), "markdown", "content", "edit"],
    [document("settings.json", "text"), "json", "content", "edit"],
    [document("table.csv"), "csv-table", "content", "edit"],
    [document("page.html"), "html-artifact", "content-and-resource", "edit"],
    [document("photo.png"), "image-preview", "resource", "preview"],
    [document("report.pdf"), "pdf-preview", "resource", "preview"],
    [document("report.docx"), "office-preview", "resource", "preview"],
    [document("sound.mp3"), "audio-preview", "resource", "preview"],
    [document("movie.mp4"), "video-preview", "resource", "preview"],
    [document("source.ts"), "text", "content", "edit"],
    [document("scene.glb"), "document-placeholder", "none", "placeholder"],
  ])("routes %s through the deterministic preset order", (input, id, source, capability) => {
    expect(resolveEditorViewer(input).viewer).toMatchObject({ id, source, capability });
  });

  it("binds implementation to canonical metadata without repeating authority fields", () => {
    const custom = testPreviewContribution(({ document: input }) => input.name === "sample.app");
    const registry = createPresetViewerRegistry([custom], validFallback);

    expect(custom).toMatchObject({
      id: "app-preview",
      capability: "preview",
      source: "content",
      runtime: "eager",
    });
    expect(registry.resolve(matchFor("sample.app")).id).toBe("app-preview");
    expect(registry.resolve(matchFor("sample.unknown")).id).toBe("document-placeholder");
  });

  it("rejects unknown fields, undeclared viewers, and metadata overrides", () => {
    expect(() => definePresetViewer({
      id: "app-preview",
      match: () => true,
      render: () => null,
      network: true,
    } as unknown as PresetViewerImplementation)).toThrow(/unknown field/i);
    expect(() => definePresetViewer({
      id: "undeclared-viewer",
      match: () => true,
      render: () => null,
    })).toThrow(/not declared/i);
    const contribution = testPreviewContribution(() => true);
    expect(() => createPresetViewerRegistry([{
      ...contribution,
      capability: "edit",
    } as PresetViewerContribution], validFallback)).toThrow(/canonical capability/i);
  });

  it("enforces semantic combinations and executable lazy boundaries", () => {
    expect(() => definePresetViewer({
      id: "markdown",
      match: () => true,
      load: async () => ({ default: () => null }),
    })).toThrow(/must define isEditable/i);
    expect(() => definePresetViewer({
      id: "markdown",
      match: () => true,
      isEditable: () => true,
      render: () => null,
    } as unknown as PresetViewerImplementation)).toThrow(/lazy.*load/i);
    expect(() => definePresetViewer({
      id: "image-preview",
      match: () => true,
      normalizeContent: (content) => content,
      render: () => null,
    })).toThrow(/cannot normalize content/i);
    expect(PRESET_VIEWERS.find(({ id }) => id === "markdown")).toMatchObject({
      runtime: "lazy",
      load: expect.any(Function),
    });
    expect(PRESET_VIEWERS.find(({ id }) => id === "office-preview")).toMatchObject({
      runtime: "lazy",
      load: expect.any(Function),
    });
  });

  it("maps every canonical format viewer through the same manifest", () => {
    for (const format of [...FILE_FORMATS, UNKNOWN_FORMAT]) {
      expect(() => coreViewerCapability(format.defaultViewer)).not.toThrow();
      if (format.editable) {
        expect(coreViewerCapability(format.defaultViewer), format.id).toBe("edit");
      }
    }
    expect(coreViewerCapability("markdown")).toBe("edit");
    expect(coreViewerCapability("markdown-editor")).toBe("edit");
    expect(coreViewerCapability("binary-placeholder")).toBe("placeholder");
    expect(() => coreViewerCapability("undeclared-viewer")).toThrow(/not declared/i);
  });

  it("rejects duplicate ids and a dishonest fallback", () => {
    const duplicate = testPreviewContribution(() => true);
    expect(() => createPresetViewerRegistry([duplicate, duplicate], validFallback)).toThrow(/more than once/i);
    expect(() => createPresetViewerRegistry([], duplicate)).toThrow(/fallback must be document-placeholder/i);
  });
});
