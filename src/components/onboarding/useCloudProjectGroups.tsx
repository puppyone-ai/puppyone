import { type ReactNode } from "react";
import { useLocalization } from "@puppyone/localization";
import type { CloudSpace, ProjectHomeItem } from "../../lib/workspaceHomeModel";
import type { OnboardingProjectGroup } from "./OnboardingProjectGroups";

/**
 * All accessible Spaces appear together, with their own project groups.
 * An existing project joins a group by being dragged in; New project starts one anywhere.
 */
export function useCloudProjectGroups({ spaces, cloudItems, localItems, renderProjects, draggingPath, busy, onPublish, onDragEnd, onManageSpace }: {
  spaces: readonly CloudSpace[]; cloudItems: ProjectHomeItem[]; localItems: ProjectHomeItem[];
  renderProjects: (items: ProjectHomeItem[]) => ReactNode; draggingPath: string | null; busy: boolean;
  onPublish?: (path: string, spaceId: string) => Promise<void>; onDragEnd: () => void;
  /** Opens Settings on this one Space: its members, its seats and its plan. */
  onManageSpace?: (spaceId: string) => void;
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
      keepEmpty: true,
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
  const manage = (space: CloudSpace) => onManageSpace
    ? <button type="button" className="onboarding-space-manage" onClick={() => onManageSpace(space.id)}>
      {t("settings.space.manage")}
    </button>
    : undefined;
  for (const space of spaces) {
    groups.push({ ...destination(space, `space:${space.id}`, space.name), detail: planBadge(space), actions: manage(space) });
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
