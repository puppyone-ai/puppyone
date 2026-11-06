import { describe, expect, it, vi } from "vitest";
import { saveDocumentConversion } from "../../../../src/features/editor-workbench/conversion/saveDocumentConversion";
import type { DataPort, ConversionSaveRequest, ConvertedDocumentOutputRequest } from "../../../../src/shared-ui";
const request = (): ConversionSaveRequest => ({
  sourcePath: "reports/report.docx", sourceName: "report.docx",
  result: { markdown: "# Report\n", fingerprint: "abc", assets: [], warnings: [], tables: [{ id: "table-001", rows: [["Code"], ["0012"]] }] },
  selection: { markdown: true, tableIds: ["table-001"] },
});
function port() {
  return { listChildren: async () => [], saveDocumentConversion: vi.fn(async (_request: ConvertedDocumentOutputRequest) => ({ ok: true as const, folderPath: "reports/report-converted", openPath: "reports/report-converted/report.md", paths: [] })) } satisfies DataPort;
}
describe("conversion output serialization", () => {
  it("passes the source identity and selected text to the narrow host sink", async () => {
    const data = port(); await saveDocumentConversion(data, request());
    const input = data.saveDocumentConversion.mock.calls[0][0];
    expect(input.path).toBe("reports/report.docx"); expect(input.fingerprint).toBe("abc");
    expect(input.files.map(file => [file.path, new TextDecoder().decode(file.bytes)])).toEqual([["report.md", "# Report\n"], ["tables/table-001.csv", "Code\r\n0012\r\n"]]);
  });
  it("maps authoritative source changes to a reconvert error", async () => {
    const data: DataPort = { ...port(), saveDocumentConversion: async () => ({ ok: false, reason: "source-changed" }) };
    await expect(saveDocumentConversion(data, request())).rejects.toThrow("source-changed");
  });
  it("passes generated image bytes rather than a File with no native path", async () => {
    const input = request(); input.result.assets = [{ name: "image-001.png", mimeType: "image/png", bytes: new Uint8Array([1, 2, 3]) }];
    const data = port(); await saveDocumentConversion(data, input);
    expect(data.saveDocumentConversion.mock.calls[0][0].files[1]).toEqual({ path: "assets/image-001.png", bytes: new Uint8Array([1, 2, 3]) });
  });
  it("saves CSV only without unselected images or Markdown", async () => {
    const data = port(); const input = request(); input.selection.markdown = false;
    await saveDocumentConversion(data, input);
    const output = data.saveDocumentConversion.mock.calls[0][0];
    expect(output.primaryPath).toBe("tables/table-001.csv"); expect(output.files).toHaveLength(1);
  });
  it("rejects empty selections before calling the host", async () => {
    const input = request(); input.selection = { markdown: false, tableIds: [] };
    const data = port(); await expect(saveDocumentConversion(data, input)).rejects.toThrow();
    expect(data.saveDocumentConversion).not.toHaveBeenCalled();
  });
});
