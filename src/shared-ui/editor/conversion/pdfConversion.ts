/// <reference path="./vendor.d.ts" />
import { extractPdfPage, type PdfTextItem } from "./pdfText";
import { ConversionPdfBinaryDataFactory } from "./pdfBinaryData";
import { DocumentConversionError, MAX_CONVERSION_TEXT_BYTES, type ConversionTable, type ConversionWarning } from "./types";

export async function convertPdf(arrayBuffer: ArrayBuffer, progress: (page: number, total: number) => void) {
  // PDF.js uses its in-process worker handler inside our disposable conversion Worker.
  // The outer Worker owns the timeout/cancellation boundary for parsing and extraction.
  const { WorkerMessageHandler } = await import("pdfjs-dist/build/pdf.worker.mjs");
  (globalThis as typeof globalThis & { pdfjsWorker?: unknown }).pdfjsWorker = { WorkerMessageHandler };
  const { getDocument } = await import("pdfjs-dist/build/pdf.mjs");
  const task = getDocument({ data: new Uint8Array(arrayBuffer), disableFontFace: true, useSystemFonts: true, useWasm: false,
    stopAtErrors: true, useWorkerFetch: false, BinaryDataFactory: ConversionPdfBinaryDataFactory });
  try {
    const pdf = await task.promise;
    if (pdf.numPages > 100) throw new DocumentConversionError("page-limit");
    const output: string[] = [];
    const tables: ConversionTable[] = [];
    const emptyPages: number[] = [];
    let textBytes = 0;
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      progress(pageNumber, pdf.numPages);
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      if (content.items.length > 20_000) throw new DocumentConversionError("limit");
      const items: PdfTextItem[] = [];
      for (const item of content.items) if ("str" in item) items.push(item);
      const result = extractPdfPage(items, pageNumber);
      textBytes += new TextEncoder().encode(result.markdown).byteLength;
      if (textBytes > MAX_CONVERSION_TEXT_BYTES) throw new DocumentConversionError("limit");
      if (!result.markdown.trim()) emptyPages.push(pageNumber);
      else output.push(`<!-- page ${pageNumber} -->\n\n${result.markdown}`);
      tables.push(...result.tables);
      page.cleanup();
    }
    if (emptyPages.length === pdf.numPages) throw new DocumentConversionError("ocr-required");
    const warnings: ConversionWarning[] = [{ code: "pdf-layout" }, { code: "pdf-images" }];
    if (tables.length) warnings.push({ code: "pdf-tables" });
    if (emptyPages.length) warnings.push({ code: "empty-pages", pages: emptyPages });
    return { markdown: output.join("\n\n") + "\n", tables, assets: [], warnings, pageCount: pdf.numPages };
  } catch (error) {
    if (error instanceof Error && error.name === "PasswordException") throw new DocumentConversionError("encrypted");
    throw error;
  } finally { await task.destroy(); }
}
