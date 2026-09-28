import {
  AgentBrandImage,
  RENDERER_ASSET_PATHS,
  resolveRendererPublicAssetUrl,
} from "@puppyone/shared-ui";
import type { MessageFormatter } from "@puppyone/localization/core";
import { useLocalization } from "@puppyone/localization/react";
import { ChevronRight, Cloud, Laptop, LoaderCircle, TriangleAlert, UsersRound } from "lucide-react";
import type { CSSProperties } from "react";
import { DesktopMenuItem, DesktopMenuSeparator } from "../../../components/DesktopMenu";
import type { ProjectLocationStatus } from "./projectLocationStatus";

type MaskImageStyle = CSSProperties & { WebkitMaskImage: string };

const MCP_MARK_URL = resolveRendererPublicAssetUrl(RENDERER_ASSET_PATHS.icons.integrations.mcp);

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
      <div className="desktop-menu-item desktop-project-location-status" role="status">
        <ProjectLocationGlyph
          status={status}
          className="desktop-menu-item-icon desktop-project-location-status-icon"
        />
        <span className="desktop-menu-item-body">
          <span className="desktop-menu-item-label">{projectLocationBadge(status, t)}</span>
        </span>
      </div>

      <DesktopMenuSeparator />

      <DesktopMenuItem
        className="desktop-project-location-share"
        disabled={sharingDisabled}
        label={t("cloud.share.location.shareAction")}
        onClick={onShare}
        trailing={(
          <span className="desktop-project-location-share-trailing" aria-hidden="true">
            <span className="desktop-project-location-share-brands">
              <span className="desktop-project-location-share-brand" data-share-mark="mcp">
                <span
                  className="desktop-project-location-mcp-mark"
                  style={{
                    maskImage: `url("${MCP_MARK_URL}")`,
                    WebkitMaskImage: `url("${MCP_MARK_URL}")`,
                  } satisfies MaskImageStyle}
                />
              </span>
              <span className="desktop-project-location-share-brand" data-share-mark="viktor">
                <AgentBrandImage brandId="viktor" />
              </span>
              <span className="desktop-project-location-share-brand" data-share-mark="person">
                <UsersRound size={15} strokeWidth={1.8} />
              </span>
            </span>
            <ChevronRight className="po-directional-icon" size={15} strokeWidth={1.8} />
          </span>
        )}
      />
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
