/// <reference path="./vendor.d.ts" />
import createCore from "tesseract.js-core/tesseract-core-lstm.js";
import { DocumentConversionError } from "./types";
import { parseOcrTsv, type OcrOptions } from "./ocrLayout";

/** Runs inside the existing disposable conversion Worker; never creates a nested Worker. */
export async function createLocalTesseract(wasmBinary: Uint8Array, models: Record<string, Uint8Array>, language: OcrOptions["language"], progress: (fraction: number) => void) {
  const core = await createCore({ wasmBinary, print: () => {}, printErr: () => {},
    TesseractProgress: (percent: number) => progress(Math.min(1, Math.max(0, (percent - 30) / 70))) });
  core.FS.mkdir("/tessdata");
  for (const name of language.split("+")) {
    if (!models[name]?.byteLength || models[name].byteLength > 32 * 1024 * 1024) throw new DocumentConversionError("ocr-unavailable");
    core.FS.writeFile(`/tessdata/${name}.traineddata`, models[name]);
  }
  const api = new core.TessBaseAPI();
  let disposed = false;
  const close = () => { if (!disposed) { disposed = true; api.End(); core.destroy(api); } };
  try {
    if (api.Init("/tessdata", language, 1) !== 0) throw new DocumentConversionError("ocr-unavailable");
    api.SetVariable("tessedit_pageseg_mode", "3");
    api.SetVariable("preserve_interword_spaces", "1");
  } catch (error) { close(); throw error; }
  return {
    recognize(image: { data: Uint8ClampedArray; width: number; height: number }) {
      const { data, width, height } = image;
      if (disposed || !Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0
        || width * height > 12_000_000 || data.byteLength !== width * height * 4) throw new DocumentConversionError("ocr-page-limit");
      const pointer = core._malloc(data.byteLength);
      if (!pointer) throw new DocumentConversionError("ocr-failed");
      try {
        core.HEAPU8.set(data, pointer);
        api.SetImage(pointer, width, height, 4, width * 4);
        api.SetSourceResolution(200);
        if (api.Recognize(null) !== 0) throw new DocumentConversionError("ocr-failed");
        return parseOcrTsv(api.GetTSVText(0), width, height);
      } finally { api.Clear(); core._free(pointer); }
    },
    close,
  };
}
