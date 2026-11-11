import {
  Bot,
  CreditCard,
  FileText,
  FlaskConical,
  FolderCog,
  FolderInput,
  GitBranch,
  ListPlus,
  Monitor,
  Plug,
  Server,
  Settings,
  ShieldCheck,
  Type,
  UserRound,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { LocalIcon } from "@puppyone/shared-ui";
import type { SettingsSection } from "../types";

export type SettingsSidebarItem = {
  id: SettingsSection;
  labelId: string;
  icon: LucideIcon;
  disabled: boolean;
  requiresLocalWorkspace?: boolean;
  requiresCloud?: boolean;
  requiresAccount?: boolean;
  requiresSpace?: boolean;
  requiresOtherAppImports?: boolean;
  requiresHostDevices?: boolean;
};

export type SettingsSidebarGroupModel = {
  id: string;
  labelId: string;
  /** The heading while Cloud is off, when the group holds the account alone. */
  labelWithoutCloudId?: string;
  items: readonly SettingsSidebarItem[];
  requiresLocalWorkspace?: boolean;
  requiresCloud?: boolean;
};

export type SettingsVisibilityContext = {
  cloudEnabled: boolean;
  currentSpaceAvailable?: boolean;
  /** The build offers a PuppyOne account, with or without Cloud. */
  accountAvailable: boolean;
  otherAppImportsEnabled?: boolean;
  localWorkspaceAvailable?: boolean;
  /** Sharing folders with the owner's other computers is on for this account. */
  hostDevicesEnabled?: boolean;
};

/** Identity, current Space and application preferences stay at the same navigation level. */
export const SETTINGS_SIDEBAR_GROUPS: readonly SettingsSidebarGroupModel[] = [
  {
    id: "cloud",
    labelId: "settings.sidebar.accountGroup",
    items: [
      { id: "account", labelId: "settings.sidebar.account", icon: UserRound, disabled: false, requiresAccount: true },
    ],
  },
  {
    id: "space",
    labelId: "settings.space.group",
    requiresCloud: true,
    items: [
      { id: "space", labelId: "settings.space.membersAndSettings", icon: UsersRound, disabled: false, requiresSpace: true },
      // Keep the historical route for billing links and the standalone Plan preview.
      { id: "seats", labelId: "settings.sidebar.seats", icon: CreditCard, disabled: false },
    ],
  },
  {
    id: "desktop-app",
    labelId: "settings.sidebar.desktopApp",
    items: [
      { id: "general", labelId: "settings.sidebar.general", icon: Settings, disabled: false },
      { id: "appearance", labelId: "settings.sidebar.appearance", icon: Monitor, disabled: false },
      { id: "typography", labelId: "settings.sidebar.typography", icon: Type, disabled: false },
      { id: "new-menu", labelId: "settings.sidebar.createNew", icon: ListPlus, disabled: false },
      { id: "other-app-imports", labelId: "settings.sidebar.otherAppImports", icon: FolderInput, disabled: false, requiresOtherAppImports: true },
      { id: "privacy", labelId: "settings.sidebar.privacy", icon: ShieldCheck, disabled: false },
      { id: "other-computers", labelId: "settings.sidebar.otherComputers", icon: LocalIcon, disabled: false, requiresHostDevices: true },
      { id: "experimental", labelId: "settings.sidebar.experimental", icon: FlaskConical, disabled: false },
    ],
  },
  {
    id: "agents",
    labelId: "settings.sidebar.agents",
    items: [
      { id: "local-agents", labelId: "settings.sidebar.localAgents", icon: Bot, disabled: false },
      { id: "model-connections", labelId: "settings.modelConnections.title", icon: Plug, disabled: false },
    ],
  },
  {
    id: "local-project",
    requiresLocalWorkspace: true,
    labelId: "settings.sidebar.localProject",
    items: [
      { id: "local-project", labelId: "settings.sidebar.projectInfo", icon: FolderCog, disabled: false },
      // Where this project is hosted is a fact about the project, not about
      // our Cloud: the choice includes GitHub, and it has to stay answerable
      // for a project that will never touch PuppyOne Cloud at all. It sits
      // next to Git for the same reason — both describe the same remote.
      { id: "cloud", labelId: "settings.sidebar.hostServer", icon: Server, disabled: false },
      { id: "git", labelId: "settings.sidebar.git", icon: GitBranch, disabled: false },
      { id: "files", labelId: "settings.sidebar.gitIgnore", icon: FileText, disabled: false },
    ],
  },
];

export function resolveSettingsSidebarGroups({
  cloudEnabled,
  currentSpaceAvailable = false,
  accountAvailable,
  otherAppImportsEnabled = false,
  localWorkspaceAvailable = true,
  hostDevicesEnabled = false,
}: SettingsVisibilityContext): readonly SettingsSidebarGroupModel[] {
  return SETTINGS_SIDEBAR_GROUPS
    .filter((group) => (!group.requiresCloud || cloudEnabled)
      && (!group.requiresLocalWorkspace || localWorkspaceAvailable))
    .map((group) => ({
      ...group,
      labelId: !cloudEnabled && group.labelWithoutCloudId ? group.labelWithoutCloudId : group.labelId,
      items: group.items.filter((item) => (
        (!item.requiresCloud || cloudEnabled)
        && (!item.requiresAccount || accountAvailable)
        && (!item.requiresSpace || currentSpaceAvailable)
        && (!item.requiresLocalWorkspace || localWorkspaceAvailable)
        && (!item.requiresOtherAppImports || otherAppImportsEnabled)
        && (!item.requiresHostDevices || hostDevicesEnabled)
      )),
    }))
    .filter((group) => group.items.length > 0);
}

export function isSettingsSectionAvailable(
  section: SettingsSection,
  context: SettingsVisibilityContext,
): boolean {
  return resolveSettingsSidebarGroups(context).some((group) => (
    group.items.some((item) => item.id === section)
  ));
}
