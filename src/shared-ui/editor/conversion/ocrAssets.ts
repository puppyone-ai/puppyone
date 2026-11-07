import wasmUrl from "tesseract.js-core/tesseract-core-lstm.wasm?url&no-inline";
import englishUrl from "@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz?url&no-inline";
import chineseUrl from "@tesseract.js-data/chi_sim/4.0.0_best_int/chi_sim.traineddata.gz?url&no-inline";
import { DocumentConversionError } from "./types";
import { createLocalTesseract } from "./localTesseract";
import type { OcrOptions } from "./ocrLayout";

async function readBounded(stream: ReadableStream<Uint8Array>, limit: number) {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > limit) throw new DocumentConversionError("ocr-unavailable");
      chunks.push(value);
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

async function loadAsset(url: string, compressed = false) {
  // URLs are build-time local assets, never document-provided addresses or a CDN.
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new DocumentConversionError("ocr-unavailable");
  const bytes = await readBounded(response.body, (compressed ? 32 : 8) * 1024 * 1024);
  if (!compressed) return bytes;
  return decodeOcrModel(bytes);
}

export async function decodeOcrModel(bytes: Uint8Array) {
  if (!bytes.byteLength || bytes.byteLength > 32 * 1024 * 1024) throw new DocumentConversionError("ocr-unavailable");
  // HTTP servers can send .gz with Content-Encoding: gzip. Fetch then already
  // decoded it; the app's packaged asset protocol instead returns raw gzip.
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes;
  return readBounded(new Blob([new Uint8Array(bytes)]).stream().pipeThrough(new DecompressionStream("gzip")), 32 * 1024 * 1024);
}

export async function loadLocalOcr(language: OcrOptions["language"], progress: (fraction: number) => void) {
  try {
    const wasm = await loadAsset(wasmUrl);
    const models: Record<string, Uint8Array> = {};
    if (language.includes("chi_sim")) models.chi_sim = await loadAsset(chineseUrl, true);
    if (language.includes("eng")) models.eng = await loadAsset(englishUrl, true);
    return await createLocalTesseract(wasm, models, language, progress);
  } catch (error) {
    if (error instanceof DocumentConversionError) throw error;
    throw new DocumentConversionError("ocr-unavailable");
  }
}
