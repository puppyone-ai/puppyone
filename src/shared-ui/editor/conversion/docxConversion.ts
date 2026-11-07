/// <reference path="./vendor.d.ts" />
import mammoth from "mammoth/mammoth.browser";
import { validateOfficePackageDecompression } from "../security/officePackageValidationTask";
import { convertSemanticHtml } from "./semanticHtml";
import { DocumentConversionError, MAX_CONVERSION_ASSET_BYTES, MAX_CONVERSION_TEXT_BYTES, type ConversionAsset } from "./types";

export async function convertDocx(arrayBuffer: ArrayBuffer) {
  await validateOfficePackageDecompression(arrayBuffer, { profile: "docx" });
  const assets: ConversionAsset[] = [];
  let assetBytes = 0;
  let omitted = false;
  const html = await mammoth.convertToHtml({ arrayBuffer }, {
    externalFileAccess: false,
    includeEmbeddedStyleMap: false,
    styleMap: ["u => u", "strike => del"],
    convertImage: mammoth.images.imgElement(async image => {
      const extensions: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };
      const extension = extensions[image.contentType];
      if (!extension) { omitted = true; return { src: "" }; }
      const bytes = new Uint8Array(await image.readAsArrayBuffer());
      assetBytes += bytes.byteLength;
      if (assetBytes > MAX_CONVERSION_ASSET_BYTES || assets.length >= 200) throw new DocumentConversionError("limit");
      const name = `image-${String(assets.length + 1).padStart(3, "0")}.${extension}`;
      assets.push({ name, mimeType: image.contentType, bytes });
      return { src: `assets/${name}` };
    }),
  });
  if (new TextEncoder().encode(html.value).byteLength > MAX_CONVERSION_TEXT_BYTES) throw new DocumentConversionError("limit");
  const result = convertSemanticHtml(html.value);
  if (html.messages.length) result.warnings.push({ code: "docx-review" });
  if (omitted && !result.warnings.some(item => item.code === "image-omitted")) result.warnings.push({ code: "image-omitted" });
  // Mammoth extracts the current body; revision metadata and page decorations are not an output contract.
  result.warnings.push({ code: "docx-layout" });
  return { ...result, assets };
}
