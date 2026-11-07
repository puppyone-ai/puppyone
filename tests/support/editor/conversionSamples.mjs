/** Small authored fixtures with explicit text and no third-party document contents. */
import { deflateSync } from "node:zlib";
import { PNG } from "pngjs";
function pdf(objects) {
  let source = "%PDF-1.4\n"; const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(source)); source += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(source);
  source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) source += `${String(offset).padStart(10, "0")} 00000 n \n`;
  source += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(source);
}
function singlePage(stream, fonts) {
  return pdf([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`, ...fonts,
  ]);
}
export function conversionTablePdf() {
  const lines = [["Document conversion sample", 50, 730], ["Code", 50, 660], ["Amount", 230, 660], ["0012", 50, 630], ["1,234.50", 230, 630], ["0013", 50, 600], ["-5%", 230, 600]];
  const stream = lines.map(([text, x, y]) => `BT /F1 12 Tf ${x} ${y} Td (${text}) Tj ET`).join("\n");
  return singlePage(stream, ["<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"]);
}
export function conversionCjkPdf() {
  const hex = Array.from("文档转换测试").map(char => char.charCodeAt(0).toString(16).padStart(4, "0")).join("");
  return singlePage(`BT /F1 18 Tf 50 700 Td <${hex}> Tj ET`, [
    "<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [6 0 R] >>",
    "<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 4 >> /DW 1000 >>",
  ]);
}
export function conversionScanPdf() {
  return singlePage("0.9 g 40 40 500 700 re f", ["<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"]);
}

/** Real image-only pages: no searchable text layer can satisfy OCR assertions. */
export function conversionRasterPdf(png, withNativePage = false, withNativeHeader = false) {
  const image = PNG.sync.read(png);
  const rgb = Buffer.alloc(image.width * image.height * 3);
  for (let pixel = 0; pixel < image.width * image.height; pixel++) for (let channel = 0; channel < 3; channel++) rgb[pixel * 3 + channel] = image.data[pixel * 4 + channel];
  const encoded = deflateSync(rgb).toString("hex") + ">";
  const stream = `${withNativeHeader ? "BT /F1 12 Tf 50 730 Td (Native header with enough readable text to exceed the threshold.) Tj ET\n" : ""}q 512 0 0 ${512 * image.height / image.width} 50 420 cm /Scan Do Q`;
  const native = "BT /F1 16 Tf 50 700 Td (Native page before scanned content.) Tj ET";
  return pdf([
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${withNativePage ? "6 0 R " : ""}3 0 R] /Count ${withNativePage ? 2 : 1} >>`,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Scan 5 0 R >> ${withNativeHeader ? "/Font << /F1 8 0 R >>" : ""} >> /Contents 4 0 R >>`,
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter [/ASCIIHexDecode /FlateDecode] /Length ${encoded.length} >>\nstream\n${encoded}\nendstream`,
    ...(withNativePage || withNativeHeader ? ["<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 8 0 R >> >> /Contents 7 0 R >>", `<< /Length ${native.length} >>\nstream\n${native}\nendstream`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"] : []),
  ]);
}
