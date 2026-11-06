declare module "mammoth/mammoth.browser" {
  import mammoth = require("mammoth");
  export = mammoth;
}
declare module "pdfjs-dist/build/pdf.worker.mjs" {
  export const WorkerMessageHandler: unknown;
}
declare module "pdfjs-dist/build/pdf.mjs" {
  export { getDocument } from "pdfjs-dist";
}
