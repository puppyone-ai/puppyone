import {
  DocumentConversionError, DocumentConversionSaveError, tableToCsv,
  type ConversionSaveRequest, type ConversionSaveResult, type ConvertedDocumentOutputRequest, type DataPort,
} from "@puppyone/shared-ui";

/** Renderer serializes selected outputs; Main authorizes, rechecks and writes the bundle. */
export async function saveDocumentConversion(data: DataPort, request: ConversionSaveRequest): Promise<ConversionSaveResult> {
  const { result, selection } = request;
  const tables = result.tables.filter(table => selection.tableIds.includes(table.id));
  if ((!selection.markdown && !tables.length) || !data.saveDocumentConversion) throw new DocumentConversionError("save-unavailable");
  const stem = request.sourceName.replace(/\.(docx|pdf)$/i, "");
  if (!stem || /[/\\\u0000-\u001f]/.test(stem) || stem === "." || stem === "..") throw new DocumentConversionError("save-unavailable");
  const files: ConvertedDocumentOutputRequest["files"] = [];
  const encoder = new TextEncoder();
  if (selection.markdown) {
    files.push({ path: `${stem}.md`, bytes: encoder.encode(result.markdown) });
    for (const asset of result.assets) files.push({ path: `assets/${asset.name}`, bytes: asset.bytes });
  }
  for (const table of tables) files.push({ path: `tables/${table.id}.csv`, bytes: encoder.encode(tableToCsv(table)) });
  const output = await data.saveDocumentConversion({ path: request.sourcePath, fingerprint: result.fingerprint,
    primaryPath: selection.markdown ? `${stem}.md` : `tables/${tables[0].id}.csv`, files });
  if (!output.ok) {
    if (output.folderPath) throw new DocumentConversionSaveError(output.folderPath);
    throw new DocumentConversionError(output.reason === "source-changed" ? "source-changed" : "save-unavailable");
  }
  return output;
}
