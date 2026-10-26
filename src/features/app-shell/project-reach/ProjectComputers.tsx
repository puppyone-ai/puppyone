import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { useLocalization } from "@puppyone/localization";
import { DesktopMenuItem } from "../../../components/DesktopMenu";
import { useDesktopPlatformCapabilities } from "../../../platform/useDesktopPlatformCapabilities";
import {
  resolveProjectComputerPresence,
  shouldCreateCloud,
  type DesktopProjectCloudCopy,
  type DesktopProjectLocation,
  type ProjectComputerStatus,
} from "../DesktopProjectLocationSwitcher";
import { ReachPlaceMark, useReachPlaceLabel } from "./reachPresentation";

type Computer = "local" | "cloud";

/**
 * Where the project runs, as the two computers it can run on.
 *
 * One project, two computers: this Mac and a Cloud Computer that is always on.
 * Each has its own copy of the files, and what is saved on one reaches the
 * other. Listing both, with the one the user is at marked, is what teaches
 * that model: the user sees two computers and which one they are at, and
 * moving to the other is a row they choose, the way they would walk to
 * another desk.
 *
 * It is deliberately not a toggle. A toggle reads as two views of one thing
 * that flip instantly; switching here opens the other computer's copy and can
 * take a moment while it wakes.
 *
 * The marked row is the computer whose screen is shown, the same one the
 * Header names, from the moment the user chooses it. While it opens its mark
 * is a spinner, and if it could not be opened a warning; the screen itself
 * owns retrying, so the row only states it, and going back is the other row.
 *
 * The rows are the project menu's own rows. The one sentence of explanation
 * appears only before the Cloud Computer has ever been used, under the row
 * that sets it up.
 */
export function ProjectComputers({
  projectLocation,
  cloudProject,
  onViewLocal,
  onViewCloud,
  onDismiss,
}: {
  projectLocation?: DesktopProjectLocation;
  cloudProject?: DesktopProjectCloudCopy;
  onViewLocal?: () => void;
  onViewCloud?: () => void;
  onDismiss: () => void;
}) {
  const { t } = useLocalization();
  const capabilities = useDesktopPlatformCapabilities();
  const device = capabilities?.platform === "macos" ? "mac" : "computer";
  const setUp = shouldCreateCloud(projectLocation, cloudProject, Boolean(onViewCloud));
  const navigateTo = (computer: Computer) => (computer === "local" ? onViewLocal : onViewCloud);
  // Cancelling an open in progress is choosing to stay on the current computer.
  const stay = navigateTo(projectLocation?.current ?? "local");
  return (
    <section className="desktop-project-computers" aria-label={t("shell.projectRuntime.panelLabel")}>
      {(["local", "cloud"] as const).map((computer) => (
        <ProjectComputerRow
          key={computer}
          computer={computer}
          device={device}
          row={resolveComputerRow(computer, projectLocation, computer === "cloud" && setUp,
            Boolean(navigateTo(computer)))}
          navigate={navigateTo(computer)}
          cancel={stay}
          onDismiss={onDismiss}
        />
      ))}
    </section>
  );
}

type ComputerRowState =
  /** The user is at this computer and it is ready. */
  | "current"
  /** The user is at this computer; it is still opening. */
  | "arriving"
  /** The user is at this computer; it could not be opened. */
  | "failed"
  /** Chosen, but the screen has not moved to it yet (sign-in or setup first). */
  | "opening"
  | "open-failed"
  | "set-up" | "sign-in" | "not-here" | "switch" | "unavailable";

/** What a row shows and does, by state. `detail` and `trailing` are copy keys under `shell.projectComputers`. */
const ROWS: Record<ComputerRowState, {
  here?: boolean;
  status?: ProjectComputerStatus;
  detail?: "opening" | "failed" | "cloudFirst" | "notHere";
  trailing?: "check" | "cancel" | "setUp" | "signIn" | "switch";
  action?: "navigate" | "cancel";
}> = {
  current: { here: true, trailing: "check" },
  arriving: { here: true, status: "opening", detail: "opening" },
  failed: { here: true, status: "failed", detail: "failed" },
  opening: { status: "opening", detail: "opening", trailing: "cancel", action: "cancel" },
  "open-failed": { status: "failed", detail: "failed", trailing: "cancel", action: "cancel" },
  "set-up": { detail: "cloudFirst", trailing: "setUp", action: "navigate" },
  "sign-in": { trailing: "signIn", action: "navigate" },
  "not-here": { detail: "notHere" },
  switch: { trailing: "switch", action: "navigate" },
  unavailable: {},
};

function ProjectComputerRow({ computer, device, row, navigate, cancel, onDismiss }: {
  computer: Computer;
  device: "mac" | "computer";
  row: ComputerRowState;
  /** Open the project on this computer. */
  navigate?: () => void;
  /** Stay on the current computer, abandoning an open in progress. */
  cancel?: () => void;
  onDismiss: () => void;
}) {
  const { t } = useLocalization();
  const place = computer === "local" ? "this-device" : "cloud";
  const label = useReachPlaceLabel(place);
  const { here = false, status = "ready", detail, trailing, action: actionKind } = ROWS[row];
  const action = actionKind && { cancel, navigate }[actionKind];

  let trailingContent: ReactNode;
  if (trailing === "check") trailingContent = <Check size={14} aria-hidden="true" />;
  else if (trailing && (trailing !== "cancel" || cancel)) trailingContent = t(`shell.projectComputers.${trailing}`);
  let detailText: string | undefined;
  if (detail === "cloudFirst" || detail === "notHere") detailText = t(`shell.projectComputers.${detail}.${device}`);
  else if (detail) detailText = t(`shell.projectComputers.${detail}`);

  return (
    <DesktopMenuItem
      className="desktop-project-computer"
      role="button"
      data-project-computer={computer}
      data-computer-state={row}
      aria-current={here ? "true" : undefined}
      aria-busy={status === "opening" || undefined}
      aria-disabled={action ? undefined : true}
      selected={here}
      icon={<ReachPlaceMark place={place} status={status} className="desktop-project-computer-mark" size={16} />}
      label={label}
      detail={detailText}
      trailing={trailingContent}
      onClick={action ? () => {
        onDismiss();
        action();
      } : undefined}
    />
  );
}

/** What one computer's row says, from the location the Header already holds. */
function resolveComputerRow(
  computer: Computer,
  location: DesktopProjectLocation | undefined,
  setUp: boolean,
  canNavigate: boolean,
): ComputerRowState {
  const presence = location ? resolveProjectComputerPresence(location) : { at: "local", status: "ready" } as const;
  if (computer === presence.at) return HERE[presence.status];
  // The user chose this computer but is still in front of the other one.
  if (computer === location?.requested) return location.failed ? "open-failed" : "opening";
  if (computer === "local" && location?.localAvailable === false) return "not-here";
  if (!canNavigate) return "unavailable";
  if (setUp) return "set-up";
  if (computer === "cloud" && location?.cloudState === "signed-out") return "sign-in";
  return "switch";
}

const HERE: Record<ProjectComputerStatus, ComputerRowState> = { ready: "current", opening: "arriving", failed: "failed" };
