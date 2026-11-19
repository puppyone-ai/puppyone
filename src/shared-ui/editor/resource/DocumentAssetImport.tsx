import { createContext, useContext, type ReactNode } from "react";
import type { DataPort } from "../../core/types";

export type DocumentAssetImportPort = Readonly<{
  importImage: (documentPath: string, file: File) => Promise<{ path: string }>;
}>;
const Context = createContext<DocumentAssetImportPort | null>(null);
export function DocumentAssetImportBoundary({ port = null, children }: { port?: DocumentAssetImportPort | null; children: ReactNode }) {
  return <Context.Provider value={port}>{children}</Context.Provider>;
}
export function useDocumentAssetImport() { return useContext(Context); }

/** Host construction only: providers receive a document-scoped operation, never DataPort. */
export function createDocumentAssetImportPort(importFiles: NonNullable<DataPort["importFiles"]>): DocumentAssetImportPort {
  return { importImage: async (documentPath, file) => {
    if (!safeWorkspacePath(documentPath) || !file.size || file.size > 20 * 1024 * 1024) throw new Error("invalid-image");
    const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    const extension = imageExtension(bytes);
    if (!extension) throw new Error("invalid-image");
    const folder = documentPath.split("/").slice(0, -1).join("/");
    const name = `image-${crypto.randomUUID()}.${extension}`;
    // Preserve the native File handle. Reconstructing a File loses Electron's user-selected path grant.
    const imported = await importFiles([file], folder || null, { preferredName: name });
    const path = imported.paths[0];
    if (imported.paths.length !== 1 || !path || !safeWorkspacePath(path)
      || path !== (folder ? `${folder}/${name}` : name)) throw new Error("invalid-image-result");
    return { path };
  } };
}
function safeWorkspacePath(path: string): boolean {
  return !!path && !/^(?:\/|[a-z][a-z\d+.-]*:)/i.test(path) && !/[\\\u0000-\u001f]/.test(path)
    && path.split("/").every((part) => !!part && part !== "." && part !== "..");
}
function imageExtension(bytes: Uint8Array): string | null {
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => bytes[i] === byte)) return "png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "jpg";
  const text = String.fromCharCode(...bytes);
  if (/^GIF8[79]a/.test(text)) return "gif";
  if (text.startsWith("RIFF") && text.slice(8, 12) === "WEBP") return "webp";
  return null;
}
