import { DocumentConversionError, MAX_CONVERSION_SOURCE_BYTES, MAX_CONVERSION_TEXT_BYTES } from "./types";
import { tableToCsv } from "./output";

self.onmessage = async (event: MessageEvent<{ bytes: ArrayBuffer; format: "docx" | "pdf" }>) => {
  try {
    const { bytes, format } = event.data;
    if (!bytes.byteLength || bytes.byteLength > MAX_CONVERSION_SOURCE_BYTES) throw new DocumentConversionError("limit");
    const result = format === "docx"
      ? await (await import("./docxConversion")).convertDocx(bytes)
      : await (await import("./pdfConversion")).convertPdf(bytes, (page, total) => self.postMessage({ type: "progress", page, total }));
    const encoder = new TextEncoder();
    const textBytes = encoder.encode(result.markdown).byteLength + result.tables.reduce((total, table) => total + encoder.encode(tableToCsv(table)).byteLength, 0);
    if (textBytes > MAX_CONVERSION_TEXT_BYTES || result.tables.length + result.assets.length > 499) throw new DocumentConversionError("limit");
    self.postMessage({ type: "result", result });
  } catch (error) {
    self.postMessage({ type: "error", code: error instanceof DocumentConversionError ? error.code : "failed" });
  }
};
