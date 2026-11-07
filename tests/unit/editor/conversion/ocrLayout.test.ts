import { describe, expect, it } from "vitest";
import { shouldRecognizePdfPage, normalizeOcrOptions, planOcrRaster, parseOcrTsv, inspectPdfImages } from "../../../../src/shared-ui/editor/conversion/ocrLayout";
import { extractPdfPage } from "../../../../src/shared-ui/editor/conversion/pdfText";

const header = "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext";
const word = (text: string, x: number, y: number, score = 95) => `5\t1\t1\t1\t1\t1\t${x}\t${y}\t${text.length * 20}\t30\t${score}\t${text}`;

describe("scan recognition policy and geometry", () => {
  it("defaults to Chinese and English together and validates the selected mode", () => {
    expect(normalizeOcrOptions(undefined)).toEqual({ mode: "auto", language: "chi_sim+eng" });
    expect(() => normalizeOcrOptions({ mode: "auto", language: "../../secret" })).toThrow();
  });
  it("recognizes empty or sparsely labeled scan pages while retaining ordinary text pages", () => {
    expect(shouldRecognizePdfPage("auto", "", false)).toBe(true);
    expect(shouldRecognizePdfPage("auto", "1", true)).toBe(true);
    expect(shouldRecognizePdfPage("auto", "A real paragraph with enough readable text to use directly.", true)).toBe(false);
    expect(shouldRecognizePdfPage("off", "", true)).toBe(false);
    expect(shouldRecognizePdfPage("always", "Original text", false)).toBe(true);
  });
  it("bounds page raster memory before allocating a canvas", () => {
    const raster = planOcrRaster(612, 792);
    expect(raster.width * raster.height).toBeLessThanOrEqual(12_000_000);
    expect(raster.width).toBeGreaterThan(1500);
    expect(() => planOcrRaster(Infinity, 500)).toThrow();
    expect(() => planOcrRaster(100_000, 100_000)).toThrow();
  });
  it("keeps Chinese characters together and English word spacing", () => {
    const parsed = parseOcrTsv([header, word("文", 10, 30), word("档", 33, 30), word("转换", 56, 30), word("Hello", 10, 100), word("world", 120, 100)].join("\n"), 300, 300);
    const result = extractPdfPage(parsed.items, 1);
    expect(result.markdown).toContain("文档转换");
    expect(result.markdown).toContain("Hello world");
    expect(parsed.lowConfidence).toBe(false);
  });
  it("retains exact numeric text and marks uncertain recognition without hiding it", () => {
    const parsed = parseOcrTsv([header, word("0012", 10, 40, 45), word("1234.50", 200, 40)].join("\n"), 500, 500);
    expect(parsed.items.map(item => item.str)).toEqual(["0012", "1234.50"]);
    expect(parsed.lowConfidence).toBe(true);
  });
  it("rejects invalid output coordinates instead of generating broken tables", () => {
    expect(() => parseOcrTsv([header, word("x", -100, 1)].join("\n"), 500, 500)).toThrow();
  });
  it("recognizes substantial scans beneath a native header and ignores a small logo", () => {
    const codes = { save: 1, restore: 2, transform: 3, paintImageXObject: 4, paintInlineImageXObject: 5, paintImageXObjectRepeat: 6, paintImageMaskXObject: 7 };
    const scan = inspectPdfImages({ fnArray: [1,3,4,2], argsArray: [[],[512,0,0,220,50,420],[],[]] }, codes, 612*792);
    expect(scan).toEqual({ hasImage: true, significant: true });
    expect(shouldRecognizePdfPage("auto", "Long native page header with at least forty characters above the scan", scan.hasImage, scan.significant)).toBe(true);
    expect(inspectPdfImages({ fnArray: [3,4], argsArray: [[20,0,0,20,0,0],[]] }, codes, 612*792).significant).toBe(false);
  });
});
