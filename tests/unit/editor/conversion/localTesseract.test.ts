import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { createLocalTesseract } from "../../../../src/shared-ui/editor/conversion/localTesseract";
import { extractPdfPage } from "../../../../src/shared-ui/editor/conversion/pdfText";
const require = createRequire(import.meta.url);
const { PNG } = require("pngjs");
const asset = (name: string) => new Uint8Array(readFileSync(require.resolve(name)));

describe("bundled local OCR engine on authored raster scans", () => {
  it("recognizes English, Simplified Chinese, mixed text and exact numeric strings", async () => {
    const engine = await createLocalTesseract(asset("tesseract.js-core/tesseract-core-lstm.wasm"), {
      eng: gunzipSync(asset("@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz")),
      chi_sim: gunzipSync(asset("@tesseract.js-data/chi_sim/4.0.0_best_int/chi_sim.traineddata.gz")),
    }, "chi_sim+eng", () => {});
    try {
      for (const [name, phrases] of Object.entries({ english: ["Document conversion test", "Hello world", "0012", "1234.50"], chinese: ["文档转换测试", "中文识别", "0012", "1234.50"], mixed: ["文档转换", "Document conversion", "Local OCR", "0012", "1234.50"], table: ["0012", "1234.50", "0013", "5678.90"] })) {
        const image = PNG.sync.read(readFileSync(new URL(`../../../fixtures/editor/conversion/${name}.png`, import.meta.url)));
        const result = engine.recognize({ ...image, data: new Uint8ClampedArray(image.data) });
        const text = extractPdfPage(result.items, 1).markdown.replace(/\\/g, "");
        for (const phrase of phrases) expect(text, `${name}: ${text}`).toContain(phrase);
      }
    } finally { engine.close(); }
  }, 60_000);
});
