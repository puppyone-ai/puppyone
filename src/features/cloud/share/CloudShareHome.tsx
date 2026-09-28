import { bidiIsolate } from "@puppyone/localization";
import { useLocalization } from "@puppyone/localization/react";
import { AgentBrandImage, type AgentBrandId } from "@puppyone/shared-ui";
import { ArrowRight, MessageCircle, Share2, Sparkles, UserRound } from "lucide-react";
import { McpLogoIcon } from "../components/McpLogoIcon";
import type { ProjectCloudContext } from "../project/context/projectCloudContext";
import type { CloudShareActions } from "./CloudShareContext";
import { CloudShareStatusCard } from "./CloudShareStatusCard";
import { resolveCloudShareStatus } from "./shareStatus";
import {
  SHARE_TARGETS,
  shareTargetLabelKey,
  shareTargetPreviewKey,
  type ShareTarget,
  type ShareTargetId,
} from "./shareTargets";
import "./share.css";

const SHARE_TARGET_BRANDS: Partial<Record<ShareTargetId, AgentBrandId>> = {
  viktor: "viktor",
  claude: "claude",
  chatgpt: "chatgpt",
};

/**
 * The Cloud shell's Share destination. It answers the two questions in order:
 * who can read this project now, then who the user wants to share it with.
 */
export function CloudShareHome({
  projectName,
  projectContext,
  share,
}: {
  projectName: string;
  projectContext: ProjectCloudContext;
  share: CloudShareActions;
}) {
  const { t } = useLocalization();
  const title = t("cloud.share.location.shareAction");
  const status = resolveCloudShareStatus({
    context: projectContext,
    shares: share.shares.shares,
    sharesLoaded: share.shares.loaded || share.shares.error,
    signedIn: share.signedIn,
    pending: share.pending,
  });

  return (
    <section className="desktop-cloud-overview-page desktop-share-page" aria-label={title}>
      <main className="desktop-cloud-overview-canvas" data-po-scrollbar="content">
        <div className="desktop-cloud-overview-catalog desktop-share-page-catalog">
          <header className="desktop-share-page-header">
            <h1>{title}</h1>
            <p dir="auto">{t("cloud.share.readers.title", { project: bidiIsolate(projectName) })}</p>
          </header>

          <CloudShareStatusCard
            status={status}
            surface="page"
            onPrimary={status.kind === "shared" || status.kind === "waiting" || status.kind === "attention"
              ? () => share.openShare(null)
              : undefined}
          />

          <section className="desktop-share-page-targets" aria-labelledby="desktop-share-page-target-heading">
            <header className="desktop-share-page-section-header">
              <h2 id="desktop-share-page-target-heading">{t("cloud.share.target.question")}</h2>
            </header>
            <div className="desktop-share-page-target-grid">
              {SHARE_TARGETS.map((target) => (
                <button
                  key={target.id}
                  type="button"
                  className="desktop-share-page-target"
                  data-share-target={target.id}
                  onClick={() => share.openShare(target.id)}
                >
                  <ShareTargetMark target={target} />
                  <span className="desktop-share-page-target-copy">
                    <strong>{t(shareTargetLabelKey(target.id))}</strong>
                    <small>{t(shareTargetPreviewKey(target.id))}</small>
                  </span>
                  <ArrowRight size={14} aria-hidden="true" />
                </button>
              ))}
            </div>
          </section>
        </div>
      </main>
    </section>
  );
}

export function ShareTargetMark({ target }: { target: ShareTarget }) {
  const brand = SHARE_TARGET_BRANDS[target.id];
  const mark = brand
    ? <AgentBrandImage brandId={brand} />
    : target.id === "mcp"
      ? <McpLogoIcon size={16} />
      : target.id === "person"
        ? <UserRound size={16} />
        : target.id === "slack-bot"
          ? <MessageCircle size={16} />
          : target.id === "grok"
            ? <Sparkles size={16} />
            : <Share2 size={16} />;

  return (
    <span className="desktop-share-target-mark" data-channel={target.channel} aria-hidden="true">
      {mark}
    </span>
  );
}
