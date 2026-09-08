import { bidiIsolate, type MessageFormatter } from "@puppyone/localization/core";
import type { DocumentSessionError } from "./types";

/** Convert stable session failures to localized presentation text at the UI boundary. */
export function formatDocumentSessionError(
  error: DocumentSessionError | null,
  t: MessageFormatter,
): string | null {
  if (!error) return null;
  return error.detail
    ? t("editor.session.saveFailedDetail", { detail: bidiIsolate(error.detail) })
    : t("editor.session.saveFailed");
}
