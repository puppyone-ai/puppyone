import { describe, expect, it } from "vitest";
import { convertSemanticHtml } from "../../../../src/shared-ui/editor/conversion/semanticHtml";
import { extractPdfPage } from "../../../../src/shared-ui/editor/conversion/pdfText";
import { tableToCsv } from "../../../../src/shared-ui/editor/conversion/output";

describe("semantic document conversion", () => {
  it("keeps structure and literal punctuation without retaining active HTML", () => {
    const result = convertSemanticHtml('<h1>Report</h1><p>A <strong>clear</strong> result: 2 * 3.</p><ul><li>One</li><li>Two</li></ul><p><a href="javascript:alert(1)">unsafe</a> <a href="https://example.com">safe</a></p><script>bad()</script>');
    expect(result.markdown).toContain("# Report");
    expect(result.markdown).toContain("**clear**");
    expect(result.markdown).toContain("2 \\* 3");
    expect(result.markdown).toContain("- One\n- Two");
    expect(result.markdown).toContain("[safe](https://example.com)");
    expect(result.markdown).not.toMatch(/javascript|bad\(\)|<script/);
  });
  it("extracts tables once for both Markdown and CSV, preserving exact cell values", () => {
    const result = convertSemanticHtml('<table><tr><th>Code</th><th>Amount</th></tr><tr><td>0012</td><td>1,234.50</td></tr><tr><td>A|B</td><td>"quoted"</td></tr></table>');
    expect(result.tables[0].rows).toEqual([["Code", "Amount"], ["0012", "1,234.50"], ["A|B", '"quoted"']]);
    expect(result.markdown).toContain("A\\|B");
    expect(tableToCsv(result.tables[0])).toBe('Code,Amount\r\n0012,"1,234.50"\r\nA|B,"""quoted"""\r\n');
  });
  it("preserves merged-cell position, leaves covered cells blank and reports the loss", () => {
    const result = convertSemanticHtml('<table><tr><td rowspan="2">Group</td><td>A</td></tr><tr><td>B</td></tr></table>');
    expect(result.tables[0].rows).toEqual([["Group", "A"], ["", "B"]]);
    expect(result.warnings.map(item => item.code)).toContain("merged-cells");
  });
  it("rejects huge grids instead of silently omitting rows", () => {
    expect(() => convertSemanticHtml('<table><tr><td colspan="999999">x</td></tr></table>')).toThrow();
  });
  it("keeps distinct cell paragraphs and prevents plain text becoming Markdown syntax", () => {
    const result = convertSemanticHtml('<p>~~literal~~ $x$ &amp;copy;</p><p>1. literal</p><p>---</p><table><tr><td><p>Alpha</p><p>Beta</p></td></tr></table>');
    expect(result.tables[0].rows).toEqual([["Alpha\nBeta"]]);
    expect(result.markdown).toContain("\\~\\~literal\\~\\~ \\$x\\$ \\&copy;");
    expect(result.markdown).toContain("1\\. literal");
    expect(result.markdown).toContain("\\-\\-\\-");
  });
  it("preserves cell links and image references in Markdown and text in CSV", () => {
    const result = convertSemanticHtml('<table><tr><td><a href="https://example.com">Reference</a><img src="assets/image-001.png" alt="Chart"></td></tr></table>');
    expect(result.markdown).toContain("[Reference](https://example.com)");
    expect(result.markdown).toContain("![Chart](assets/image-001.png)");
    expect(result.tables[0].rows[0][0]).toContain("Chart");
  });
});

describe("text PDF extraction", () => {
  const text = (str: string, x: number, y: number) => ({ str, transform: [12, 0, 0, 12, x, y], width: str.length * 6, height: 12, hasEOL: false });
  it("restores line order and extracts a repeated aligned table without parsing numbers", () => {
    const result = extractPdfPage([text("Code", 10, 100), text("Amount", 160, 100), text("0012", 10, 80), text("1,234.50", 160, 80), text("0013", 10, 60), text("-5%", 160, 60)], 2);
    expect(result.tables[0].rows).toEqual([["Code", "Amount"], ["0012", "1,234.50"], ["0013", "-5%"]]);
    expect(result.tables[0].page).toBe(2);
  });
  it("does not turn ordinary prose lines into guessed CSV", () => {
    const result = extractPdfPage([text("One sentence.", 10, 100), text("Another sentence.", 10, 80)], 1);
    expect(result.tables).toEqual([]);
    expect(result.markdown).toContain("One sentence\\.");
  });
});
