import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { convertDocx } from "../../../../src/shared-ui/editor/conversion/docxConversion";

describe("real DOCX conversion", () => {
  it("converts the repository's real Word fixture", async () => {
    const bytes = await readFile(new URL("../../../fixtures/editor/formats/samples/puppyone-preview-sample.docx", import.meta.url));
    const result = await convertDocx(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    expect(result.markdown.trim().length).toBeGreaterThan(100);
    expect(result.markdown).not.toContain("data:image");
    expect(result.tables.length).toBeGreaterThan(0);
  });
  it("rejects a malformed package", async () => {
    await expect(convertDocx(new TextEncoder().encode("not a docx").buffer)).rejects.toThrow();
  });
  it("converts a minimal package without changing numeric text", async () => {
    const zip = new JSZip();
    zip.file("_rels/.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
    zip.file("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
    zip.file("word/document.xml", '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>文档转换 Original 0012 金额 1234.50</w:t></w:r></w:p></w:body></w:document>');
    const result = await convertDocx(await zip.generateAsync({ type: "arraybuffer" }));
    expect(result.markdown.replace(/\\/g, "")).toContain("文档转换 Original 0012 金额 1234.50");
  });
});
