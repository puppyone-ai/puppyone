import type { MessageFormatter } from "@puppyone/localization/core";
import { useLocalization } from "@puppyone/localization/react";
import { Cloud, Laptop, LoaderCircle, TriangleAlert } from "lucide-react";
import type { ProjectLocationStatus } from "./projectLocationStatus";

/** Direct, read-only answer to where the current project's files live. */
export function CloudProjectLocationCard({
  status,
}: {
  status: ProjectLocationStatus;
}) {
  const { t } = useLocalization();

  return (
    <div className="desktop-project-location" data-project-location={status.kind}>
      <div className="desktop-menu-item desktop-project-location-status" role="status">
        <ProjectLocationGlyph
          status={status}
          className="desktop-menu-item-icon desktop-project-location-status-icon"
        />
        <span className="desktop-menu-item-body">
          <span className="desktop-menu-item-label">{projectLocationBadge(status, t)}</span>
        </span>
      </div>
    </div>
  );
}

export function ProjectLocationGlyph({
  status,
  className = "desktop-menu-item-icon desktop-project-location-status-icon",
}: {
  status: ProjectLocationStatus;
  className?: string;
}) {
  return (
    <span className={className} data-location-state={status.kind} aria-hidden="true">
      {status.kind === "resolving"
        ? <LoaderCircle className="animate-spin" size={16} strokeWidth={1.7} />
        : status.kind === "attention"
          ? <TriangleAlert size={16} strokeWidth={1.7} />
          : status.kind === "local-cloud"
            ? <Cloud size={16} strokeWidth={1.7} />
            : <Laptop size={16} strokeWidth={1.7} />}
    </span>
  );
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
