// Bundled support data, resolved by Vite. PDF-supplied URLs never reach this factory.
// Separate assets keep all data fetches within the production CSP's self origin.
const cMaps = import.meta.glob<string>("/node_modules/pdfjs-dist/cmaps/*.bcmap", { query: "?url&no-inline", import: "default", eager: true });
const fonts = import.meta.glob<string>("/node_modules/pdfjs-dist/standard_fonts/*.{pfb,ttf}", { query: "?url&no-inline", import: "default", eager: true });

export class ConversionPdfBinaryDataFactory {
  async fetch({ kind, filename }: { kind: string; filename: string }) {
    let url: string | undefined;
    if (kind === "cMapUrl") url = cMaps[`/node_modules/pdfjs-dist/cmaps/${filename}`];
    if (kind === "standardFontDataUrl") url = fonts[`/node_modules/pdfjs-dist/standard_fonts/${filename}`];
    if (!url) throw new Error("Missing bundled PDF support data.");
    const response = await fetch(url);
    if (!response.ok) throw new Error("Unable to read bundled PDF support data.");
    return new Uint8Array(await response.arrayBuffer());
  }
}
