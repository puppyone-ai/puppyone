import { FolderIcon } from "@puppyone/shared-ui";
import { useLocalization } from "@puppyone/localization";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

export type MutedLocalFoldersSectionProps = Readonly<{
  count: number;
  defaultExpanded?: boolean;
  children: ReactNode;
}>;

export function MutedLocalFoldersSection({
  count,
  defaultExpanded = true,
  children,
}: MutedLocalFoldersSectionProps) {
  const { t } = useLocalization();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const contentId = useId();

  if (count <= 0) return null;

  return (
    <section
      className="onboarding-project-group computer-mode-muted-folders"
      data-project-group="plain-folders"
      data-expanded={expanded || undefined}
    >
      <header className="onboarding-project-group-head computer-mode-muted-folders-head">
        <button
          type="button"
          className="computer-mode-muted-folders-toggle"
          aria-expanded={expanded}
          aria-controls={contentId}
          onClick={() => setExpanded((current) => !current)}
        >
          <span className="computer-mode-muted-folders-chevron" aria-hidden="true">
            {expanded ? <ChevronDown size={14} strokeWidth={1.8} /> : <ChevronRight size={14} strokeWidth={1.8} />}
          </span>
          <span className="onboarding-project-group-mark" aria-hidden="true">
            <FolderIcon size={15} strokeWidth={1.75} />
          </span>
          <span className="onboarding-project-group-title">
            {t("onboarding.computerMode.plainFolders.title")}
          </span>
          <span className="computer-mode-muted-folders-count">{count}</span>
          <span className="onboarding-project-group-detail">
            {t("onboarding.computerMode.plainFolders.hint")}
          </span>
        </button>
      </header>
      {expanded && (
        <div id={contentId} className="onboarding-project-group-content computer-mode-muted-folders-body">
          {children}
        </div>
      )}
    </section>
  );
}
