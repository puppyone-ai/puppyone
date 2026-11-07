import { useState, type ReactNode } from "react";
import { useLocalization } from "@puppyone/localization";
import type { CloudSpace, ProjectHomeItem } from "../../lib/workspaceHomeModel";
import type { OnboardingProjectGroup } from "./OnboardingProjectGroups";

/**
 * Space identity chooses the audience; a team's name is a selector, not another heading.
 * An existing project joins a group by being dragged in; New project starts one anywhere.
 */
export function useCloudProjectGroups({ spaces, cloudItems, localItems, renderProjects, draggingPath, busy, onPublish, onDragEnd }: {
  spaces: readonly CloudSpace[]; cloudItems: ProjectHomeItem[]; localItems: ProjectHomeItem[];
  renderProjects: (items: ProjectHomeItem[]) => ReactNode; draggingPath: string | null; busy: boolean;
  onPublish?: (path: string, spaceId: string) => Promise<void>; onDragEnd: () => void;
}): OnboardingProjectGroup[] {
  const { t } = useLocalization();
  const [chosenTeam, setChosenTeam] = useState<string | null>(null);
  const source = localItems.find((item) => item.localPath === draggingPath && !item.linkedCloudProject);
  const personal = spaces.find((space) => space.kind === "personal");
  const teams = spaces.filter((space) => space.kind === "team");
  const team = teams.find((space) => space.id === chosenTeam)
    ?? teams.find((space) => cloudItems.some((item) => item.cloudOrganizationId === space.id)) ?? teams[0];
  const groups: OnboardingProjectGroup[] = [];

  function destination(space: CloudSpace, id: string, title: string): OnboardingProjectGroup {
    const projects = cloudItems.filter((item) => item.cloudOrganizationId === space.id);
    const writable = space.canCreateProjects && !busy && Boolean(onPublish);
    return {
      id, title, alwaysShowHeading: true, empty: projects.length === 0,
      // A space one can add projects to stays, empty or not, to drag one into.
      keepEmpty: Boolean(space.canCreateProjects || (space.kind === "team" && source && onPublish)),
      // A personal-area drop means sharing from this computer, not uploading.
      // Homepage's device composition supplies that action; never fall back here.
      dropTarget: draggingPath ? { enabled: space.kind === "team" && writable && Boolean(source),
        hint: t("onboarding.drop.team"), onDrop: () => {
        onDragEnd();
        if (space.kind === "team" && writable && source) void onPublish?.(source.localPath, space.id);
      } } : undefined,
      children: projects.length ? renderProjects(projects) : <p className="onboarding-cloud-space-empty">
        {t(space.canCreateProjects ? "onboarding.spaces.empty" : "onboarding.spaces.readOnly")}
      </p>,
    };
  }

  if (personal) groups.push(destination(personal, "personal-shared", t("onboarding.sharing.personal")));
  if (team) {
    const group = destination(team, "team-shared", t("onboarding.sharing.team"));
    groups.push({ ...group,
      keepEmpty: group.keepEmpty || cloudItems.some((item) => teams.some((space) => space.id === item.cloudOrganizationId)),
      // One team needs no name beside the heading; several need choosing between.
      detail: teams.length > 1 ? <select className="onboarding-team-selector"
        aria-label={t("onboarding.sharing.selectTeam")} value={team.id} disabled={busy}
        onChange={(event) => { onDragEnd(); setChosenTeam(event.target.value); }}>
        {teams.map((space) => <option key={space.id} value={space.id}>{space.name}</option>)}
      </select> : undefined,
    });
  }
  // Unresolved ownership is not evidence of a personal or team audience. Keep
  // existing content reachable while discovery is unavailable, without guessing.
  const unknown = cloudItems.filter((item) => !spaces.some((space) => space.id === item.cloudOrganizationId));
  if (unknown.length) groups.push({ id: "shared-unresolved",
    title: t("onboarding.sharing.unresolved"), alwaysShowHeading: true, children: renderProjects(unknown) });
  return groups;
}
