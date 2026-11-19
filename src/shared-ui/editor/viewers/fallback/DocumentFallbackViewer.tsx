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
  const fileType = binaryFileType(document);

  return (
    <div
      className="document-preview"
      role="status"
      aria-label={t("editor.preview.unavailableFor", { name: bidiIsolate(fileName) })}
    >
      <section className="document-preview__summary">
        <h2 className="document-preview__label" dir="auto">
          {label}{fileType && <span className="document-preview__type" dir="ltr">{` · ${fileType}`}</span>}
        </h2>
      </section>
    </div>
  );
}

function binaryFileType(document: EditorDocument): string | null {
  const name = (document.name || document.path).split(/[\\/]/).at(-1) ?? "";
  const dot = name.lastIndexOf(".");
  if (dot > 0 && dot < name.length - 1) return name.slice(dot + 1).toLocaleUpperCase();
  const subtype = document.mimeType?.split("/", 2)[1];
  return subtype && subtype !== "octet-stream" ? subtype.toLocaleUpperCase() : null;
}
