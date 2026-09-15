import { describe, expect, it } from "vitest";
import { getIndentGuideCharacterOffsets } from "../../../../../packages/shared-ui/src/editor/viewers/code/codeIndentGuides";

describe("code indentation guides", () => {
  it("renders one guide for each complete indentation level", () => {
    expect(getIndentGuideCharacterOffsets("      return value", 2, 2)).toEqual([0, 2, 4]);
  });

  it("does not imply a complete indentation level for partial whitespace", () => {
    expect(getIndentGuideCharacterOffsets(" return value", 2, 2)).toEqual([]);
  });

  it("uses the configured tab width for tab-indented code", () => {
    expect(getIndentGuideCharacterOffsets("\t\tpass", 4, 4)).toEqual([0, 1]);
  });

  it("stops at the first non-whitespace character", () => {
    expect(getIndentGuideCharacterOffsets("  value  ", 2, 2)).toEqual([0]);
  });
});
