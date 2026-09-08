import { useLocalization } from "@puppyone/localization";
import { ChevronDown, FileText, Folder, MessageSquare } from "lucide-react";

const previewProject = "PuppyOne";
const previewFiles = ["Notes.md", "Ideas.md"];

/** A static workspace sample using the same semantic type roles as the app. */
export function TypographyPreview({ markdownThemeId }: { markdownThemeId: string }) {
  const { t } = useLocalization();

  return (
    <section className="desktop-typography-preview" aria-label={t("settings.typography.preview.ariaLabel")}>
      <div className="desktop-typography-preview-workspace">
        <div className="desktop-typography-preview-header">
          <Folder size={15} aria-hidden="true" />
          <span>{previewProject}</span>
        </div>
        <aside className="desktop-typography-preview-sidebar desktop-typography-preview-left" aria-label={t("settings.typography.preview.leftSidebar")}>
          <div className="desktop-typography-preview-pane-title">{t("shell.navigation.files")}</div>
          <div className="desktop-typography-preview-file">
            <ChevronDown size={14} aria-hidden="true" />
            <Folder size={15} aria-hidden="true" />
            <span>{previewProject}</span>
          </div>
          {previewFiles.map((file, index) => (
            <div className={`desktop-typography-preview-file is-nested${index === 0 ? " is-selected" : ""}`} key={file}>
              <FileText size={15} aria-hidden="true" />
              <span>{file}</span>
            </div>
          ))}
        </aside>
        <section
          className="desktop-typography-preview-editor markdown-codemirror-editor"
          aria-label={t("settings.typography.preview.editor")}
          data-po-theme-surface="markdown"
          data-po-theme-id={markdownThemeId}
          data-po-typography-role="content"
        >
          <div className="cm-md-html-rendered-surface" role="document" lang="en">
            <h1>{t("settings.typography.preview.headingOne")}</h1>
            <h2>{t("settings.typography.preview.headingTwo")}</h2>
            <h3>{t("settings.typography.preview.headingThree")}</h3>
            <p className="desktop-typography-preview-body">
              {t("settings.typography.preview.body")}{" "}
              <strong>{t("settings.typography.preview.bold")}</strong>.
            </p>
          </div>
        </section>
        <aside className="desktop-typography-preview-sidebar desktop-typography-preview-right" aria-label={t("settings.typography.preview.rightSidebar")}>
          <div className="desktop-typography-preview-pane-title">
            <MessageSquare size={15} aria-hidden="true" />
            <span>{t("settings.typography.preview.chat")}</span>
          </div>
          <div className="desktop-typography-preview-message">
            <span className="desktop-typography-preview-meta">{t("agent.name")}</span>
            <p>{t("settings.typography.preview.message")}</p>
          </div>
        </aside>
      </div>
    </section>
  );
}
