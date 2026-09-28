import { ChevronRight, Clock3, FolderOpen, Share2 } from "lucide-react";
import { useLocalization } from "@puppyone/localization/react";
import type { CloudWorkspaceSection } from "../routes/cloudRouteIds";
import { formatRelativeTime } from "../utils";
import {
  SHARE_TARGETS,
  shareTargetLabelKey,
  shareTargetPreviewKey,
  type ShareTargetId,
} from "./shareTargets";
import type { ProjectSharesState } from "./useProjectShares";
import "./share.css";

/**
 * Act 1 of the Cloud Homepage under the Share experiment: the only question
 * is "who should read this?". Every card is one destination and its payoff.
 * Project identity and data are demoted to Act 2 (the "Project" section).
 */
export function CloudShareHome({
  projectName,
  projectSummary,
  latestUpdateAt,
  shares,
  onShare,
  onSelectSection,
}: {
  projectName: string;
  /** e.g. "12 files · 3.4 MB"; null while unknown. */
  projectSummary: string | null;
  latestUpdateAt: string | null;
  shares: ProjectSharesState;
  onShare: (targetId: ShareTargetId) => void;
  onSelectSection: (section: CloudWorkspaceSection) => void;
}) {
  const localization = useLocalization();
  const { t } = localization;

  return (
    <section className="desktop-share-home" aria-label={t("cloud.share.home.caption")}>
      <header className="desktop-share-home-header">
        <span>{t("cloud.share.home.caption")}</span>
        <h2 dir="auto">{t("cloud.share.home.title", { project: projectName })}</h2>
        <p>{t("cloud.share.home.description")}</p>
      </header>

      <div className="desktop-share-home-grid" role="list">
        {SHARE_TARGETS.map((target) => (
          <button
            key={target.id}
            type="button"
            role="listitem"
            className="desktop-share-home-card"
            data-share-target={target.id}
            onClick={() => onShare(target.id)}
          >
            <span className="desktop-share-target-mark" data-channel={target.channel} aria-hidden="true">
              {target.brand ? target.brand.slice(0, 1) : <Share2 size={14} />}
            </span>
            <span className="desktop-share-home-card-copy">
              <strong>{t(shareTargetLabelKey(target.id))}</strong>
              <span>{t(shareTargetPreviewKey(target.id))}</span>
            </span>
            <ChevronRight className="desktop-share-home-card-chevron" size={15} aria-hidden="true" />
          </button>
        ))}
      </div>

      {shares.shares.length > 0 && (
        <section className="desktop-share-home-existing" aria-label={t("cloud.share.header.existing")}>
          <h3>{t("cloud.share.header.existing")}</h3>
          <ul>
            {shares.shares.map((share) => (
              <li className="desktop-share-home-row" key={share.id}>
                <span className="desktop-share-menu-row-dot" data-live={Boolean(share.lastSeenAt)} aria-hidden="true" />
                <span className="desktop-share-menu-row-copy">
                  <strong dir="auto">{share.name}</strong>
                  <small>
                    {share.path ? <bdi>{share.path}</bdi> : t("cloud.share.header.wholeProject")}
                    {" · "}
                    {t(share.readonly ? "cloud.share.scope.readOnly" : "cloud.share.scope.readWrite")}
                    {" · "}
                    {share.lastSeenAt
                      ? t("cloud.share.header.lastUsed", { time: formatRelativeTime(share.lastSeenAt, localization) })
                      : t("cloud.share.header.neverUsed")}
                  </small>
                </span>
              </li>
            ))}
          </ul>
          <p className="desktop-share-home-existing-hint">{t("cloud.share.header.sharedHint")}</p>
        </section>
      )}

      <nav className="desktop-share-home-secondary" aria-label={t("cloud.share.home.projectDetails")}>
        <button type="button" className="desktop-share-home-secondary-cta" onClick={() => onSelectSection("project")}>
          <FolderOpen size={15} aria-hidden="true" />
          <span>
            <strong dir="auto">{projectName}</strong>
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
