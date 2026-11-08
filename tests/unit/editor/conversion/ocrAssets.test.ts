import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { decodeOcrModel } from "../../../../src/shared-ui/editor/conversion/ocrAssets";
describe("OCR support data decoding across app protocol and HTTP preview", () => {
  it("accepts raw gzip and a model already decoded by HTTP Content-Encoding", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    expect(await decodeOcrModel(gzipSync(bytes))).toEqual(bytes);
    expect(await decodeOcrModel(bytes)).toEqual(bytes);
  });
  it("bounds decoded models and rejects invalid compressed data", async () => {
    await expect(decodeOcrModel(gzipSync(new Uint8Array(33 * 1024 * 1024)))).rejects.toMatchObject({ code: "ocr-unavailable" });
    await expect(decodeOcrModel(new Uint8Array([0x1f, 0x8b, 0]))).rejects.toThrow();
  });
});
