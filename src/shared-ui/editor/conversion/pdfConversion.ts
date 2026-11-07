/// <reference path="./vendor.d.ts" />
import { extractPdfPage, type PdfTextItem } from "./pdfText";
import { ConversionPdfBinaryDataFactory } from "./pdfBinaryData";
import { DocumentConversionError, MAX_CONVERSION_TEXT_BYTES, type ConversionTable, type ConversionWarning } from "./types";
import { normalizeOcrOptions, planOcrRaster, shouldRecognizePdfPage, inspectPdfImages, type OcrOptions, type ConversionProgress } from "./ocrLayout";
import { ConversionCanvasFactory, ConversionFilterFactory, MAX_PDF_SOURCE_IMAGE_PIXELS } from "./pdfOcrCanvas";
import type { createLocalTesseract } from "./localTesseract";

export async function convertPdf(arrayBuffer: ArrayBuffer, progress: ConversionProgress, options?: OcrOptions) {
  const ocr = normalizeOcrOptions(options);
  // PDF.js uses its in-process worker handler inside our disposable conversion Worker.
  // The outer Worker owns the timeout/cancellation boundary for parsing and extraction.
  const { WorkerMessageHandler } = await import("pdfjs-dist/build/pdf.worker.mjs");
  (globalThis as typeof globalThis & { pdfjsWorker?: unknown }).pdfjsWorker = { WorkerMessageHandler };
  const { getDocument, OPS } = await import("pdfjs-dist/build/pdf.mjs");
  const task = getDocument({ data: new Uint8Array(arrayBuffer), disableFontFace: true, useSystemFonts: true, useWasm: false,
    stopAtErrors: true, useWorkerFetch: false, BinaryDataFactory: ConversionPdfBinaryDataFactory,
    CanvasFactory: ConversionCanvasFactory, FilterFactory: ConversionFilterFactory, maxImageSize: MAX_PDF_SOURCE_IMAGE_PIXELS });
  let engine: Awaited<ReturnType<typeof createLocalTesseract>> | undefined;
  try {
    const pdf = await task.promise;
    if (pdf.numPages > 100) throw new DocumentConversionError("page-limit");
    const output: string[] = [];
    const tables: ConversionTable[] = [];
    const emptyPages: number[] = [];
    const ocrPages: number[] = [], lowConfidencePages: number[] = [], imagePages: number[] = [], ocrEmptyPages: number[] = [], skippedPages: number[] = [];
    let currentPage = 0;
    let textBytes = 0;
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      currentPage = pageNumber;
      progress(pageNumber, pdf.numPages, "reading");
      const page = await pdf.getPage(pageNumber);
      let canvas: OffscreenCanvas | undefined;
      try {
        const content = await page.getTextContent();
        if (content.items.length > 20_000) throw new DocumentConversionError("limit");
        const items: PdfTextItem[] = [];
        for (const item of content.items) if ("str" in item) items.push(item);
        let result = extractPdfPage(items, pageNumber);
        let imageInfo = { hasImage: false, significant: false };
        const size = page.getViewport({ scale: 1 });
        let inspectionFailed = false;
        if (ocr.mode === "auto" && result.markdown.trim()) {
          try {
            const operators = await page.getOperatorList();
            imageInfo = inspectPdfImages(operators, OPS, size.width * size.height);
          } catch { inspectionFailed = true; skippedPages.push(pageNumber); }
        }
        if (!inspectionFailed && shouldRecognizePdfPage(ocr.mode, result.markdown, imageInfo.hasImage, imageInfo.significant)) {
          progress(pageNumber, pdf.numPages, "ocr-loading");
          if (!engine) engine = await (await import("./ocrAssets")).loadLocalOcr(ocr.language, fraction => progress(currentPage, pdf.numPages, "ocr", fraction));
          const plan = planOcrRaster(size.width, size.height);
          const viewport = page.getViewport({ scale: plan.scale });
          canvas = new OffscreenCanvas(plan.width, plan.height);
          const context = canvas.getContext("2d", { willReadFrequently: true });
          if (!context) throw new DocumentConversionError("ocr-unavailable");
          progress(pageNumber, pdf.numPages, "ocr", 0);
          await page.render({ canvas: null, canvasContext: context as unknown as CanvasRenderingContext2D, viewport, background: "rgb(255,255,255)" }).promise;
          const recognized = engine.recognize(context.getImageData(0, 0, plan.width, plan.height));
          ocrPages.push(pageNumber);
          if (recognized.lowConfidence) lowConfidencePages.push(pageNumber);
          const extracted = extractPdfPage(recognized.items, pageNumber);
          if (extracted.markdown.trim() || result.markdown.replace(/\s/g, "").length < 40) result = extracted;
          else ocrEmptyPages.push(pageNumber);
          progress(pageNumber, pdf.numPages, "ocr", 1);
        } else if (imageInfo.hasImage) imagePages.push(pageNumber);
        textBytes += new TextEncoder().encode(result.markdown).byteLength;
        if (textBytes > MAX_CONVERSION_TEXT_BYTES) throw new DocumentConversionError("limit");
        if (!result.markdown.trim()) emptyPages.push(pageNumber);
        else output.push(`<!-- page ${pageNumber} -->\n\n${result.markdown}`);
        tables.push(...result.tables);
      } finally { if (canvas) canvas.width = canvas.height = 0; page.cleanup(); }
    }
    if (emptyPages.length === pdf.numPages) throw new DocumentConversionError(ocr.mode === "off" ? "ocr-required" : "ocr-no-text");
    const warnings: ConversionWarning[] = [{ code: "pdf-layout" }, { code: "pdf-images" }];
    if (tables.length) warnings.push({ code: "pdf-tables" });
    if (emptyPages.length) warnings.push({ code: "empty-pages", pages: emptyPages });
    if (ocrPages.length) warnings.push({ code: "ocr-pages", pages: ocrPages });
    if (lowConfidencePages.length) warnings.push({ code: "ocr-confidence", pages: lowConfidencePages });
    if (imagePages.length) warnings.push({ code: "image-pages", pages: imagePages });
    if (ocrEmptyPages.length) warnings.push({ code: "ocr-empty", pages: ocrEmptyPages });
    if (skippedPages.length) warnings.push({ code: "ocr-skipped", pages: skippedPages });
    return { markdown: output.join("\n\n") + "\n", tables, assets: [], warnings, pageCount: pdf.numPages };
  } catch (error) {
    if (error instanceof Error && error.name === "PasswordException") throw new DocumentConversionError("encrypted");
    if (error instanceof Error && error.message.includes("Image exceeded maximum allowed size")) throw new DocumentConversionError("ocr-page-limit");
    throw error;
  } finally { try { engine?.close(); } finally { await task.destroy(); } }
}
