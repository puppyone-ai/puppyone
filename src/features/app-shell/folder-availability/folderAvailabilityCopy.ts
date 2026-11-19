import { bidiIsolate } from "@puppyone/localization";
import type { FolderStatus } from "../../../types/electron";

type Translate = (id: string, values?: Record<string, string | number>) => string;

/** The folder's name as a person knows it: the last part of where it was. */
export function folderNameOf(folderPath: string) {
  return folderPath.split(/[\\/]/).filter(Boolean).pop() ?? folderPath;
}

/** Where it was, home-relative, so a person can recognise the place. */
export function folderPlaceOf(folderPath: string) {
  const parent = folderPath.replace(/[\\/][^\\/]*[\\/]?$/, "") || folderPath;
  return parent.replace(/^\/Users\/[^/]+|^\/home\/[^/]+|^[A-Za-z]:\\Users\\[^\\]+/, "~");
}

/**
 * What happened to a project's folder, said as a fact and without blame: where it was
 * and what could have happened, or that its disk is away, or that it may not be opened.
 */
export function folderStatusMessage(t: Translate, status: FolderStatus, name = folderNameOf(status.path)) {
  const values = { name: bidiIsolate(name), place: bidiIsolate(folderPlaceOf(status.path)) };
  if (status.suggestion) {
    return t("shell.folderStatus.renamed", { ...values, newName: bidiIsolate(status.suggestion.name) });
  }
  switch (status.state) {
    case "disconnected": return t("shell.folderStatus.disconnected", values);
    case "denied": return t("shell.folderStatus.denied", values);
    case "not-a-folder": return t("shell.folderStatus.notAFolder", values);
    default: return t("shell.folderStatus.missing", values);
  }
}

/** The few words under a project on the Homepage. */
export function folderStatusCaption(t: Translate, status: FolderStatus) {
  if (status.state === "disconnected") return t("shell.folderStatus.caption.disconnected");
  if (status.state === "denied") return t("shell.folderStatus.caption.denied");
  return t("shell.folderStatus.caption.missing");
}

/** Whether pointing at the folder's new place can help; a disk that is away comes back by itself. */
export function canLocate(status: FolderStatus) {
  return status.state === "missing" || status.state === "not-a-folder";
}
