import type { EditorDocument } from "../../registry/viewerTypes";
import { bidiIsolate } from "@puppyone/localization/core";
import { useLocalization } from "@puppyone/localization/react";

export function DocumentPreview({
  document,
  label,
}: {
  document: EditorDocument;
  label: string;
}) {
  const { t } = useLocalization();
  const fileName = document.name || document.path || label || t("editor.file");

  return (
    <div
      className="document-preview"
      role="status"
      aria-label={t("editor.preview.unavailableFor", { name: bidiIsolate(fileName) })}
    >
      <div className="document-preview__signal" aria-hidden="true" />
      <section className="document-preview__summary">
        <span className="document-preview__rule" aria-hidden="true" />
        <h2 className="document-preview__label" dir="auto">{label}</h2>
        <span className="document-preview__rule" aria-hidden="true" />
      </section>
    </div>
  );
}
