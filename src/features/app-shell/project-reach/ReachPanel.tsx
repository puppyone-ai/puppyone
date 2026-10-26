import { type ComponentProps, type ReactNode, type RefObject } from "react";
import { useLocalization } from "@puppyone/localization";
import { UserPlus, Plug } from "lucide-react";
import { DesktopMenuItem } from "../../../components/DesktopMenu";
import type { DesktopProjectLocationControls } from "../DesktopProjectLocationSwitcher";
import { DesktopTitlebarMenuLayer } from "../DesktopTitlebarMenuLayer";
import type { ReachState } from "./projectReachHeader";
import { ProjectComputers } from "./ProjectComputers";
import { ReachPlaceMark, useReachSummary } from "./reachPresentation";
import { LocalIcon } from "@puppyone/shared-ui";

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
      // With the computers on top the panel fits its rows, so a short label
      // does not leave a wide empty gutter; the CSS cap wraps any sentence.
      preferredWidth={opening ? 216 : 252}
      preferredMaxHeight={420}
      widthMode={opening ? "content" : "fixed"}
      alignment="start"
      role="dialog"
      ariaLabel={t(opening ? "shell.projectRuntime.panelLabel" : "shell.projectReach.panelLabel")}
    >
      <div className="desktop-project-reach-panel" data-reach-entry={opening ? "computers" : "reach"}>
        {opening
          ? <ProjectComputers {...opening} onDismiss={onDismiss} />
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
        icon={<LocalIcon size={15} strokeWidth={1.8} />}
        label={t("shell.projectReach.deviceCopy.action")}
        disabled={!onGetCopy}
        onClick={onGetCopy}
      />
    </div>
  );
}
