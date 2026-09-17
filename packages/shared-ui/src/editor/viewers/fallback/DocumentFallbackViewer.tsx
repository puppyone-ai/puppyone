import type { EditorDocument } from "../../registry/viewerTypes";
import { bidiIsolate } from "@puppyone/localization/core";
import { useLocalization } from "@puppyone/localization/react";

export function DocumentPreview({
  document,
  title,
}: {
  document: EditorDocument;
  title: string;
}) {
  const { t } = useLocalization();
  const fallbackTitle = title.trim();
  const fileName = document.name || document.path || fallbackTitle || t("editor.file");
  const status = fallbackTitle && fallbackTitle !== fileName
    ? fallbackTitle
    : t("editor.preview.unavailable");

  return (
    <div
      className="document-preview"
      role="status"
      aria-label={t("editor.preview.unavailableFor", { name: bidiIsolate(fileName) })}
    >
      <section className="document-preview__summary">
        <h2 className="document-preview__name" dir="auto">{fileName}</h2>
        <p className="document-preview__status" dir="auto">{status}</p>
      </section>
    </div>
  );
}
