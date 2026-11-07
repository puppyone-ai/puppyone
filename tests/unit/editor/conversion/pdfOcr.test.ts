import { afterEach, describe, expect, it, vi } from "vitest";
import { convertPdf } from "../../../../src/shared-ui/editor/conversion/pdfConversion";
const mocks = vi.hoisted(() => ({ getDocument: vi.fn(), load: vi.fn(), recognize: vi.fn(), close: vi.fn(), destroy: vi.fn() }));
vi.mock("pdfjs-dist/build/pdf.mjs", () => ({ getDocument: mocks.getDocument, OPS: { paintImageXObject: 85 } }));
vi.mock("pdfjs-dist/build/pdf.worker.mjs", () => ({ WorkerMessageHandler: {} }));
vi.mock("../../../../src/shared-ui/editor/conversion/ocrAssets", () => ({ loadLocalOcr: mocks.load }));
const item = (str: string) => ({ str, width: 200, height: 12, transform: [1, 0, 0, 1, 10, 50], hasEOL: false });
function setup(texts: string[]) {
  const pages = texts.map(str => ({ getTextContent: vi.fn(async () => ({ items: str ? [item(str)] : [] })), getOperatorList: vi.fn(async () => ({ fnArray: [85] })),
    getViewport: ({ scale }: { scale: number }) => ({ width: 612 * scale, height: 792 * scale }), render: vi.fn(() => ({ promise: Promise.resolve() })), cleanup: vi.fn() }));
  mocks.getDocument.mockReturnValue({ promise: Promise.resolve({ numPages: pages.length, getPage: async (number: number) => pages[number - 1] }), destroy: mocks.destroy });
  mocks.load.mockResolvedValue({ recognize: mocks.recognize, close: mocks.close });
  mocks.recognize.mockReturnValue({ items: [item("文档转换 Hello world 0012")], lowConfidence: true });
  vi.stubGlobal("OffscreenCanvas", class { getContext() { return { getImageData: () => ({ data: new Uint8ClampedArray(0), width: 1, height: 1 }) }; } });
  return pages;
}
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });
describe("PDF native text and OCR orchestration", () => {
  it("merges native and scanned pages once in source order and closes resources", async () => {
    const pages = setup(["Native text paragraph that already contains enough readable text.", ""]);
    const result = await convertPdf(new ArrayBuffer(1), () => {});
    expect(result.markdown.indexOf("Native text")).toBeLessThan(result.markdown.indexOf("文档转换"));
    expect(result.markdown.match(/Hello world/g)).toHaveLength(1);
    expect(result.warnings).toContainEqual({ code: "ocr-pages", pages: [2] });
    expect(result.warnings).toContainEqual({ code: "ocr-confidence", pages: [2] });
    expect(mocks.load).toHaveBeenCalledTimes(1); expect(mocks.close).toHaveBeenCalledOnce(); expect(mocks.destroy).toHaveBeenCalledOnce();
    pages.forEach(page => expect(page.cleanup).toHaveBeenCalledOnce());
  });
  it("leaves readable native pages alone in automatic mode", async () => {
    setup(["Native text paragraph that already contains enough readable text."]);
    await convertPdf(new ArrayBuffer(1), () => {}); expect(mocks.load).not.toHaveBeenCalled();
  });
  it("recognizes sparse text pages containing a scan and replaces the duplicate text layer", async () => {
    setup(["1"]); const result = await convertPdf(new ArrayBuffer(1), () => {});
    expect(mocks.recognize).toHaveBeenCalledOnce(); expect(result.markdown).not.toContain("\n\n1\n");
  });
  it("does not load OCR in off mode and reports scan-only content", async () => {
    setup([""]); await expect(convertPdf(new ArrayBuffer(1), () => {}, { mode: "off", language: "eng" })).rejects.toMatchObject({ code: "ocr-required" });
    expect(mocks.load).not.toHaveBeenCalled(); expect(mocks.destroy).toHaveBeenCalledOnce();
  });
  it("reports no readable text after OCR and cleans up on failure", async () => {
    setup([""]); mocks.recognize.mockReturnValueOnce({ items: [], lowConfidence: false });
    await expect(convertPdf(new ArrayBuffer(1), () => {})).rejects.toMatchObject({ code: "ocr-no-text" });
    expect(mocks.close).toHaveBeenCalledOnce(); expect(mocks.destroy).toHaveBeenCalledOnce();
  });
  it("forces recognition of native text when explicitly requested", async () => {
    setup(["Native text paragraph that already contains enough readable text."]);
    await convertPdf(new ArrayBuffer(1), () => {}, { mode: "always", language: "eng" });
    expect(mocks.load).toHaveBeenCalledWith("eng", expect.any(Function));
  });
  it("does not count a page number as successful OCR when the scan has no readable content", async () => {
    setup(["1"]); mocks.recognize.mockReturnValueOnce({ items: [], lowConfidence: false });
    await expect(convertPdf(new ArrayBuffer(1), () => {})).rejects.toMatchObject({ code: "ocr-no-text" });
  });
  it("warns explicitly when forced OCR finds nothing and native text is retained", async () => {
    setup(["A meaningful native paragraph that should remain available if OCR fails to read it."]);
    mocks.recognize.mockReturnValueOnce({ items: [], lowConfidence: false });
    const result = await convertPdf(new ArrayBuffer(1), () => {}, { mode: "always", language: "eng" });
    expect(result.markdown).toContain("meaningful native paragraph");
    expect(result.warnings).toContainEqual({ code: "ocr-empty", pages: [1] });
  });
  it("preserves readable text if automatic image inspection cannot decode an oversized source image", async () => {
    const [page] = setup(["Readable native text beside a photograph that exceeds the image decode budget."]);
    page.getOperatorList.mockRejectedValueOnce(new Error("Image exceeded maximum allowed size and was removed."));
    const result = await convertPdf(new ArrayBuffer(1), () => {});
    expect(result.markdown).toContain("Readable native text");
    expect(result.warnings).toContainEqual({ code: "ocr-skipped", pages: [1] });
    expect(mocks.load).not.toHaveBeenCalled();
  });
});
