import { describe, expect, it } from "vitest";
import {
  getPreferredMimeType,
  getResolvedFileExtension,
  resolveFileFormat,
} from "../../../../packages/shared-ui/src/core/fileFormats";
import { getEditorSourceRequirement } from "../../../../packages/shared-ui/src/editor/registry/viewerRegistry";

describe("Office family format routing", () => {
  it.each([
    ["report.doc", "application/msword"],
    ["report.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    ["book.xls", "application/vnd.ms-excel"],
    ["book.xlsb", "application/vnd.ms-excel.sheet.binary.macroEnabled.12"],
    ["book.xlsm", "application/vnd.ms-excel.sheet.macroEnabled.12"],
    ["book.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    ["slides.ppsx", "application/vnd.openxmlformats-officedocument.presentationml.slideshow"],
    ["template.ots", "application/vnd.oasis.opendocument.spreadsheet-template"],
  ])("returns the extension-specific preferred MIME for %s", (name, expectedMime) => {
    expect(getPreferredMimeType(name)).toBe(expectedMime);
  });

  it.each([
    ["application/msword", "doc"],
    ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx"],
    ["application/vnd.ms-excel.sheet.binary.macroEnabled.12", "xlsb"],
    ["application/vnd.ms-excel.sheet.macroEnabled.12", "xlsm"],
    ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx"],
    ["application/vnd.openxmlformats-officedocument.presentationml.slideshow", "ppsx"],
    ["application/vnd.oasis.opendocument.spreadsheet-template", "ots"],
  ])("recovers %s parser dispatch without a filename extension", (mimeType, expectedExtension) => {
    const input = { name: "download", mimeType };
    const format = resolveFileFormat(input);
    expect(format.defaultViewer).toBe("office-preview");
    expect(getResolvedFileExtension(input, format)).toBe(expectedExtension);
    expect(getEditorSourceRequirement(input)).toBe("resource");
  });

  it("does not route an unregistered vendor MIME to the Office viewer", () => {
    expect(getEditorSourceRequirement({
      name: "download",
      mimeType: "application/vnd.example.untrusted-office-lookalike",
    })).toBe("none");
  });
});
