import { describe, expect, it } from "vitest";
import {
  createDefaultContextMapDocumentContent,
  fromContextMapRelativePath,
  getContextMapScopePath,
  isContextMapFilename,
  parseContextMapDocument,
  serializeContextMapDocument,
  toContextMapRelativePath,
} from "../../../../../packages/shared-ui/src/editor/viewers/context-map/contextMapDocument";

describe("context map document", () => {
  it("creates and parses a stable portable descriptor", () => {
    const content = createDefaultContextMapDocumentContent();
    const parsed = parseContextMapDocument(content);

    expect(parsed.ok).toBe(true);
    expect(parsed.document.scope).toBe(".");
    expect(serializeContextMapDocument(parsed.document)).toBe(content);
  });

  it("normalizes shared layout state deterministically", () => {
    const parsed = parseContextMapDocument(JSON.stringify({
      version: 1,
      scope: ".",
      layout: {
        expanded: ["civil", "civil", "criminal"],
        offsets: {
          criminal: { x: 10.127, y: -4.555 },
          civil: { x: 2, y: 3 },
        },
      },
    }));

    expect(parsed.ok).toBe(true);
    expect(serializeContextMapDocument(parsed.document)).toContain(
      '"civil": {\n        "x": 2,\n        "y": 3',
    );
    expect(parsed.document.layout.offsets.criminal).toEqual({ x: 10.13, y: -4.55 });
  });

  it("rejects absolute, escaping, unsupported, and unbounded state", () => {
    expect(parseContextMapDocument("{}").ok).toBe(false);
    expect(parseContextMapDocument(JSON.stringify({
      version: 1,
      scope: "../private",
      layout: { expanded: [], offsets: {} },
    })).ok).toBe(false);
    expect(parseContextMapDocument(JSON.stringify({
      version: 1,
      scope: ".",
      layout: { expanded: ["../private"], offsets: {} },
    })).ok).toBe(false);
    expect(parseContextMapDocument(JSON.stringify({
      version: 1,
      scope: ".",
      layout: { expanded: [], offsets: { civil: { x: 2_000_000, y: 0 } } },
    })).ok).toBe(false);
  });

  it("maps persisted relative paths to the containing folder", () => {
    expect(getContextMapScopePath("law/civil/Context Map.contextmap")).toBe("law/civil");
    expect(getContextMapScopePath("Context Map.contextmap")).toBeNull();
    expect(toContextMapRelativePath("law", "law/civil/code.md")).toBe("civil/code.md");
    expect(toContextMapRelativePath("law", "outside.md")).toBeNull();
    expect(fromContextMapRelativePath("law", "civil/code.md")).toBe("law/civil/code.md");
    expect(fromContextMapRelativePath(null, "civil/code.md")).toBe("civil/code.md");
  });

  it("recognizes the product file extension case-insensitively", () => {
    expect(isContextMapFilename("Context Map.contextmap")).toBe(true);
    expect(isContextMapFilename("MAP.CONTEXTMAP")).toBe(true);
    expect(isContextMapFilename("map.json")).toBe(false);
  });
});
