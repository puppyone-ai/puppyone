import { LocalIcon } from "@puppyone/shared-ui";
import { useId, useState, type ReactNode } from "react";
import type { HomepageProjectLayout } from "../../preferenceStorage";
import type { ProjectListSharing } from "./OnboardingProjectList";

export type OnboardingProjectGroup = Readonly<{
  id: string;
  /** A small mark before the title: the cloud, this computer, another computer. */
  icon?: ReactNode;
  title: ReactNode;
  /** One quiet line after the title: presence, or what this computer offers. */
  detail?: ReactNode;
  /** The group's own menu, at the end of its head. */
  actions?: ReactNode;
  /** The group cannot be used right now, as when its computer is offline. */
  inactive?: boolean;
  alwaysShowHeading?: boolean;
  /** Present only for a trusted in-page drag, never dataTransfer paths. */
  dropTarget?: { enabled: boolean; onDrop: () => void };
  children: ReactNode;
}>;

/**
 * The Homepage's own groups, handed to whoever adds the owner's other computers:
 * the Cloud's projects, and how to draw this computer's.
 */
export type OnboardingGroupsBase = Readonly<{
  label: string;
  layout: HomepageProjectLayout;
  cloud: readonly OnboardingProjectGroup[];
  local: Readonly<{ title: string; render: (sharing?: ProjectListSharing) => ReactNode }> | null;
  /** False while the page is narrowed to some places; other computers are not one of them. */
  showOtherComputers: boolean;
}>;

/** The Cloud, then this computer: the order every Homepage keeps. */
export function onboardingBaseGroups(base: OnboardingGroupsBase, sharing?: ProjectListSharing): OnboardingProjectGroup[] {
  const groups: OnboardingProjectGroup[] = [];
  groups.push(...base.cloud);
  if (base.local) {
    groups.push({ id: "this-computer", icon: <LocalIcon size={14} strokeWidth={1.85} />, title: base.local.title,
      children: base.local.render(sharing) });
  }
  return groups;
}

/**
 * The Homepage's projects by where they are: the Cloud first, then this
 * computer, then each of the owner's other computers. The page scrolls as one;
 * the lists inside are laid out exactly as an ungrouped list would be.
 *
 * A single group that has nothing to say about itself is shown as its list
 * alone, so a person with only local folders sees no heading at all.
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
  return (
    <div className="onboarding-project-groups" data-po-scrollbar="menu" data-po-scrollbar-visibility="always"
      aria-label={label}>
      {groups.map((group) => <ProjectGroup key={group.id} group={group} />)}
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
        <h2 id={titleId} className="onboarding-project-group-title">
          {group.icon && <span className="onboarding-project-group-icon" aria-hidden="true">{group.icon}</span>}
          <bdi>{group.title}</bdi>
        </h2>
        {group.detail !== undefined && <span className="onboarding-project-group-detail">{group.detail}</span>}
        {group.actions !== undefined && <span className="onboarding-project-group-actions">{group.actions}</span>}
      </header>
      {group.children}
    </section>
  );
}
