import { describe, expect, it } from "vitest";
import { ExcalidrawDocumentModel, parseWhiteboard } from "../../../../src/shared-ui/editor/viewers/excalidraw/ExcalidrawDocumentModel";
import { getPreviewKindForFormat, getSemanticKindForFormat, isTextLikeFile, resolveFileFormat } from "../../../../src/shared-ui/core/fileFormats";
import { parseCreateNewMenuSettings } from "../../../../src/preferences";
import { getCreateEntryInitialContent, normalizeCreateEntryName } from "../../../../src/features/data-workspace/nodeActions";

const blank = JSON.stringify({ type: "excalidraw", version: 2, elements: [], appState: {}, files: {} });
const changed = JSON.stringify({ ...JSON.parse(blank), appState: { viewBackgroundColor: "#ff0000" } });

describe("standard Excalidraw files", () => {
  it("routes both extensions as editable text-backed whiteboards", () => {
    for (const name of ["Sketch.excalidraw", "Sketch.EXCALIDRAW.JSON"]) {
      const format = resolveFileFormat({ name });
      expect(format.id).toBe("excalidraw");
      expect(getSemanticKindForFormat(format)).toBe("whiteboard");
      expect(getPreviewKindForFormat(format)).toBe("text");
      expect(isTextLikeFile(name)).toBe(true);
      expect(normalizeCreateEntryName("whiteboard", name)).toBe(name);
    }
    expect(normalizeCreateEntryName("whiteboard", "Sketch")).toBe("Sketch.excalidraw");
    const template = getCreateEntryInitialContent("whiteboard", { csvHeaders: ["a", "b", "c"], puppyFlow: { title: "Flow", prompts: ["a", "b"] } });
    expect(parseWhiteboard(template)).toMatchObject({ type: "excalidraw", version: 2, elements: [], files: {} });
  });

  it("keeps original bytes until a semantic edit, then retains edits across view detach", () => {
    const original = `\n${blank}\n`;
    const model = new ExcalidrawDocumentModel(original);
    const before = model.readSnapshot();
    expect(model.acceptScene(blank, 0)).toBe(false);
    expect(model.acceptScene(blank, 0)).toBe(false);
    expect(model.readSnapshot()).toBe(before);
    expect(model.acceptScene(changed, 0)).toBe(true);
    expect(model.retainedSource.readSnapshot().content).toBe(changed);
    expect(model.readSnapshot().revision).not.toBe(before.revision);
    model.setInputEnabled(false);
    expect(model.acceptScene(blank, 0)).toBe(false);
    expect(model.readSnapshot().content).toBe(changed);
  });

  it("adopts AI replacements and rejects stale callbacks from the retired scene", () => {
    const model = new ExcalidrawDocumentModel(blank);
    model.acceptScene(blank, 0);
    model.acceptScene(changed, 0);
    model.replaceContent(blank);
    expect(model.getGeneration()).toBe(1);
    expect(model.acceptScene(changed, 0)).toBe(false);
    expect(model.acceptScene(blank, 1)).toBe(false);
    expect(model.readSnapshot().content).toBe(blank);
    expect(model.acceptScene(changed, 1)).toBe(true);
  });

  it.each(["", "{", "{}", '{"type":"excalidraw","version":99,"elements":[]}', '{"type":"excalidraw","version":2,"elements":[null]}'])("never overwrites an invalid or unsupported scene: %s", (content) => {
    const model = new ExcalidrawDocumentModel(content);
    expect(model.getScene()).toBeNull();
    expect(model.acceptScene(blank, 0)).toBe(false);
    expect(model.readSnapshot().content).toBe(content);
  });

  it("preserves embedded image data and standard element properties", () => {
    const data = { ...JSON.parse(blank), elements: [{ id: "image", type: "image", x: 0, y: 0, width: 20, height: 20, fileId: "file", customData: { note: "keep" } }], files: { file: { id: "file", mimeType: "image/png", dataURL: "data:image/png;base64,AAAA", created: 1 } } };
    expect(parseWhiteboard(JSON.stringify(data))).toEqual(data);
  });

  it("adds Whiteboard to existing menus once and preserves an explicit hidden choice", () => {
    const old = { version: 5, main: ["html", "customFiles", "markdown"], submenu: ["csv"], hidden: ["json"] };
    const upgraded = parseCreateNewMenuSettings(JSON.stringify(old));
    expect(upgraded.main).toEqual(["html", "whiteboard", "customFiles", "markdown"]);
    expect(parseCreateNewMenuSettings(JSON.stringify(upgraded))).toEqual(upgraded);
    const hidden = parseCreateNewMenuSettings(JSON.stringify({ ...old, hidden: ["json", "whiteboard"] }));
    expect(hidden.main).toEqual(old.main);
    expect(hidden.hidden).toContain("whiteboard");
  });
});
