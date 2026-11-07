import { useId, useState, type ReactNode } from "react";
import type { ProjectHomeItem } from "../../lib/workspaceHomeModel";
import type { HomepageProjectLayout } from "../../preferenceStorage";
import type { ProjectListSharing } from "./OnboardingProjectList";

export type OnboardingProjectGroup = Readonly<{
  id: string;
  title: ReactNode;
  /** One quiet line after the title: presence, or what this computer offers. */
  detail?: ReactNode;
  /** The group's own named actions at the end of its head; the last one adds a project to it. */
  actions?: ReactNode;
  /** The group cannot be used right now, as when its computer is offline. */
  inactive?: boolean;
  alwaysShowHeading?: boolean;
  /** Empty destinations appear only during an explicit publication gesture. */
  empty?: boolean;
  keepEmpty?: boolean;
  /** Present only for a trusted in-page drag, never dataTransfer paths. */
  dropTarget?: { enabled: boolean; onDrop: () => void };
  children: ReactNode;
}>;

/** Audience composition shared by ordinary Homepage and the device-catalog owner. */
export type OnboardingGroupsBase = Readonly<{
  label: string;
  layout: HomepageProjectLayout;
  cloud: readonly OnboardingProjectGroup[];
  personalSharedTitle: string;
  /** In-page source only; the owner navigates and confirms before granting access. */
  localShare?: Readonly<{
    draggingPath: string | null;
    busy: boolean;
    request: (path: string) => Promise<void>;
    endDrag: () => void;
  }>;
  local: Readonly<{
    title: string;
    items: readonly ProjectHomeItem[];
    render: (items: ProjectHomeItem[], sharing?: ProjectListSharing) => ReactNode;
    /** How a project is started here. With it, the group stays even when it has none. */
    entry?: ReactNode;
    empty?: string;
  }> | null;
  /** False while the page is narrowed to some places; other computers are not one of them. */
  showOtherComputers: boolean;
}>;

/** Known sharing survives offline/paused state; storage location never changes its audience. */
export function onboardingBaseGroups(base: OnboardingGroupsBase, sharing?: ProjectListSharing): OnboardingProjectGroup[] {
  const isShared = (item: ProjectHomeItem) => Boolean(item.hostFolderId
    && (sharing ? sharing.sharedFolderIds.has(item.hostFolderId) : true));
  const offered = base.local?.items.filter(isShared) ?? [];
  const localOnly = base.local?.items.filter((item) => !isShared(item)) ?? [];
  const groups = [...base.cloud];
  if (offered.length && base.local) {
    const index = groups.findIndex((group) => group.id === "personal-shared");
    const previous = groups[index];
    const personal: OnboardingProjectGroup = {
      ...previous, id: "personal-shared", title: base.personalSharedTitle, alwaysShowHeading: true, empty: false,
      children: <>{previous && !previous.empty && previous.children}{base.local.render(offered, sharing)}</>,
    };
    if (index < 0) groups.unshift(personal);
    else groups[index] = personal;
  }
  if (base.local && (localOnly.length || base.local.entry)) {
    groups.push({ id: "local-only", title: base.local.title, alwaysShowHeading: true, actions: base.local.entry,
      children: localOnly.length ? base.local.render(localOnly, sharing)
        : <p className="onboarding-cloud-space-empty">{base.local.empty}</p> });
  }
  return groups.filter((group) => !group.empty || group.keepEmpty);
}

// Apply the same display order after every catalog has contributed its groups.
const audienceOrder = new Map([
  ["team-shared", 0], ["personal-shared", 1], ["shared-unresolved", 2], ["local-only", 3],
]);

/**
 * Shared projects are grouped by audience, not by storage location. One page
 * scrolls, and heterogeneous local/hosted/device lists flow through one grid.
 * Generic callers may still opt into an unheaded single list.
 */
export function OnboardingProjectGroups({ groups, label, note }: {
  groups: readonly OnboardingProjectGroup[];
  label: string;
  /** A line after the groups, such as why some of them could not be listed. */
  note?: ReactNode;
}) {
  if (groups.length === 0 && note === undefined) return null;
  const [only] = groups;
  const plain = groups.length === 1 && !only.alwaysShowHeading && only.detail === undefined && only.actions === undefined;
  if (plain && note === undefined) return <>{only.children}</>;
  const ordered = [...groups].sort((left, right) =>
    (audienceOrder.get(left.id) ?? 2) - (audienceOrder.get(right.id) ?? 2));
  return (
    <div className="onboarding-project-groups" data-po-scrollbar="menu" data-po-scrollbar-visibility="always"
      aria-label={label}>
      {ordered.map((group) => <ProjectGroup key={group.id} group={group} />)}
      {note}
    </div>
  );
}

function ProjectGroup({ group }: { group: OnboardingProjectGroup }) {
  const titleId = useId();
  const [over, setOver] = useState(false);
  return (
    <section className="onboarding-project-group" data-project-group={group.id}
      data-drop-available={group.dropTarget?.enabled || undefined}
      data-drop-over={(over && group.dropTarget?.enabled) || undefined}
      onDragOver={(event) => {
        if (!group.dropTarget) return;
        event.preventDefault(); event.stopPropagation();
        event.dataTransfer.dropEffect = group.dropTarget.enabled ? "copy" : "none";
        setOver(true);
      }}
      onDragLeave={(event) => {
        if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setOver(false);
      }}
      onDrop={(event) => {
        if (!group.dropTarget) return;
        event.preventDefault(); event.stopPropagation(); setOver(false);
        group.dropTarget.onDrop();
      }}
      data-inactive={group.inactive || undefined} aria-labelledby={titleId}>
      <header className="onboarding-project-group-head">
        <h2 id={titleId} className="onboarding-project-group-title"><bdi>{group.title}</bdi></h2>
        {group.detail !== undefined && <span className="onboarding-project-group-detail">{group.detail}</span>}
        <span className="onboarding-project-group-divider" aria-hidden="true" />
        {group.actions !== undefined && <span className="onboarding-project-group-actions">{group.actions}</span>}
      </header>
      <div className="onboarding-project-group-content">{group.children}</div>
    </section>
  );
}
