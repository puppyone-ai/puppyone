import { FileText, Folder } from "lucide-react";
import { useLocalization } from "@puppyone/localization/react";

export type SharePreviewEntry = { name: string; type: string };

/** A layout illustration uses cached names only; document contents stay on the recipient page. */
export function CloudWorkspaceSharePreview({ title, entries }: {
  title: string;
  entries?: readonly SharePreviewEntry[];
}) {
  const { t } = useLocalization();
  const visible = entries?.filter(entry => ![".DS_Store", "Thumbs.db", ".git"].includes(entry.name)).slice(0, 5);
  const first = visible?.find(entry => entry.type !== "folder");
  return <section className="desktop-cloud-share-preview">
    <div className="desktop-cloud-share-preview-window" aria-hidden="true">
      <div className="desktop-cloud-share-preview-brand"><strong>{t("shell.brand.name")}</strong></div>
      <div className="desktop-cloud-share-preview-layout">
        <div className="desktop-cloud-share-preview-files">
          <div className="desktop-cloud-share-preview-folder"><Folder size={12} /><strong>{title}</strong></div>
          {visible?.length ? visible.map((entry, index) => <div className={`desktop-cloud-share-preview-row${entry === first ? " selected" : ""}`} key={`${index}:${entry.name}`}>
            {entry.type === "folder" ? <Folder size={11} /> : <FileText size={11} />}<span>{entry.name}</span>
          </div>) : [0, 1, 2].map(index => <div className="desktop-cloud-share-preview-row" key={index}><FileText size={11} /><i /></div>)}
        </div>
        <div className="desktop-cloud-share-preview-document">
          <div className="desktop-cloud-share-preview-document-title"><FileText size={12} /><span>{first?.name || title}</span></div>
          <div className="desktop-cloud-share-preview-paper"><strong>{first?.name.replace(/\.[^.]+$/, "") || title}</strong>
            {[0, 1, 2, 3, 4].map(index => <i key={index} />)}
          </div>
        </div>
      </div>
    </div>
  </section>;
}
