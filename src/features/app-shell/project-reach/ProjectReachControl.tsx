import { useEffect, useRef, useState, type ReactNode } from "react";
import { Tooltip } from "@puppyone/shared-ui";
import { bidiIsolate, useLocalization } from "@puppyone/localization";
import { CloudOff, UserPlus, Plug, HardDriveDownload } from "lucide-react";
import { DesktopTitlebarMenuLayer } from "../DesktopTitlebarMenuLayer";
import type { ReachMember, ReachState } from "./projectReachHeader";
import "./reach-header.css";

/**
 * The Header's answer to "who can reach this project".
 *
 * There is one control, and it is a statement: identity marks for whoever can
 * reach the project, nothing at all when the answer is "only you". People are
 * round and machines are square, so the composition of the answer is readable
 * without a legend and without text groups.
 *
 * It is also the only Cloud entry on the Header in this path. Inviting a
 * person, connecting an agent and getting a copy onto this device are all
 * actions inside it, which is why the right side of the Header no longer needs
 * a separate share button.
 *
 * The rows themselves and stopping a reach come from the share domain through
 * `readers`, so the Header and the share screen can never state reach
 * differently.
 */
export type ProjectReachControlProps = Readonly<{
  state: ReachState;
  /** The share domain's readers list, including its own stop action. */
  readers?: ReactNode;
  onInvitePerson?: () => void;
  onConnectAgent?: () => void;
  /** Offered only while the project has no working copy on this device. */
  onGetCopy?: () => void;
  projectMenuOpen?: boolean;
  onOpen?: () => void;
}>;

export function ProjectReachControl({
  state,
  readers,
  onInvitePerson,
  onConnectAgent,
  onGetCopy,
  projectMenuOpen = false,
  onOpen,
}: ProjectReachControlProps) {
  const { t } = useLocalization();
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (projectMenuOpen) setOpen(false); }, [projectMenuOpen]);

  const summary = t(`shell.projectReach.summary.${state.kind}`, {
    count: state.members.length,
    name: bidiIsolate(summaryName(state)),
  });
  const freshness = useReachFreshness(state);
  return (
    <div className="desktop-titlebar-reach-wrap" data-reach-state={state.kind}>
      <Tooltip content={freshness}>
        <button
          ref={anchor}
          type="button"
          className="desktop-titlebar-reach-button"
          data-reach-state={state.kind}
          data-reach-emphasis={state.emphasis || undefined}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={summary}
          onClick={() => { if (!open) onOpen?.(); setOpen((value) => !value); }}
        >
          <ReachMarks state={state} />
        </button>
      </Tooltip>
      <DesktopTitlebarMenuLayer
        anchorRef={anchor}
        open={open}
        onDismiss={() => setOpen(false)}
        dismissOnFocusExit={false}
        className="desktop-project-reach-menu"
        gap={2}
        preferredWidth={320}
        preferredMaxHeight={420}
        widthMode="fixed"
        alignment="start"
        role="dialog"
        ariaLabel={t("shell.projectReach.panelLabel")}
      >
        <div className="desktop-project-reach-panel">
          <p className="desktop-project-reach-statement" data-reach-state={state.kind}>{summary}</p>
          {state.kind === "not-on-this-device" ? (
            <ReachDeviceCopy onGetCopy={onGetCopy} />
          ) : (
            <>
              {readers}
              <ReachActions onInvitePerson={onInvitePerson} onConnectAgent={onConnectAgent} />
            </>
          )}
        </div>
      </DesktopTitlebarMenuLayer>
    </div>
  );
}

/**
 * The marks are the statement. A project only this device reaches shows a
 * single quiet device mark; everything else shows who is there, counted.
 */
function ReachMarks({ state }: { state: ReachState }) {
  const { t } = useLocalization();
  if (state.kind === "attention") {
    return (
      <span className="desktop-project-reach-marks" data-reach-audience="attention">
        <CloudOff size={15} strokeWidth={1.75} aria-hidden="true" />
      </span>
    );
  }
  if (state.kind === "only-you" || state.members.length === 0) {
    return <span className="desktop-project-reach-marks" data-reach-audience="none" aria-hidden="true" />;
  }
  return (
    <span className="desktop-project-reach-marks">
      {state.members.slice(0, 3).map((member) => (
        <ReachMark key={member.id} member={member} />
      ))}
      {state.members.length > 1 && (
        <span className="desktop-project-reach-count">
          {t("shell.projectReach.count", { count: state.members.length })}
        </span>
      )}
    </span>
  );
}

