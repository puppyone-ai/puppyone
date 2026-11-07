declare module "mammoth/mammoth.browser" {
  import mammoth = require("mammoth");
  export = mammoth;
}
declare module "pdfjs-dist/build/pdf.worker.mjs" {
  export const WorkerMessageHandler: unknown;
}
declare module "pdfjs-dist/build/pdf.mjs" {
  export { getDocument, OPS } from "pdfjs-dist";
}
declare module "tesseract.js-core/tesseract-core-lstm.js" {
  type Api = {
    Init(path: string, language: string, mode: number): number;
    SetVariable(name: string, value: string): boolean;
    SetImage(pointer: number, width: number, height: number, channels: number, stride: number): void;
    SetSourceResolution(dpi: number): void;
    Recognize(monitor: null): number;
    GetTSVText(page: number): string;
    Clear(): void; End(): void;
  };
  export default function createCore(options: { wasmBinary: Uint8Array; print(message: string): void; printErr(message: string): void; TesseractProgress(percent: number): void }): Promise<{
    FS: { mkdir(path: string): void; writeFile(path: string, bytes: Uint8Array): void };
    TessBaseAPI: new () => Api; destroy(api: Api): void;
    _malloc(size: number): number; _free(pointer: number): void; HEAPU8: Uint8Array;
  }>;
}
