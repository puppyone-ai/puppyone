import { Tooltip } from "@puppyone/shared-ui";
import { useLocalization } from "@puppyone/localization/react";
import { Cloud, ExternalLink, Share2 } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { DesktopMenuItem, DesktopMenuSection, DesktopMenuSeparator } from "../../../components/DesktopMenu";
import { DesktopTitlebarMenuLayer } from "../../app-shell/DesktopTitlebarMenuLayer";
import type { ProjectCloudContext } from "../project/context/projectCloudContext";
import { formatRelativeTime } from "../utils";
import { SHARE_TARGETS, shareTargetLabelKey, shareTargetPreviewKey, type ShareTargetId } from "./shareTargets";
import type { ProjectSharesState } from "./useProjectShares";
import "./share.css";

export type CloudShareHeaderState = "local" | "signed-out" | "resolving" | "published" | "shared" | "attention";

export function resolveCloudShareHeaderState(
  context: ProjectCloudContext,
  shareCount: number,
  signedIn = true,
): CloudShareHeaderState {
  if (context.status === "local-only") return "local";
  if (!signedIn) return "signed-out";
  if (context.status === "resolving") return "resolving";
  if (context.status === "resolved") return shareCount > 0 ? "shared" : "published";
  return "attention";
}

/**
 * The Header cloud icon doubles as the project's Local/Cloud indicator and
 * the only entry into sharing. Its menu answers two questions in order:
 * "who can read this today?" and "who should be able to next?".
 */
export function CloudShareHeaderControl({
  projectContext,
  shares,
  signedIn = true,
  onShare,
  onOpenCloud,
}: {
  projectContext: ProjectCloudContext;
  shares: ProjectSharesState;
  signedIn?: boolean;
  onShare: (targetId: ShareTargetId | null) => void;
  onOpenCloud: () => void;
}) {
  const localization = useLocalization();
  const { t } = localization;
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const state = resolveCloudShareHeaderState(projectContext, shares.shares.length, signedIn);
  const statusLabel = state === "local"
    ? t("cloud.share.header.local")
    : state === "signed-out"
      ? t("cloud.share.header.signedOut")
    : state === "resolving"
      ? t("cloud.share.header.resolving")
      : state === "published"
        ? t("cloud.share.header.publishedNoShares")
        : state === "shared"
          ? t("cloud.share.header.shared", { count: shares.shares.length })
          : t("cloud.share.header.attention");
  const statusHint = state === "local"
    ? t("cloud.share.header.localHint")
    : state === "signed-out"
      ? t("cloud.share.header.signedOutHint")
    : state === "shared"
      ? t("cloud.share.header.sharedHint")
      : state === "published"
        ? t("cloud.share.header.publishedHint")
        : null;

  return (
    <div className="desktop-titlebar-share-wrap" ref={wrapRef}>
      <Tooltip content={`${t("cloud.productName")} · ${statusLabel}`}>
        <button
          type="button"
          className="desktop-titlebar-action desktop-titlebar-cloud desktop-titlebar-share"
          aria-label={`${t("cloud.productName")} · ${statusLabel}`}
          aria-haspopup="menu"
          aria-expanded={open}
          data-share-state={state}
          onClick={() => setOpen((value) => !value)}
        >
          <Cloud size={16} strokeWidth={1.8} aria-hidden="true" />
          <span className="desktop-titlebar-share-badge" aria-hidden="true" />
        </button>
      </Tooltip>

      <DesktopTitlebarMenuLayer
        anchorRef={wrapRef}
        className="desktop-share-menu"
        onDismiss={close}
        open={open}
        preferredMaxHeight={560}
      >
        <div className="desktop-share-menu-status" data-share-state={state} role="status">
          <span className="desktop-share-menu-status-dot" aria-hidden="true" />
          <span className="desktop-share-menu-status-copy">
            <strong>{statusLabel}</strong>
            {statusHint && <small>{statusHint}</small>}
          </span>
        </div>

        {shares.shares.length > 0 && (
          <>
            <DesktopMenuSeparator />
            <DesktopMenuSection label={t("cloud.share.header.existing")}>
              {shares.shares.map((share) => (
                <div className="desktop-share-menu-row" key={share.id}>
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
                </div>
              ))}
            </DesktopMenuSection>
          </>
        )}

        <DesktopMenuSeparator />
        <DesktopMenuSection label={t("cloud.share.header.menuTitle")}>
          {SHARE_TARGETS.map((target) => (
            <DesktopMenuItem
              key={target.id}
              className="desktop-share-menu-target"
              data-share-target={target.id}
              icon={(
                <span className="desktop-share-target-mark is-compact" data-channel={target.channel}>
                  {target.brand ? target.brand.slice(0, 1) : <Share2 size={11} />}
                </span>
              )}
              label={t(shareTargetLabelKey(target.id))}
              tooltip={t(shareTargetPreviewKey(target.id))}
              onClick={() => {
                close();
                onShare(target.id);
              }}
            />
          ))}
        </DesktopMenuSection>

        <DesktopMenuSeparator />
        <DesktopMenuItem
          className="desktop-share-menu-manage"
          icon={<ExternalLink size={14} />}
          label={t("cloud.share.header.manage")}
          aria-haspopup="dialog"
          onClick={() => {
            close();
            onOpenCloud();
          }}
        />
      </DesktopTitlebarMenuLayer>
    </div>
  );
}
