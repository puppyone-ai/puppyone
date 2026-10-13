import { type ReactNode, type RefObject } from "react";
import { useLocalization } from "@puppyone/localization";
import { UserPlus, Plug, HardDriveDownload } from "lucide-react";
import { DesktopMenuItem } from "../../../components/DesktopMenu";
import { DesktopTitlebarMenuLayer } from "../DesktopTitlebarMenuLayer";
import type { ReachState } from "./projectReachHeader";
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
        {/* The statement, not a heading. Whatever opened this panel already
            said its own label two centimetres away, so repeating it in bold
            would be the panel shouting its trigger back at the user. What is
            left is the one thing the panel adds — who can reach it — on a
            quiet card that cannot be mistaken for a row you press. */}
        <div className="desktop-project-reach-head" data-reach-place={state.place}>
          <ReachPlaceMark place={state.place} className="desktop-project-reach-head-mark" size={15} />
          <p className="desktop-project-reach-head-reach" data-reach-state={state.kind}>{summary}</p>
        </div>
        {state.kind === "not-on-this-device" ? <ReachDeviceDetail /> : readers}
        {state.kind === "not-on-this-device"
          ? <ReachDeviceCopy onGetCopy={onGetCopy} />
          : <ReachActions onInvitePerson={onInvitePerson} onConnectAgent={onConnectAgent} />}
      </div>
    </DesktopTitlebarMenuLayer>
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
