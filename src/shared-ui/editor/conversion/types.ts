export type ConversionWarning = { code: string; pages?: number[] };
export type ConversionTable = { id: string; rows: string[][]; markdownRows?: string[][]; page?: number };
export type ConversionAsset = { name: string; mimeType: string; bytes: Uint8Array };
export type ConversionResult = {
  markdown: string;
  tables: ConversionTable[];
  assets: ConversionAsset[];
  warnings: ConversionWarning[];
  pageCount?: number;
  fingerprint: string;
};
export type ConversionSelection = { markdown: boolean; tableIds: string[] };
export type ConversionSaveRequest = {
  sourcePath: string;
  sourceName: string;
  result: ConversionResult;
  selection: ConversionSelection;
};
export type ConversionSaveResult = { folderPath: string; openPath: string; paths: string[] };
export type DocumentConversionPort = {
  save(request: ConversionSaveRequest): Promise<ConversionSaveResult>;
  open(path: string): void | Promise<void>;
};
export class DocumentConversionError extends Error {
  constructor(readonly code: string) { super(code); this.name = "DocumentConversionError"; }
}
export class DocumentConversionSaveError extends DocumentConversionError {
  constructor(readonly folderPath: string) { super("save-partial"); }
}
export const MAX_CONVERSION_SOURCE_BYTES = 25 * 1024 * 1024;
export const MAX_CONVERSION_TEXT_BYTES = 8 * 1024 * 1024;
export const MAX_CONVERSION_ASSET_BYTES = 20 * 1024 * 1024;
