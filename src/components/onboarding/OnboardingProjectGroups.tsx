import { useId, useState, type ReactNode } from "react";
import { LocalIcon } from "@puppyone/shared-ui";
import type { ProjectHomeItem } from "../../lib/workspaceHomeModel";
import type { HomepageProjectLayout } from "../../preferenceStorage";
import type { ProjectListSharing } from "./OnboardingProjectList";

export type OnboardingProjectGroup = Readonly<{
  id: string;
  title: ReactNode;
  /** The place's shape before its name: a Space's square or a computer. */
  mark?: ReactNode;
  /** One quiet line after the title: presence, or what this computer offers. */
  detail?: ReactNode;
  /** The group's own controls at the end of its head. */
  actions?: ReactNode;
  /** The group cannot be used right now, as when its computer is offline. */
  inactive?: boolean;
  alwaysShowHeading?: boolean;
  /** Empty destinations appear only during an explicit publication gesture. */
  empty?: boolean;
  keepEmpty?: boolean;
  /** Present only for a trusted in-page drag, never dataTransfer paths. */
  dropTarget?: {
    enabled: boolean;
    onDrop: () => void;
    /** What letting go here does, said at the end of the heading while it can. */
    hint?: string;
  };
  children: ReactNode;
}>;

/** Audience composition shared by ordinary Homepage and the device-catalog owner. */
export type OnboardingGroupsBase = Readonly<{
  label: string;
  layout: HomepageProjectLayout;
  cloud: readonly OnboardingProjectGroup[];
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
  }> | null;
}>;

/** Every registered local folder stays on this computer, including shared folders and Cloud checkouts. */
export function onboardingBaseGroups(base: OnboardingGroupsBase, sharing?: ProjectListSharing): OnboardingProjectGroup[] {
  const local: OnboardingProjectGroup[] = base.local?.items.length ? [{ id: "local-only", title: base.local.title,
    mark: <LocalIcon size={16} strokeWidth={1.75} />,
    alwaysShowHeading: true, children: base.local.render([...base.local.items], sharing) }] : [];
  return [...local, ...base.cloud].filter((group) => !group.empty || group.keepEmpty);
}

/**
 * Local projects lead, followed by all accessible cloud Spaces and other computers. One page
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
  const ordered = groups;
  // A project is being dragged: the groups that take it become places to drop it.
  const dragging = groups.some((group) => group.dropTarget);
  return (
    // The thumb shows while the page scrolls or is pointed at, as the product's default:
    // a bar standing beside the folders at rest would be the heaviest line on the page.
    <div className="onboarding-project-groups" data-po-scrollbar="menu"
      data-project-dragging={dragging || undefined} aria-label={label}>
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
        {group.mark !== undefined && <span className="onboarding-project-group-mark" aria-hidden="true">{group.mark}</span>}
        <h2 id={titleId} className="onboarding-project-group-title"><bdi>{group.title}</bdi></h2>
        {group.detail !== undefined && <span className="onboarding-project-group-detail">{group.detail}</span>}
        <span className="onboarding-project-group-spacer" aria-hidden="true" />
        {group.dropTarget?.enabled && group.dropTarget.hint
          ? <span className="onboarding-project-group-drop-hint" role="status">{group.dropTarget.hint}</span>
          : group.actions !== undefined && <span className="onboarding-project-group-actions">{group.actions}</span>}
      </header>
      <div className="onboarding-project-group-content">{group.children}</div>
    </section>
  );
}
