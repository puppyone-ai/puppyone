import { type ReactNode, type RefObject } from "react";
import { useLocalization } from "@puppyone/localization";
import { UserPlus, Plug, HardDriveDownload } from "lucide-react";
import { DesktopMenuItem } from "../../../components/DesktopMenu";
import { DesktopTitlebarMenuLayer } from "../DesktopTitlebarMenuLayer";
import type { ReachState } from "./projectReachHeader";
import { useReachSummary } from "./reachPresentation";

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
      preferredWidth={236}
      preferredMaxHeight={420}
      widthMode="fixed"
      alignment="start"
      role="dialog"
      ariaLabel={t("shell.projectReach.panelLabel")}
    >
      <div className="desktop-project-reach-panel">
        <ReachCaption state={state} summary={summary} />
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
 * What the panel is here to say, as the caption of the rows it explains.
 *
 * Two wrong answers came before this one, and both were the same mistake.
 * First the statement was built out of a row's parts — icon slot, inline
 * padding, row radius, and a fill that happened to be the exact value of
 * `--po-hover`. The one thing in the panel that could not be pressed was
 * drawn as the one thing that had just been pressed. Then it became a framed
 * card with the machine drawn at the size of a machine, which fixed the
 * affordance and bought a new problem: weight. A 34px drawing beside 14px
 * text is the loudest thing in a menu whose entire content is one sentence
 * and two verbs.
 *
 * The deciding fact is that this menu's type size is a user preference —
 * `--po-type-left-sidebar-content`, 14px only by default. A drawing takes a
 * fixed 45px of width; the sentence takes as much as the user's own setting
 * says it takes. Those two cannot both fit on one line at every size, so the
 * card wrapped a 31-character sentence into two ragged lines with a laptop
 * floating beside them. No amount of tuning survives a setting.
 *
 * So: no drawing, no frame, no fill, and the full width of the panel for the
 * words. It is `.desktop-menu-section-label`, the caption this product
 * already uses for the line in a menu that is not a row — smaller than a row,
 * quieter than a row, with no icon in the rows' column. Three differences,
 * none of which a fill can undo, and it wraps gracefully at any type size
 * because wrapping is all it has to do.
 *
 * The place is not restated here. The control that opens this panel says
 * "This Mac" with the laptop mark on it, two centimetres above; drawing the
 * same machine again, larger, was the panel repeating its own trigger back at
 * the user in a louder voice.
 */
function ReachCaption({ state, summary }: { state: ReachState; summary: string }) {
  return (
    <p
      className="desktop-project-reach-caption"
      data-reach-place={state.place}
      data-reach-state={state.kind}
    >
      {summary}
    </p>
  );
}

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
