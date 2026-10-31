"use client";

import { bidiIsolate } from "@puppyone/localization/core";
import { useLocalization } from "@puppyone/localization/react";
import { ConflictMarkerBanner } from "../../ConflictMarkerBanner";

const technicalTextExtensions = [".env", ".log", ".json", ".yml", ".yaml", ".toml", ".ts", ".tsx", ".js", ".jsx", ".css", ".html", ".md"];

export type PlainTextEditorProps = {
  content: string;
  nodeName?: string;
  readOnly?: boolean;
  onChange?: (content: string) => void;
  textSelectionScope?: "csv";
};

export function PlainTextEditor({
  content,
  nodeName = "",
  readOnly = true,
  onChange,
  textSelectionScope,
}: PlainTextEditorProps) {
  const { locale, t } = useLocalization();
  const lowerName = nodeName.toLowerCase();
  const isTechnicalText = technicalTextExtensions.some((extension) => lowerName.endsWith(extension));

  return (
    <div
      className="plain-text-editor"
      data-po-selection-scope={textSelectionScope}
      data-po-scrollbar="content"
      data-po-typography-role="content"
      lang={locale}
    >
      <ConflictMarkerBanner content={content} onResolve={readOnly ? undefined : onChange} />
      <div className="plain-text-editor__rail">
        {readOnly ? (
          <pre
            className="plain-text-editor__surface"
            data-technical={isTechnicalText}
            dir={isTechnicalText ? "ltr" : "auto"}
            aria-label={nodeName
              ? t("editor.text.readNamed", { name: bidiIsolate(nodeName) })
              : t("editor.text.read")}
          >
            {content}
          </pre>
        ) : (
          <textarea
            className="plain-text-editor__surface plain-text-editor__input"
            data-technical={isTechnicalText}
            dir={isTechnicalText ? "ltr" : "auto"}
            value={content}
            onChange={(event) => onChange?.(event.currentTarget.value)}
            placeholder={t("editor.text.placeholder")}
            aria-label={nodeName
              ? t("editor.text.editNamed", { name: bidiIsolate(nodeName) })
              : t("editor.text.edit")}
            spellCheck={false}
          />
        )}
      </div>
    </div>
  );
}

export default PlainTextEditor;
