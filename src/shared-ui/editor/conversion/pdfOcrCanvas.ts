import { DocumentConversionError } from "./types";

type CanvasEntry = { canvas: OffscreenCanvas | null; context: OffscreenCanvasRenderingContext2D | null };
export const MAX_PDF_SOURCE_IMAGE_PIXELS = 40_000_000;
export class ConversionCanvasFactory {
  create(width: number, height: number): CanvasEntry {
    if (!(width > 0 && height > 0) || width * height > MAX_PDF_SOURCE_IMAGE_PIXELS || width > 12000 || height > 12000) throw new DocumentConversionError("ocr-page-limit");
    const canvas = new OffscreenCanvas(width, height);
    return { canvas, context: canvas.getContext("2d", { willReadFrequently: true }) };
  }
  reset(entry: CanvasEntry, width: number, height: number) {
    if (!(width > 0 && height > 0) || width * height > MAX_PDF_SOURCE_IMAGE_PIXELS || width > 12000 || height > 12000 || !entry.canvas) throw new DocumentConversionError("ocr-page-limit");
    entry.canvas.width = width; entry.canvas.height = height;
  }
  destroy(entry: CanvasEntry) { if (entry.canvas) entry.canvas.width = entry.canvas.height = 0; entry.canvas = null; entry.context = null; }
  getNoAlphaContext(canvas: OffscreenCanvas) { return canvas.getContext("2d", { alpha: false, willReadFrequently: true }); }
}

// PDF.js defaults use DOM SVG filters, unavailable in a Worker. Identity filters
// match its Node factory; accessibility recoloring is irrelevant to OCR rasterization.
export class ConversionFilterFactory {
  addFilter() { return "none"; }
  addHCMFilter() { return "none"; }
  addAlphaFilter() { return "none"; }
  addLuminosityFilter() { return "none"; }
  addKnockoutFilter() { return "none"; }
  addHighlightHCMFilter() { return "none"; }
  addSelectionHCMFilter() { return "none"; }
  addSelectionFilter() { return "none"; }
  createSelectionStyle() { return null; }
  destroy() {}
}
