import { DocumentConversionError, MAX_CONVERSION_TEXT_BYTES } from "./types";
import type { PdfTextItem } from "./pdfText";

export type OcrOptions = { mode: "auto" | "always" | "off"; language: "eng" | "chi_sim" | "chi_sim+eng" };
export type ConversionProgress = (page: number, total: number, stage?: "reading" | "ocr-loading" | "ocr", fraction?: number) => void;

export function normalizeOcrOptions(value?: unknown): OcrOptions {
  if (value === undefined) return { mode: "auto", language: "chi_sim+eng" };
  if (!value || typeof value !== "object" || !("mode" in value) || !("language" in value)
    || value.mode !== "auto" && value.mode !== "always" && value.mode !== "off"
    || value.language !== "eng" && value.language !== "chi_sim" && value.language !== "chi_sim+eng") throw new DocumentConversionError("ocr-options");
  return { mode: value.mode, language: value.language };
}

export function shouldRecognizePdfPage(mode: OcrOptions["mode"], text: string, hasRasterImage: boolean, significantImage = false) {
  return mode === "always" || mode === "auto" && (!text.trim() || significantImage || hasRasterImage && text.replace(/\s/g, "").length < 40);
}

export function inspectPdfImages(operators: { fnArray: number[]; argsArray: unknown[][] }, codes: { save: number; restore: number; transform: number; paintImageXObject: number; paintInlineImageXObject: number; paintImageXObjectRepeat: number; paintImageMaskXObject: number }, pageArea: number) {
  if (operators.fnArray.length > 150_000) throw new DocumentConversionError("limit");
  let matrix = [1, 0, 0, 1, 0, 0], hasImage = false, significant = false, area = 0;
  const stack: number[][] = [];
  for (let index = 0; index < operators.fnArray.length; index++) {
    const code = operators.fnArray[index];
    if (code === codes.save) stack.push([...matrix]);
    else if (code === codes.restore) matrix = stack.pop() ?? [1, 0, 0, 1, 0, 0];
    else if (code === codes.transform) {
      const next = operators.argsArray[index] as number[];
      if (next.length !== 6 || !next.every(Number.isFinite)) throw new DocumentConversionError("failed");
      const [a,b,c,d,e,f] = matrix, [g,h,i,j,k,l] = next;
      matrix = [a*g+c*h, b*g+d*h, a*i+c*j, b*i+d*j, a*k+c*l+e, b*k+d*l+f];
    } else if ([codes.paintImageXObject, codes.paintInlineImageXObject, codes.paintImageXObjectRepeat, codes.paintImageMaskXObject].includes(code)) {
      hasImage = true;
      const imageArea = Math.abs(matrix[0]*matrix[3] - matrix[1]*matrix[2]);
      area += imageArea;
      significant ||= imageArea >= pageArea * 0.15 || area >= pageArea * 0.25;
    }
  }
  return { hasImage, significant };
}

export function planOcrRaster(width: number, height: number) {
  if (![width, height].every(value => Number.isFinite(value) && value > 0)) throw new DocumentConversionError("ocr-page-limit");
  const scale = Math.min(200 / 72, 6000 / Math.max(width, height), Math.sqrt(12_000_000 / (width * height)));
  if (scale < 100 / 72) throw new DocumentConversionError("ocr-page-limit");
  return { width: Math.floor(width * scale), height: Math.floor(height * scale), scale };
}

export function parseOcrTsv(tsv: string, width: number, height: number) {
  if (new TextEncoder().encode(tsv).byteLength > MAX_CONVERSION_TEXT_BYTES) throw new DocumentConversionError("limit");
  const items: PdfTextItem[] = [];
  let lowConfidence = false;
  let lastLine = "", lastY = 0, lastTop = 0;
  for (const line of tsv.split("\n").slice(1)) {
    const fields = line.split("\t");
    if (fields[0] !== "5") continue;
    const str = fields.slice(11).join("\t").trim();
    if (!str) continue;
    const [left, top, wordWidth, wordHeight, confidence] = fields.slice(6, 11).map(Number);
    if (![left, top, wordWidth, wordHeight, confidence].every(Number.isFinite) || left < 0 || top < 0 || wordWidth <= 0 || wordHeight <= 0
      || left + wordWidth > width + 1 || top + wordHeight > height + 1 || confidence < 0 || confidence > 100) throw new DocumentConversionError("ocr-failed");
    if (items.length >= 20_000) throw new DocumentConversionError("limit");
    // A shared line baseline prevents ascenders/descenders from splitting one OCR line.
    const lineKey = fields.slice(1, 5).join(":");
    const previous = items.length && lineKey === lastLine && Math.abs(lastTop - top) < wordHeight * 0.6 ? lastY : height - top;
    items.push({ str, width: wordWidth, height: wordHeight, transform: [1, 0, 0, 1, left, previous], hasEOL: false });
    lastLine = lineKey; lastY = previous; lastTop = top;
    lowConfidence ||= confidence < 70;
  }
  return { items, lowConfidence };
}
