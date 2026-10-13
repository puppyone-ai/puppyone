import { useEffect, useRef, useState, type ReactNode } from "react";
import { Tooltip } from "@puppyone/shared-ui";
import { bidiIsolate, useLocalization } from "@puppyone/localization";
import { CloudOff, UserPlus, Plug, HardDriveDownload, Laptop } from "lucide-react";
import { CloudIcon } from "../../../components/icons/CloudIcon";
import { DesktopMenuItem, DesktopMenuSeparator } from "../../../components/DesktopMenu";
import { useDesktopPlatformCapabilities } from "../../../platform/useDesktopPlatformCapabilities";
import { DesktopTitlebarMenuLayer } from "../DesktopTitlebarMenuLayer";
import type { ReachMember, ReachPlace, ReachState } from "./projectReachHeader";
import "./reach-header.css";

/**
 * The Header's answer to "where is this project, and who can reach it".
 *
 * There is one control, and what it says out loud is the place: "This Mac",
 * or the Cloud workspace the project is worked on in. That is the fact a user
 * needs at a glance, and it is the fact the Header is uniquely able to give.
 * "Only you" is not a headline — knowing that nobody else is here tells a
 * user nothing they can act on, so it belongs one layer in, next to the two
 * verbs that change it.
 *
 * Reach joins the place only when there is reach to state: identity marks for
 * whoever can reach it, counted. People are round and machines are square, so
 * the composition of the answer is readable without a legend and without text
 * groups.
 *
 * It is also the only Cloud entry on the Header in this path. Inviting a
 * person, connecting an agent and getting a copy onto this device are all
 * actions inside it, which is why the right side of the Header no longer needs
 * a separate share button.
 *
 * Both halves are built from the Header's own geometry and the project menu's
 * own rows — the titlebar control tokens for the button, `DesktopMenuItem`
 * and friends for the panel. A control that states a fact about the project
 * has no reason to invent a second type scale or a second row style.
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
  const place = useReachPlaceLabel(state.place);
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
          aria-label={t("shell.projectReach.buttonLabel", { place, reach: summary })}
          onClick={() => { if (!open) onOpen?.(); setOpen((value) => !value); }}
        >
          <ReachPlaceMark place={state.place} className="desktop-titlebar-workspace-mark" size={16} />
          <span className="desktop-project-reach-place-label">{place}</span>
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
        preferredWidth={272}
        preferredMaxHeight={420}
        widthMode="fixed"
        alignment="start"
        role="dialog"
        ariaLabel={t("shell.projectReach.panelLabel")}
      >
        <div className="desktop-project-reach-panel">
          {/* The place is the panel's title, at the same size as the rows
              under it; reach is the line below it. One type scale, two
              facts, in the order a user asks for them. */}
          <div className="desktop-project-reach-head" data-reach-place={state.place}>
            <ReachPlaceMark place={state.place} className="desktop-project-reach-head-mark" size={16} />
            <div className="desktop-project-reach-head-body">
              <p className="desktop-project-reach-head-title">{place}</p>
              <p className="desktop-project-reach-head-reach" data-reach-state={state.kind}>{summary}</p>
            </div>
          </div>
          {state.kind === "not-on-this-device" ? <ReachDeviceDetail /> : readers}
          <DesktopMenuSeparator />
          {state.kind === "not-on-this-device"
            ? <ReachDeviceCopy onGetCopy={onGetCopy} />
            : <ReachActions onInvitePerson={onInvitePerson} onConnectAgent={onConnectAgent} />}
        </div>
      </DesktopTitlebarMenuLayer>
    </div>
  );
}

/**
 * Where the project is, as the first half of the statement. The mark is a
 * fact, not a switch: there is nothing to press and nothing to choose, which
 * is exactly why it can be shown all the time.
 */
function ReachPlaceMark({ place, className, size }: {
  place: ReachPlace;
  /** The host's own mark slot, so the Header and the menu size it alike. */
  className: string;
  size: number;
}) {
  return (
    <span
      className={`desktop-project-reach-place ${className}`}
      data-reach-place={place}
      aria-hidden="true"
    >
      {place === "cloud"
        ? <CloudIcon size={size} />
        : <Laptop size={size} strokeWidth={1.65} />}
    </span>
  );
}

/**
 * The place in words, in the vocabulary the Header already uses for it. These
 * are the established location strings on purpose: the reach path renames
 * nothing the user has already learned to read.
 */
function useReachPlaceLabel(place: ReachPlace): string {
  const { t } = useLocalization();
  const capabilities = useDesktopPlatformCapabilities();
  if (place === "cloud") return t("shell.workspaceSwitcher.location.cloud");
  return t(capabilities?.platform === "macos"
    ? "shell.workspaceSwitcher.location.thisMac"
    : "shell.workspaceSwitcher.location.thisComputer");
}

/**
 * Reach, after the place. Nobody else there means nothing to add: the place
 * is already a complete answer, and "only you" as a headline would spend the
 * Header's most valuable row on a non-event.
 */
function ReachMarks({ state }: { state: ReachState }) {
  const { t } = useLocalization();
  if (state.kind === "attention") {
    return (
      <span className="desktop-project-reach-marks" data-reach-audience="attention">
        <CloudOff size={16} strokeWidth={1.65} aria-hidden="true" />
      </span>
    );
  }
  if (state.kind === "only-you" || state.members.length === 0) return null;
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
