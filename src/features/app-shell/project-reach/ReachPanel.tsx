import { type ComponentProps, type ReactNode, type RefObject } from "react";
import { useLocalization } from "@puppyone/localization";
import { UserPlus, Plug, HardDriveDownload } from "lucide-react";
import { DesktopMenuItem, DesktopMenuSection, DesktopMenuSeparator } from "../../../components/DesktopMenu";
import { DesktopProjectLocationControls } from "../DesktopProjectLocationSwitcher";
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
      preferredWidth={252}
      preferredMaxHeight={520}
      widthMode="fixed"
      alignment="start"
      role="dialog"
      ariaLabel={t(opening ? "shell.projectOpen.title" : "shell.projectReach.panelLabel")}
    >
      <div className="desktop-project-reach-panel">
        {opening && <>
          <DesktopMenuSection label={t("shell.projectOpen.title")}>
            <DesktopProjectLocationControls {...opening} presentation="popover"
              onViewLocal={opening.onViewLocal && (() => { onDismiss(); opening.onViewLocal?.(); })}
              onViewCloud={opening.onViewCloud && (() => { onDismiss(); opening.onViewCloud?.(); })} />
          </DesktopMenuSection>
          <DesktopMenuSeparator />
        </>}
        <ReachPlaceCard state={state} summary={summary} />
        {state.kind === "not-on-this-device" ? null : readers}
        {state.kind === "not-on-this-device" && <ReachDeviceDetail />}
        {state.kind === "not-on-this-device"
          ? <ReachDeviceCopy onGetCopy={onGetCopy} />
          : <ReachActions onInvitePerson={onInvitePerson} onConnectAgent={onConnectAgent} />}
      </div>
    </DesktopTitlebarMenuLayer>
  );
}

/**
 * The machine this project is sitting on, and what that means for reach.
 *
 * The drawing is the point of this card. It is not a label for the place —
 * the Header control already says "This Mac" in words — it is the thing the
 * project is currently spending: your own computer, your own disk, your own
 * copy. A sentence cannot say "this is running on your hardware" without
 * sounding like a warning; a small picture of the hardware says it and then
 * gets out of the way.
 *
 * Three wrong versions got here. It was a menu row with a fill that happened
 * to equal `--po-hover`, which made the one thing that cannot be pressed look
 * like the one thing that had been. Then it was a 34px machine on a 90px
 * card, which fixed the affordance and became an announcement. Then it was
 * no card at all, which is not a correction, it is a deletion: the resource
 * went unstated.
 *
 * What was actually wrong with the big version is measurable, and it is the
 * reason this one is sized the way it is. `--po-menu-item-font-size` here
 * resolves to `--po-type-left-sidebar-content`, a user preference that is
 * 14px only by default. A drawing costs a fixed width; a sentence costs
 * whatever the user's setting says. Put a 34px drawing next to 14px body
 * text and a 31-character statement has nowhere to go but a second ragged
 * line.
 *
 * So the card is a band, not a poster: an 18px machine — bigger than the rows'
 * 15px icons, so it is never mistaken for one more verb in their column, and
 * small enough to leave the sentence a whole line — beside the statement at
 * the meta size. The meta size is the load-bearing choice: it is a separate
 * preference from the content size, so scaling the menu's text up does not
 * reflow this card. The recess and the hairline do the rest; nothing else in
 * a menu is framed.
 *
 * And it is the filled weight of the machine, not the outline. Two inches
 * above this card the same machine is already on screen as an outline, in
 * the control that opened the panel — so an outline here was a dimmer second
 * copy of a label the user had just read. Filled, it stops being a label: it
 * is the hardware, with the ink of a thing that takes up room. That is the
 * whole claim of this card, and the Cloud has been making it in the same
 * weight, in this same slot, from the beginning.
 */
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

/**
 * One size for both places, which only became possible when the machine
 * stopped being an outline. A solid shape fills its own box, so it needs
 * less room than a hollow one to carry the same weight and it starts its ink
 * at the same edge: the pair used to need a size each and a bearing
 * correction in CSS to land on the panel's one column, and now it needs
 * neither. The Share screen's journey sizes the same pair the same way.
 */
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
