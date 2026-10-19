import { type ReactNode, type RefObject } from "react";
import { useLocalization } from "@puppyone/localization";
import { UserPlus, Plug, HardDriveDownload } from "lucide-react";
import { DesktopMenuItem } from "../../../components/DesktopMenu";
import { DesktopTitlebarMenuLayer } from "../DesktopTitlebarMenuLayer";
import type { ReachPlace, ReachState } from "./projectReachHeader";
import { ReachPlaceMark, useReachSummary } from "./reachPresentation";

/**
 * What the Header offers about reach, wherever it is opened from.
 *
 * The place control on the left and the people on the right are two views of
 * one subject, so they open one panel. Keeping it in a single component is
 * what stops the two entries from drifting into two different answers.
 */
export type ReachPanelContext = Readonly<{
  state: ReachState;
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
  const { state, readers, onInvitePerson, onConnectAgent, onGetCopy } = context;
  const summary = useReachSummary(state);
  return (
    <DesktopTitlebarMenuLayer
      anchorRef={anchor}
      open={open}
      onDismiss={onDismiss}
      dismissOnFocusExit={false}
      className="desktop-project-reach-menu"
      gap={2}
      preferredWidth={272}
      preferredMaxHeight={420}
      widthMode="fixed"
      alignment="start"
      role="dialog"
      ariaLabel={t("shell.projectReach.panelLabel")}
    >
      <div className="desktop-project-reach-panel">
        <ReachPlaceCard state={state} summary={summary} />
        {state.kind === "not-on-this-device" ? null : readers}
        {state.kind === "not-on-this-device"
          ? <ReachDeviceCopy onGetCopy={onGetCopy} />
          : <ReachActions onInvitePerson={onInvitePerson} onConnectAgent={onConnectAgent} />}
      </div>
    </DesktopTitlebarMenuLayer>
  );
}

/**
 * Where this project is, drawn at the size of the thing it is on, with what
 * that means for reach underneath it.
 *
 * This was built out of a menu row's own parts: the place mark in the rows'
 * icon slot, the sentence beside it, a filled rounded rectangle under both.
 * That is the exact shape of a row with the cursor on it, so the one element
 * in the panel that does nothing wore the costume of the one element that had
 * just been pressed — and it was the only thing here in full `--po-text`
 * while the two real offers below it stayed muted. The hierarchy was upside
 * down and the affordance was a lie.
 *
 * A quieter fill would not have fixed it, because the fill was never the
 * problem: a row's geometry reads as a row at any opacity. So this is a
 * different kind of object. The machine is drawn at the size of a machine,
 * centred over the sentence it explains, in a recess rather than on a raised
 * plate. Nobody clicks a picture of their own laptop.
 *
 * It is the Share screen's journey stop at menu scale, deliberately: the same
 * drawing for the same fact, so a user who has watched a project leave this
 * Mac recognizes the place here without being taught it twice. The drawing is
 * also what lets the card stay silent about the place in words. Opened from
 * the place control, the trigger said "This Mac" two centimetres away and
 * repeating it would be the panel shouting its own trigger back; opened from
 * the people on the right, the place was never said at all. A picture of the
 * machine is the one statement that is neither a repetition nor a gap.
 */
function ReachPlaceCard({ state, summary }: { state: ReachState; summary: string }) {
  const { t } = useLocalization();
  return (
    <div
      className="desktop-project-reach-card"
      data-reach-place={state.place}
      data-reach-state={state.kind}
    >
      <ReachPlaceMark
        place={state.place}
        className="desktop-project-reach-card-mark"
        size={PLACE_DRAWING_SIZE[state.place]}
        strokeWidth={1.25}
      />
      <p className="desktop-project-reach-card-reach" data-reach-state={state.kind}>{summary}</p>
      {/* The consequence of the place, kept on the card with the fact it
          follows from. Everything true about reach is stated here; everything
          the user can do about it is in the rows below. */}
      {state.kind === "not-on-this-device" && (
        <p className="desktop-project-reach-card-detail">{t("shell.projectReach.deviceCopy.detail")}</p>
      )}
    </div>
  );
}

/**
 * Drawn, not iconified — and the two drawings need different numbers to weigh
 * the same. The laptop is an outline whose presence is its footprint; the
 * Cloud is a solid shape, so it is given less room rather than letting it
 * blot. The Share screen's journey sizes the same pair by the same reasoning.
 */
const PLACE_DRAWING_SIZE: Record<ReachPlace, number> = { "this-device": 34, cloud: 32 };

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
 * copy lands is decided by the obstacle, not offered as a choice. The fact
 * itself is stated on the card above; this is only the thing to do about it.
 */
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
