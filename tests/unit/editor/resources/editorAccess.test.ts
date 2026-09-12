import { describe, expect, it } from "vitest";
import { resolveEditorAccess } from "../../../../packages/shared-ui/src/editor/editorAccess";
import { resolveEditorViewer } from "../../../../packages/shared-ui/src/editor/registry/viewerRegistry";
import type { EditorDocument } from "../../../../packages/shared-ui/src/editor/registry/viewerTypes";

describe("editor access routing", () => {
  it("allows a loaded CSV classified as a spreadsheet to use the editable contribution", () => {
    const document: EditorDocument = {
      path: "Untitled.csv",
      name: "Untitled.csv",
      type: "spreadsheet",
      content: "Column 1,Column 2",
      mimeType: "text/csv; charset=utf-8",
    };
    const route = resolveEditorViewer(document);

    expect(route.viewer.id).toBe("csv-table");
    expect(resolveEditorAccess({
      document,
      ...route,
      content: document.content ?? "",
      persistenceAvailable: true,
    })).toEqual({ kind: "editable" });
  });

  it("never promotes a preview or truncated fallback into an editable source", () => {
    const document: EditorDocument = {
      path: "Untitled.csv",
      name: "Untitled.csv",
      type: "spreadsheet",
      content: null,
      preview: "preview,only",
      mimeType: "text/csv; charset=utf-8",
    };
    const route = resolveEditorViewer(document);

    expect(resolveEditorAccess({
      document,
      ...route,
      content: document.preview ?? "",
      persistenceAvailable: true,
    })).toEqual({ kind: "read-only", reason: "source-unavailable" });
  });

  it("keeps modern Office resources read-only regardless of text persistence", () => {
    const document: EditorDocument = {
      path: "book.xlsx",
      name: "book.xlsx",
      type: "spreadsheet",
      url: "puppyone-local://resource/book.xlsx",
    };
    const route = resolveEditorViewer(document);

    expect(route.viewer.id).toBe("office-preview");
    expect(resolveEditorAccess({
      document,
      ...route,
      content: document.content ?? "",
      persistenceAvailable: true,
    })).toEqual({ kind: "read-only", reason: "viewer-capability" });
    expect(resolveEditorAccess({
      document,
      ...route,
      content: "",
      persistenceAvailable: false,
    })).toEqual({ kind: "read-only", reason: "viewer-capability" });
  });

  it("requires a host persistence capability after format and Viewer approval", () => {
    const document: EditorDocument = {
      path: "Untitled.csv",
      name: "Untitled.csv",
      type: "spreadsheet",
      content: "one,two",
    };
    const route = resolveEditorViewer(document);

    expect(resolveEditorAccess({
      document,
      ...route,
      content: document.content ?? "",
      persistenceAvailable: false,
    })).toEqual({ kind: "read-only", reason: "persistence-unavailable" });
  });

  it("treats the format registry as the edit policy source of truth", () => {
    const document: EditorDocument = {
      path: "Untitled.csv",
      name: "Untitled.csv",
      type: "spreadsheet",
      content: "one,two",
    };
    const route = resolveEditorViewer(document);

    expect(resolveEditorAccess({
      document,
      ...route,
      format: { ...route.format, editable: false },
      content: document.content ?? "",
      persistenceAvailable: true,
    })).toEqual({ kind: "read-only", reason: "format-policy" });
  });
});
