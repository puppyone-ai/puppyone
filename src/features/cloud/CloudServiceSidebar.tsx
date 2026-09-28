import { useLocalization } from "@puppyone/localization/react";
import { SidebarRoot, SidebarRow, SidebarScrollArea, Tooltip } from "@puppyone/shared-ui";
import { SidebarGroup } from "../../components/sidebar";
import type { CloudServiceSidebarProps, CloudWorkspaceSection } from "./types";
import { getCloudAuthSession } from "./auth";
import {
  CLOUD_BOUND_PROJECT_SIDEBAR_ROUTES,
  getCloudSidebarActiveSection,
  getCloudSignedOutSection,
  getAvailableCloudSection,
  withShareHomeSidebarRoutes,
  type CloudRouteNavigationGroup,
  type CloudRouteDescriptor,
} from "./routes/cloudRoutes";
import { useCloudShare } from "./share/CloudShareContext";
import { useFeatureFlag } from "../flags";

type CloudSidebarNavEntry = {
  id: CloudWorkspaceSection;
  labelId: string;
  icon: CloudRouteDescriptor["icon"];
  context: CloudRouteDescriptor["context"];
  requiredCapability?: string;
  navigationGroup?: CloudRouteNavigationGroup;
  locked?: boolean;
};

type CloudSidebarNavGroup = {
  id: CloudRouteNavigationGroup;
  labelId:
    | "cloud.sidebar.projectGroup"
    | "cloud.sidebar.connectionsGroup"
    | "cloud.sidebar.automationGroup"
    | "cloud.sidebar.organizationGroup";
  items: CloudSidebarNavEntry[];
};

export function CloudServiceSidebar({
  cloudAuthState,
  activeSection,
  automationEnabled,
  projectAvailable = false,
  projectCapabilities = [],
  onSelectSection,
}: CloudServiceSidebarProps) {
  const { t } = useLocalization();
  const billingEnabled = useFeatureFlag("cloudBilling");
  const shareHome = useCloudShare() !== null;
  const normalizedActiveSection = getAvailableCloudSection(activeSection, { automationEnabled });
  const signedIn = Boolean(getCloudAuthSession(cloudAuthState));
  const visibleActiveSection = getCloudSidebarActiveSection(
    signedIn
      ? normalizedActiveSection
      : getCloudSignedOutSection(normalizedActiveSection),
  );
  const sidebarRoutes = shareHome
    ? withShareHomeSidebarRoutes(CLOUD_BOUND_PROJECT_SIDEBAR_ROUTES)
    : CLOUD_BOUND_PROJECT_SIDEBAR_ROUTES;
  const navItems: CloudSidebarNavEntry[] = sidebarRoutes.map((route: CloudRouteDescriptor) => ({
    ...route,
    locked: route.context === "project"
      ? projectAvailable
        && Boolean(route.requiredCapability && !projectCapabilities.includes(route.requiredCapability))
      : false,
  })).filter((item) => (
    (item.id !== "cloud-billing" || billingEnabled)
    && (item.id !== "automation" || automationEnabled)
  ));
  const navGroups = buildCloudSidebarNavGroups(navItems);

  return (
    <SidebarRoot className="desktop-cloud-service-sidebar">
      <SidebarScrollArea>
        <nav className="desktop-cloud-sidebar-nav" aria-label={t("cloud.sidebar.projectSections")}>
          {navGroups.map((group) => {
            const disabled = group.items.every((item) => item.locked);
            return (
              <SidebarGroup
                title={t(group.labelId)}
                disabled={disabled}
                key={group.id}
              >
                {group.items.map((item) => (
                  <CloudSidebarNavItem
                    key={item.id}
                    item={item}
                    lockedReason={!signedIn ? "sign-in" : "initialize"}
                    active={
                      !item.locked && (
                        visibleActiveSection === item.id
                      )
                    }
                    onSelect={onSelectSection}
                  />
                ))}
              </SidebarGroup>
            );
          })}
        </nav>
      </SidebarScrollArea>
    </SidebarRoot>
  );
}

export function CloudSidebarNavItem({
  item,
  active,
  lockedReason = "sign-in",
  onSelect,
}: {
  item: CloudSidebarNavEntry;
  active: boolean;
  lockedReason?: "sign-in" | "initialize";
  onSelect: (section: CloudWorkspaceSection) => void;
}) {
  const { t } = useLocalization();
  const Icon = item.icon;
  const label = t(item.labelId);
  const lockedTitle = item.locked
    ? t(lockedReason === "initialize" ? "cloud.sidebar.initializeToUse" : "cloud.sidebar.signInToUse")
    : undefined;

  return (
    <Tooltip content={lockedTitle}>
      <SidebarRow
        active={active}
        disabled={item.locked}
        aria-disabled={item.locked || undefined}
        onClick={() => {
          if (!item.locked) onSelect(item.id);
        }}
        icon={<Icon size={15} />}
        label={label}
      />
    </Tooltip>
  );
}

function buildCloudSidebarNavGroups(items: readonly CloudSidebarNavEntry[]): CloudSidebarNavGroup[] {
  const groups: CloudSidebarNavGroup[] = [
    {
      id: "project",
      labelId: "cloud.sidebar.projectGroup",
      items: items.filter((item) => item.navigationGroup === "project"),
    },
    {
      id: "connections",
      labelId: "cloud.sidebar.connectionsGroup",
      items: items.filter((item) => item.navigationGroup === "connections"),
    },
    {
      id: "automation",
      labelId: "cloud.sidebar.automationGroup",
      items: items.filter((item) => item.navigationGroup === "automation"),
    },
    {
      id: "organization",
      labelId: "cloud.sidebar.organizationGroup",
      items: items.filter((item) => item.navigationGroup === "organization"),
    },
  ];

  return groups.filter((group) => group.items.length > 0);
}
