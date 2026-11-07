import { useState, type ReactNode } from "react";
import { UserRound, UsersRound } from "lucide-react";
import { useLocalization } from "@puppyone/localization";
import type { CloudSpace, ProjectHomeItem } from "../../lib/workspaceHomeModel";
import { DesktopMenuItem } from "../DesktopMenu";
import { OnboardingGroupMenu } from "./OnboardingGroupMenu";
import type { OnboardingProjectGroup } from "./OnboardingProjectGroups";

/** Space identity chooses the audience; a team's name is a selector, not another heading. */
export function useCloudProjectGroups({ spaces, cloudItems, localItems, renderProjects, draggingPath, busy, onPublish, onDragEnd }: {
  spaces: readonly CloudSpace[]; cloudItems: ProjectHomeItem[]; localItems: ProjectHomeItem[];
  renderProjects: (items: ProjectHomeItem[]) => ReactNode; draggingPath: string | null; busy: boolean;
  onPublish?: (path: string, spaceId: string) => Promise<void>; onDragEnd: () => void;
}): OnboardingProjectGroup[] {
  const { t } = useLocalization();
  const [chosenTeam, setChosenTeam] = useState<string | null>(null);
  const source = localItems.find((item) => item.localPath === draggingPath && !item.linkedCloudProject);
  const candidates = localItems.filter((item) => item.localPath && !item.linkedCloudProject);
  const personal = spaces.find((space) => space.kind === "personal");
  const teams = spaces.filter((space) => space.kind === "team");
  const team = teams.find((space) => space.id === chosenTeam)
    ?? teams.find((space) => cloudItems.some((item) => item.cloudOrganizationId === space.id)) ?? teams[0];
  const groups: OnboardingProjectGroup[] = [];

  function destination(space: CloudSpace, id: string, title: string, icon: ReactNode): OnboardingProjectGroup {
    const projects = cloudItems.filter((item) => item.cloudOrganizationId === space.id);
    const writable = space.canCreateProjects && !busy && Boolean(onPublish);
    return {
      id, title, icon, alwaysShowHeading: true, empty: projects.length === 0,
      keepEmpty: Boolean(source && onPublish),
      dropTarget: draggingPath ? { enabled: writable && Boolean(source), onDrop: () => {
        onDragEnd();
        if (writable && source) void onPublish?.(source.localPath, space.id);
      } } : undefined,
      actions: onPublish && <OnboardingGroupMenu label={t("onboarding.spaces.addProject", { name: space.name })}
        disabled={!writable || candidates.length === 0}>
        {(close) => candidates.map((item) => <DesktopMenuItem key={item.id} label={item.label}
          onClick={() => { close(); void onPublish(item.localPath, space.id); }} />)}
      </OnboardingGroupMenu>,
      children: projects.length ? renderProjects(projects) : <p className="onboarding-cloud-space-empty">
        {t(space.canCreateProjects ? "onboarding.spaces.empty" : "onboarding.spaces.readOnly")}
      </p>,
    };
  }

  if (personal) groups.push(destination(personal, "personal-shared", t("onboarding.sharing.personal"), <UserRound size={14} />));
  if (team) {
    const group = destination(team, "team-shared", t("onboarding.sharing.team"), <UsersRound size={14} />);
    groups.push({ ...group,
      keepEmpty: group.keepEmpty || cloudItems.some((item) => teams.some((space) => space.id === item.cloudOrganizationId)),
      detail: teams.length === 1 ? team.name : <select className="onboarding-team-selector"
        aria-label={t("onboarding.sharing.selectTeam")} value={team.id} disabled={busy}
        onChange={(event) => { onDragEnd(); setChosenTeam(event.target.value); }}>
        {teams.map((space) => <option key={space.id} value={space.id}>{space.name}</option>)}
      </select>,
    });
  }
  // Unresolved ownership is not evidence of a personal or team audience. Keep
  // existing content reachable while discovery is unavailable, without guessing.
  const unknown = cloudItems.filter((item) => !spaces.some((space) => space.id === item.cloudOrganizationId));
  if (unknown.length) groups.push({ id: "shared-unresolved", icon: <UsersRound size={14} />,
    title: t("onboarding.sharing.unresolved"), alwaysShowHeading: true, children: renderProjects(unknown) });
  return groups;
}
