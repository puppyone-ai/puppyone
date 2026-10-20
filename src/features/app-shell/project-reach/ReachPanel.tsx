import { type ComponentProps, type ReactNode, type RefObject } from "react";
import { useLocalization } from "@puppyone/localization";
import { UserPlus, Plug, HardDriveDownload } from "lucide-react";
import { DesktopMenuItem } from "../../../components/DesktopMenu";
import { DesktopProjectLocationControls } from "../DesktopProjectLocationSwitcher";
import { DesktopTitlebarMenuLayer } from "../DesktopTitlebarMenuLayer";
import type { ReachPlace, ReachState } from "./projectReachHeader";
import { ReachPlaceMark, useReachSummary } from "./reachPresentation";
import { useDesktopPlatformCapabilities } from "../../../platform/useDesktopPlatformCapabilities";

/**
 * What the Header offers about reach, wherever it is opened from.
 *
 * The place control on the left and the people on the right are two views of
 * one subject, so they open one panel. Keeping it in a single component is
 * what stops the two entries from drifting into two different answers.
 */
export type ReachPanelContext = Readonly<{
  state: ReachState;
  /** The location menu uses the existing navigation controller; people remain a sharing-only entry. */
  opening?: ComponentProps<typeof DesktopProjectLocationControls>;
  /** The share domain's readers list, including its own stop action. */
  readers?: ReactNode;
  onInvitePerson?: () => void;
  onConnectAgent?: () => void;
  /** Offered only while the project has no working copy on this device. */
  onGetCopy?: () => void;
}>;

export function ReachPanel({ anchor, open, onDismiss, context }: {
  anchor: RefObject<HTMLElement | null>;
  open: boolean;
  onDismiss: () => void;
  context: ReachPanelContext;
}) {
  const { t } = useLocalization();
  const { state, readers, opening, onInvitePerson, onConnectAgent, onGetCopy } = context;
  const summary = useReachSummary(state);
  return (
    <DesktopTitlebarMenuLayer
      anchorRef={anchor}
      open={open}
      onDismiss={onDismiss}
      dismissOnFocusExit={false}
      className="desktop-project-reach-menu"
      gap={2}
      preferredWidth={opening ? 320 : 252}
      preferredMaxHeight={420}
      widthMode="fixed"
      alignment="start"
      role="dialog"
      ariaLabel={t(opening ? "shell.projectRuntime.panelLabel" : "shell.projectReach.panelLabel")}
    >
      <div className="desktop-project-reach-panel">
        {opening
          ? <ProjectRuntimeSummary place={state.place} opening={opening} onDismiss={onDismiss} />
          : <ReachPlaceCard state={state} summary={summary} />}
        {state.kind === "not-on-this-device" ? null : readers}
        {state.kind === "not-on-this-device" && <ReachDeviceDetail />}
        {state.kind === "not-on-this-device"
          ? <ReachDeviceCopy onGetCopy={onGetCopy} />
          : <ReachActions onInvitePerson={onInvitePerson} onConnectAgent={onConnectAgent} />}
      </div>
    </DesktopTitlebarMenuLayer>
  );
}

/** Committed execution location comes first; access remains a separate fact. */
function ProjectRuntimeSummary({ place, opening, onDismiss }: {
  place: ReachPlace;
  opening: NonNullable<ReachPanelContext["opening"]>;
  onDismiss: () => void;
}) {
  const { t } = useLocalization();
  const capabilities = useDesktopPlatformCapabilities();
  const device = capabilities?.platform === "macos" ? "mac" : "computer";
  const title = place === "cloud" ? "hosted" : device;
  return <section className="desktop-project-runtime" aria-label={t("shell.projectRuntime.panelLabel")}>
    <ReachPlaceMark place={place} className="desktop-project-runtime-mark" size={20} />
    <div className="desktop-project-runtime-body">
      <p className="desktop-project-runtime-title">{t(`shell.projectRuntime.title.${title}`)}</p>
      <DesktopProjectLocationControls {...opening} presentation="destination"
        onViewLocal={opening.onViewLocal && (() => { onDismiss(); opening.onViewLocal?.(); })}
        onViewCloud={opening.onViewCloud && (() => { onDismiss(); opening.onViewCloud?.(); })} />
    </div>
  </section>;
}

/** Sharing-only entries retain the existing compact access summary. */
function ReachPlaceCard({ state, summary }: { state: ReachState; summary: string }) {
  return (
    <div
      className="desktop-project-reach-card"
      data-reach-place={state.place}
      data-reach-state={state.kind}
    >
      <ReachPlaceMark
        place={state.place}
        className="desktop-project-reach-card-mark"
        size={PLACE_DRAWING_SIZE}
        tone="solid"
      />
      <p className="desktop-project-reach-card-reach">{summary}</p>
    </div>
  );
}

const PLACE_DRAWING_SIZE = 18;

/**
 * The two verbs, as menu rows. They are the same row the project menu uses,
 * because they are the same kind of thing: one tap, one consequence.
 */
function ReachActions({ onInvitePerson, onConnectAgent }: {
  onInvitePerson?: () => void;
  onConnectAgent?: () => void;
}) {
  const { t } = useLocalization();
  return (
    <div className="desktop-project-reach-actions">
      <DesktopMenuItem
        className="desktop-project-reach-action"
        role="button"
        icon={<UserPlus size={15} strokeWidth={1.8} />}
        label={t("shell.projectReach.invitePerson")}
        disabled={!onInvitePerson}
        onClick={onInvitePerson}
      />
      <DesktopMenuItem
        className="desktop-project-reach-action"
        role="button"
        icon={<Plug size={15} strokeWidth={1.8} />}
        label={t("shell.projectReach.connectAgent")}
        disabled={!onConnectAgent}
        onClick={onConnectAgent}
      />
    </div>
  );
}

/**
 * The third reach state: the project is reachable, it is simply not on this
 * device yet. Reading needs nothing; changing it needs a copy, and where that
 * copy lands is decided by the obstacle, not offered as a choice.
 *
 * The sentence belongs to the action under it, not to the place above it. It
 * was briefly folded onto the card, on the theory that everything true about
 * reach should be stated in one place — and it made that one state's card a
 * five-line block with the drawing adrift in the middle of it, while every
 * other state's card was a single line. The card is the statement and it is
 * one shape; a consequence that only exists because of an obstacle belongs
 * beside the way out of it.
 */
function ReachDeviceDetail() {
  const { t } = useLocalization();
  return <p className="desktop-project-reach-detail">{t("shell.projectReach.deviceCopy.detail")}</p>;
}

function ReachDeviceCopy({ onGetCopy }: { onGetCopy?: () => void }) {
  const { t } = useLocalization();
  return (
    <div className="desktop-project-reach-actions">
      <DesktopMenuItem
        className="desktop-project-reach-action"
        role="button"
        icon={<HardDriveDownload size={15} strokeWidth={1.8} />}
        label={t("shell.projectReach.deviceCopy.action")}
        disabled={!onGetCopy}
        onClick={onGetCopy}
      />
    </div>
  );
}
