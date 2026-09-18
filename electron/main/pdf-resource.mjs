import fs from "node:fs/promises";
import { resolveExistingWorkspacePath } from "../../local-api/files/path-policy.mjs";
import { parseSingleByteRange } from "../../local-api/files/byte-range.mjs";
import { getPresetViewerDefinitionForViewerId } from "./viewer-packs/preset-viewer-manifest.mjs";

export const PDF_MAX_SOURCE_BYTES = getPresetViewerDefinitionForViewerId("pdf-preview").resourcePolicy.maxSourceBytes;

/** Admission and delivery use the SAME descriptor. Header sniffing deliberately
 * is not a PDF parser: encrypted/structurally broken PDFs remain PDFium's job. */
export async function openPdfResource(rootPath, relativePath, { method = "HEAD", rangeHeader = null, signal } = {}) {
  const filePath = await resolveExistingWorkspacePath(rootPath, relativePath);
  const handle = await fs.open(filePath, "r");
  let stream;
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile()) throw pdfError(415, "PDF resource must be a regular file.");
    if (metadata.size > PDF_MAX_SOURCE_BYTES) throw pdfError(413, "PDF exceeds the 512 MiB preview limit.");
    const header = Buffer.alloc(1024);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    if (!/%PDF-[12]\.\d/.test(header.toString("latin1", 0, bytesRead))) {
      throw pdfError(415, "Resource does not have a PDF header.");
    }
    signal?.throwIfAborted();
    const range = parseSingleByteRange(rangeHeader, metadata.size);
    if (range?.unsatisfiable) return { size: metadata.size, unsatisfiable: true };
    const start = range?.start ?? 0;
    const end = range?.end ?? metadata.size - 1;
    if (method !== "HEAD") {
      // Explicit end also bounds an in-place append after admission. Cancellation
      // of the protocol Response destroys this stream and closes the descriptor.
      stream = handle.createReadStream({ start, end, autoClose: true, signal });
    }
    return { size: metadata.size, start, end, partial: Boolean(range), stream };
  } finally {
    if (!stream) await handle.close();
  }
}

function pdfError(status, message) {
  return Object.assign(new Error(message), { status });
}