function ReachMark({ member }: { member: ReachMember }) {
  return (
    <span
      className="desktop-project-reach-mark"
      data-reach-audience={member.audience}
      data-reach-activity={member.activity?.kind}
      aria-hidden="true"
    >
      {initial(member.name)}
    </span>
  );
}

/** The name the statement is about, when it is about one destination. */
function summaryName(state: ReachState): string {
  if (state.kind === "waiting") return state.waitingFor ?? "";
  if (state.kind === "working") {
    return state.members.find((member) => member.activity)?.name ?? "";
  }
  return state.freshest?.name ?? "";
}

/**
 * Hover states the consequence: which version the other side sees. Emphasis
 * never comes from here — a quiet sentence is the whole point.
 */
function useReachFreshness(state: ReachState): string {
  const localization = useLocalization();
  const { t } = localization;
  if (state.kind === "not-on-this-device") return t("shell.projectReach.freshness.notOnThisDevice");
  if (state.kind === "attention") return t("shell.projectReach.freshness.attention");
  const working = state.members.find((member) => member.activity);
  if (working?.activity) {
    return t(`shell.projectReach.freshness.${working.activity.kind}`, { name: bidiIsolate(working.name) });
  }
  if (state.kind === "waiting" && state.waitingFor) {
    return t("shell.projectReach.freshness.waiting", { name: bidiIsolate(state.waitingFor) });
  }
  if (state.freshest?.lastSeenAt) {
    return t("shell.projectReach.freshness.sees", {
      name: bidiIsolate(state.freshest.name),
      time: relativeRead(state.freshest.lastSeenAt, localization),
    });
  }
  return t("shell.projectReach.freshness.onlyYou");
}

function ReachActions({ onInvitePerson, onConnectAgent }: {
  onInvitePerson?: () => void;
  onConnectAgent?: () => void;
}) {
  const { t } = useLocalization();
  return (
    <div className="desktop-project-reach-actions">
      <button type="button" className="desktop-project-reach-action" onClick={onInvitePerson}
        disabled={!onInvitePerson}>
        <UserPlus size={15} strokeWidth={1.75} aria-hidden="true" />
        <span>{t("shell.projectReach.invitePerson")}</span>
      </button>
      <button type="button" className="desktop-project-reach-action" onClick={onConnectAgent}
        disabled={!onConnectAgent}>
        <Plug size={15} strokeWidth={1.75} aria-hidden="true" />
        <span>{t("shell.projectReach.connectAgent")}</span>
      </button>
    </div>
  );
}

/**
 * The third reach state: the project is reachable, it is simply not on this
 * device yet. Reading needs nothing; changing it needs a copy, and where that
 * copy lands is decided by the obstacle, not offered as a choice.
 */
function ReachDeviceCopy({ onGetCopy }: { onGetCopy?: () => void }) {
  const { t } = useLocalization();
  return (
    <div className="desktop-project-reach-device-copy">
      <p>{t("shell.projectReach.deviceCopy.detail")}</p>
      <button type="button" className="desktop-project-reach-action primary" onClick={onGetCopy}
        disabled={!onGetCopy}>
        <HardDriveDownload size={15} strokeWidth={1.75} aria-hidden="true" />
        <span>{t("shell.projectReach.deviceCopy.action")}</span>
      </button>
    </div>
  );
}

function initial(name: string): string {
  return [...name.trim()][0]?.toLocaleUpperCase() ?? "";
}

/**
 * How long ago the other side read, in the coarsest unit that is still true.
 * Freshness is a consequence, so "14 minutes ago" is the fact, not a timestamp.
 */
function relativeRead(iso: string, { formatRelativeTime }: ReturnType<typeof useLocalization>): string {
  const seenAt = Date.parse(iso);
  if (Number.isNaN(seenAt)) return "";
  const elapsed = seenAt - Date.now();
  const absolute = Math.abs(elapsed);
  if (absolute < 3_600_000) return formatRelativeTime(Math.round(elapsed / 60_000), "minute", { numeric: "auto" });
  if (absolute < 86_400_000) return formatRelativeTime(Math.round(elapsed / 3_600_000), "hour", { numeric: "auto" });
  return formatRelativeTime(Math.round(elapsed / 86_400_000), "day", { numeric: "auto" });
}
