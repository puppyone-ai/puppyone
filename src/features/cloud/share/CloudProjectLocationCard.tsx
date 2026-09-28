import { AgentBrandImage } from "@puppyone/shared-ui";
import type { MessageFormatter } from "@puppyone/localization/core";
import { useLocalization } from "@puppyone/localization/react";
import { ChevronRight, Cloud, Laptop, LoaderCircle, TriangleAlert } from "lucide-react";
import type { ProjectLocationStatus } from "./projectLocationStatus";

const LOCATION_SHARE_BRANDS = ["chatgpt", "claude", "viktor"] as const;

/** Direct answer to where the files live, followed by the next useful action. */
export function CloudProjectLocationCard({
  status,
  onShare,
}: {
  status: ProjectLocationStatus;
  onShare: () => void;
}) {
  const { t } = useLocalization();
  const sharingDisabled = status.kind === "resolving";

  return (
    <div className="desktop-project-location" data-project-location={status.kind}>
      <div className="desktop-project-location-hero">
        <span
          className="desktop-project-location-hero-icon"
          data-location-state={status.kind}
          aria-hidden="true"
        >
          {status.kind === "resolving"
            ? <LoaderCircle className="animate-spin" size={18} strokeWidth={1.7} />
            : status.kind === "attention"
              ? <TriangleAlert size={18} strokeWidth={1.7} />
              : <Laptop size={19} strokeWidth={1.6} />}
          {status.kind === "local-cloud" && (
            <span className="desktop-project-location-cloud-badge">
              <Cloud size={9} strokeWidth={2.2} />
            </span>
          )}
        </span>
        <strong className="desktop-project-location-headline">
          {projectLocationHeadline(status, t)}
        </strong>
      </div>

      <button
        type="button"
        className="desktop-project-location-share"
        disabled={sharingDisabled}
        onClick={onShare}
      >
        <span className="desktop-project-location-share-label">
          {t("cloud.share.location.shareAction")}
        </span>
        <span className="desktop-project-location-share-brands" aria-hidden="true">
          {LOCATION_SHARE_BRANDS.map((brandId) => (
            <span className="desktop-project-location-share-brand" key={brandId}>
              <AgentBrandImage brandId={brandId} />
            </span>
          ))}
        </span>
        <ChevronRight className="po-directional-icon" size={17} strokeWidth={1.8} aria-hidden="true" />
      </button>
    </div>
  );
}

function projectLocationHeadline(status: ProjectLocationStatus, t: MessageFormatter): string {
  switch (status.kind) {
    case "local":
      return t("cloud.share.location.localHeadline");
    case "local-cloud":
      return t("cloud.share.location.localCloudHeadline");
    case "resolving":
      return t("cloud.share.location.resolvingHeadline");
    case "attention":
      return t("cloud.share.location.attentionHeadline");
  }
}

export function projectLocationBadge(status: ProjectLocationStatus, t: MessageFormatter): string {
  switch (status.kind) {
    case "local":
      return t("cloud.share.location.local");
    case "local-cloud":
      return t("cloud.share.location.localCloud");
    case "resolving":
      return t("cloud.share.location.resolving");
    case "attention":
      return t("cloud.share.location.attention");
  }
}
