import { ChevronRight, Clock3, FolderOpen } from "lucide-react";
import { bidiIsolate } from "@puppyone/localization";
import { useLocalization } from "@puppyone/localization/react";
import type { ProjectCloudContext } from "../project/context/projectCloudContext";
import type { CloudWorkspaceSection } from "../routes/cloudRouteIds";
import { formatRelativeTime } from "../utils";
import type { CloudShareActions } from "./CloudShareContext";
import { CloudShareStatusCard } from "./CloudShareStatusCard";
import { resolveCloudShareStatus } from "./shareStatus";
import "./share.css";

/**
 * Act 1 of the Cloud Homepage: the same read-only status card as the Header
 * (which Agents can read this folder, and one button into the Share dialog).
 * Project identity and files are Act 2, one click away.
 */
export function CloudShareHome({
  projectName,
  projectSummary,
  latestUpdateAt,
  projectContext,
  share,
  onSelectSection,
}: {
  projectName: string;
  /** e.g. "12 files · 3.4 MB"; null while unknown. */
  projectSummary: string | null;
  latestUpdateAt: string | null;
  projectContext: ProjectCloudContext;
  share: CloudShareActions;
  onSelectSection: (section: CloudWorkspaceSection) => void;
}) {
  const localization = useLocalization();
  const { t } = localization;
  const title = t("cloud.share.readers.title", { project: bidiIsolate(projectName) });
  const status = resolveCloudShareStatus({
    context: projectContext,
    shares: share.shares.shares,
    sharesLoaded: share.shares.loaded || share.shares.error,
    signedIn: share.signedIn,
    pending: share.pending,
  });

  return (
    <section className="desktop-share-home" aria-label={title}>
      <h2 className="desktop-share-home-title" dir="auto">{title}</h2>

      <CloudShareStatusCard status={status} surface="page" onPrimary={() => share.openShare(null)} />

      <nav className="desktop-share-home-secondary" aria-label={t("cloud.share.home.projectDetails")}>
        <button type="button" className="desktop-share-home-secondary-cta" onClick={() => onSelectSection("project")}>
          <FolderOpen size={15} aria-hidden="true" />
          <span>
            <strong>{t("cloud.route.project.label")}</strong>
            <small>{projectSummary ?? t("cloud.share.home.openProject")}</small>
          </span>
          <ChevronRight size={14} aria-hidden="true" />
        </button>
        <button type="button" className="desktop-share-home-secondary-cta" onClick={() => onSelectSection("history")}>
          <Clock3 size={15} aria-hidden="true" />
          <span>
            <strong>{t("cloud.route.history.label")}</strong>
            <small>
              {latestUpdateAt
                ? `${t("cloud.overview.lastUpdated")} · ${formatRelativeTime(latestUpdateAt, localization)}`
                : t("cloud.overview.viewHistory")}
            </small>
          </span>
          <ChevronRight size={14} aria-hidden="true" />
        </button>
      </nav>
    </section>
  );
}
