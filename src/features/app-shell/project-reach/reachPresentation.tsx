import { bidiIsolate, useLocalization } from "@puppyone/localization";
import {
  AgentBrandImage,
  AgentMonochromeBrandImage,
  CloudIcon,
  isMonochromeAgentBrandId,
  LocalIcon,
  resolveAgentBrand,
} from "@puppyone/shared-ui";
import { ProjectComputerStatusGlyph, type ProjectComputerStatus } from "../../../components/DesktopProjectLocationSwitcher";
import { useDesktopPlatformCapabilities } from "../../../platform";
import type { ReachMember, ReachPlace, ReachState } from "./projectReachHeader";

/**
 * The marks and sentences the reach path renders, in one place because the
 * Header states the same facts twice over: where the project is, on the left,
 * and who can reach it, on the right. Two renderings of one fact is how two
 * answers start disagreeing.
 */

/** The committed runtime location, using a device or hosted-server mark. */
export function ReachPlaceMark({ place, className, size, tone = "outline", strokeWidth = 1.65, status = "ready" }: {
  place: ReachPlace;
  /** A computer that is still opening, or could not be opened, shows that in place of its drawing. */
  status?: ProjectComputerStatus;
  /** The host's own mark slot, so the Header and the menu size it alike. */
  className: string;
  size: number;
  /**
   * `solid` for the machine as matter; `outline` for the machine as a label.
   * The tone weights the slot only: this computer is always the hollow laptop.
   */
  tone?: "outline" | "solid";
  strokeWidth?: number;
}) {
  return (
    <span
      className={`desktop-project-reach-place ${className}`}
      data-reach-place={place}
      data-reach-tone={tone}
      data-computer-status={status === "ready" ? undefined : status}
      aria-hidden="true"
    >
      {status === "ready"
        ? <PlaceDrawing place={place} size={size} strokeWidth={strokeWidth} />
        : <ProjectComputerStatusGlyph status={status} size={size} strokeWidth={strokeWidth} />}
    </span>
  );
}

/**
 * Each place is drawn with its product icon, the same mark the project rail,
 * the location switcher and the first-push introduction use, so the place
 * reads as one thing wherever it appears.
 */
function PlaceDrawing({ place, size, strokeWidth }: {
  place: ReachPlace;
  size: number;
  strokeWidth: number;
}) {
  if (place === "cloud") return <CloudIcon size={size} strokeWidth={strokeWidth} />;
  return <LocalIcon size={size} strokeWidth={strokeWidth} />;
}

/**
 * Who can reach the project, as a mark.
 *
 * An agent is its brand: a user recognizes Claude's mark long before they
 * read the word, and the product already owns these assets. A person is a
 * round initial, because the product knows a name and nothing more — faking
 * an avatar would claim an identity it has not been given.
 *
 * Lit means working in the project right now; everything else is quiet. That
 * is the only live state these marks carry, and it comes from the reading /
 * writing facts rather than from a residency claim.
 */
export function ReachMemberMark({ member, size = 18 }: { member: ReachMember; size?: number }) {
  const brand = member.audience === "machine" ? resolveAgentBrand({ label: member.name }) : null;
  return (
    <span
      className="desktop-project-reach-mark"
      data-reach-audience={member.audience}
      data-reach-activity={member.activity?.kind}
      data-reach-brand={brand?.id}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {brand ? <ReachBrandMark brandId={brand.id} /> : initial(member.name)}
    </span>
  );
}

/**
 * The place in words, in the vocabulary the Header already uses for it. These
 * are the established location strings on purpose: the reach path renames
 * nothing the user has already learned to read.
 */
export function useReachPlaceLabel(place: ReachPlace): string {
  const { t } = useLocalization();
  const capabilities = useDesktopPlatformCapabilities();
  if (place === "cloud") return t("shell.projectRuntime.label");
  return t(capabilities?.platform === "macos"
    ? "shell.workspaceSwitcher.location.thisMac"
    : "shell.workspaceSwitcher.location.thisComputer");
}

/** What the Header is stating about reach, as one sentence. */
export function useReachSummary(state: ReachState): string {
  const { t } = useLocalization();
  return t(`shell.projectReach.summary.${state.kind}`, {
    count: state.members.length,
    name: bidiIsolate(summaryName(state)),
  });
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
export function useReachFreshness(state: ReachState): string {
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
 * Some brand artwork exists only in white, so it is legible only on a dark
 * plate; those marks are drawn monochrome and take the surface's own colour.
 * The Share screen follows the same rule, from the same catalogue.
 */
function ReachBrandMark({ brandId }: { brandId: Parameters<typeof AgentBrandImage>[0]["brandId"] }) {
  if (isMonochromeAgentBrandId(brandId)) return <AgentMonochromeBrandImage brandId={brandId} />;
  return <AgentBrandImage brandId={brandId} />;
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
