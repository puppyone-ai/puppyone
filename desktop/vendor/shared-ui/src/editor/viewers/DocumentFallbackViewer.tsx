import type { EditorDocument } from "../viewerTypes";

export function DocumentPreview({
  document,
  title,
}: {
  document: EditorDocument;
  title: string;
}) {
  return (
    <div className="document-preview">
      <div className="document-page">
        <DocumentIcon />
        <span className="document-title">{title}</span>
        <span className="doc-line wide" />
        <span className="doc-line" />
        <span className="doc-line short" />
        <span className="sr-only">{document.name}</span>
      </div>
    </div>
  );
}

function DocumentIcon() {
  return (
    <svg width="82" height="82" viewBox="0 0 72 72" fill="none" aria-hidden>
      <path d="M18 10h26l10 10v42H18V10z" fill="var(--po-file-icon-body)" stroke="var(--po-file-icon-stroke)" />
      <path d="M44 10v12h10" fill="var(--po-file-icon-fold)" stroke="var(--po-file-icon-stroke)" />
      <path d="M26 34h20M26 42h20M26 50h13" stroke="var(--po-text-disabled)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
