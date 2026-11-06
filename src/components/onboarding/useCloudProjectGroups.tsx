import type { ReactNode } from "react";
import { CloudIcon } from "@puppyone/shared-ui";
import { useLocalization } from "@puppyone/localization";
import type { CloudSpace, ProjectHomeItem } from "../../lib/workspaceHomeModel";
import { DesktopMenuItem } from "../DesktopMenu";
import { OnboardingGroupMenu } from "./OnboardingGroupMenu";
import type { OnboardingProjectGroup } from "./OnboardingProjectGroups";

export function useCloudProjectGroups({ spaces, cloudItems, localItems, renderProjects, draggingPath, busy, onPublish, onDragEnd }: {
  spaces: readonly CloudSpace[]; cloudItems: ProjectHomeItem[]; localItems: ProjectHomeItem[];
  renderProjects: (items: ProjectHomeItem[]) => ReactNode; draggingPath: string | null; busy: boolean;
  onPublish?: (path: string, spaceId: string) => Promise<void>; onDragEnd: () => void;
}): OnboardingProjectGroup[] {
  const { t } = useLocalization();
  const source = localItems.find((item) => item.localPath === draggingPath && !item.linkedCloudProject);
  const candidates = localItems.filter((item) => item.localPath && !item.linkedCloudProject);
  const groups: OnboardingProjectGroup[] = spaces.map((space) => {
    const projects = cloudItems.filter((item) => item.cloudOrganizationId === space.id);
    const writable = space.canCreateProjects && !busy && Boolean(onPublish);
    return {
      id: `cloud-space:${space.id}`, icon: <CloudIcon size={14} strokeWidth={1.85} />,
      title: space.name, alwaysShowHeading: true,
      detail: t(space.kind === "personal" ? "onboarding.spaces.personal" : "onboarding.spaces.organization"),
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
  });
  const unknown = cloudItems.filter((item) => !spaces.some((space) => space.id === item.cloudOrganizationId));
  if (unknown.length) groups.push({ id: "cloud", icon: <CloudIcon size={14} strokeWidth={1.85} />,
    title: t("onboarding.projects.groups.cloud"), children: renderProjects(unknown) });
  return groups;
}
