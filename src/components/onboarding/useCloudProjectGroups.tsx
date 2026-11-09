import { type ReactNode } from "react";
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
  const source = localItems.find((item) => item.localPath === draggingPath && !item.linkedCloudProject);
  const groups: OnboardingProjectGroup[] = [];

  function destination(space: CloudSpace, id: string, title: string): OnboardingProjectGroup {
    const projects = cloudItems.filter((item) => item.cloudOrganizationId === space.id);
    const writable = space.canCreateProjects && !busy && Boolean(onPublish);
    return {
      id, title, alwaysShowHeading: true, empty: projects.length === 0,
      // Every writable Space uses the same explicit publication flow.
      keepEmpty: Boolean(space.canCreateProjects || (source && onPublish)),
      dropTarget: draggingPath ? { enabled: writable && Boolean(source),
        hint: t("onboarding.drop.team"), onDrop: () => {
        onDragEnd();
        if (writable && source) void onPublish?.(source.localPath, space.id);
      } } : undefined,
      children: projects.length ? renderProjects(projects) : <p className="onboarding-cloud-space-empty">
        {t(space.canCreateProjects ? "onboarding.spaces.empty" : "onboarding.spaces.readOnly")}
      </p>,
    };
  }

  // Plans belong to spaces: each heading names the space and the plan its
  // projects use, so where a project lives says who pays for it.
  const planBadge = (space: CloudSpace) => space.planId
    ? <span className="onboarding-space-plan">{t(`onboarding.spaces.plan.${planKey(space.planId)}`)}</span>
    : undefined;
  for (const space of spaces) {
    groups.push({ ...destination(space, `space:${space.id}`, space.name), detail: planBadge(space) });
  }
  // Unresolved ownership is not evidence of a personal or team audience. Keep
  // existing content reachable while discovery is unavailable, without guessing.
  const unknown = cloudItems.filter((item) => !spaces.some((space) => space.id === item.cloudOrganizationId));
  if (unknown.length) groups.push({ id: "shared-unresolved",
    title: t("onboarding.sharing.unresolved"), alwaysShowHeading: true, children: renderProjects(unknown) });
  return groups;
}

function planKey(planId: string): "free" | "team" | "enterprise" {
  if (planId === "plus" || planId === "personal" || planId === "team_v2") return "team";
  if (planId === "business" || planId === "pro" || planId === "team" || planId === "enterprise_v2") return "enterprise";
  if (planId === "enterprise") return "enterprise";
  return "free";
}
