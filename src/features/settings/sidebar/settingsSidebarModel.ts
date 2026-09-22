import {
  Bot,
  Cloud,
  FileText,
  FlaskConical,
  FolderCog,
  GitBranch,
  ListPlus,
  Monitor,
  Plug,
  Settings,
  ShieldCheck,
  Type,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import type { SettingsSection } from "../types";

export type SettingsSidebarItem = {
  id: SettingsSection;
  labelId: string;
  icon: LucideIcon;
  disabled: boolean;
  requiresCloud?: boolean;
};

export type SettingsSidebarGroupModel = {
  id: string;
  labelId: string;
  items: readonly SettingsSidebarItem[];
  requiresCloud?: boolean;
};

export type SettingsVisibilityContext = {
  cloudEnabled: boolean;
};

export const SETTINGS_SIDEBAR_GROUPS: readonly SettingsSidebarGroupModel[] = [
  {
    id: "desktop-app",
    labelId: "settings.sidebar.desktopApp",
    items: [
      { id: "general", labelId: "settings.sidebar.general", icon: Settings, disabled: false },
      { id: "appearance", labelId: "settings.sidebar.appearance", icon: Monitor, disabled: false },
      { id: "typography", labelId: "settings.sidebar.typography", icon: Type, disabled: false },
      { id: "new-menu", labelId: "settings.sidebar.createNew", icon: ListPlus, disabled: false },
      { id: "privacy", labelId: "settings.sidebar.privacy", icon: ShieldCheck, disabled: false },
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
    labelId: "settings.sidebar.localProject",
    items: [
      { id: "local-project", labelId: "settings.sidebar.projectInfo", icon: FolderCog, disabled: false },
      { id: "git", labelId: "settings.sidebar.git", icon: GitBranch, disabled: false },
      { id: "files", labelId: "settings.sidebar.gitIgnore", icon: FileText, disabled: false },
    ],
  },
  {
    id: "cloud",
    labelId: "settings.sidebar.cloud",
    items: [
      { id: "account", labelId: "settings.sidebar.account", icon: UserRound, disabled: false },
      { id: "cloud", labelId: "settings.sidebar.cloudHosting", icon: Cloud, disabled: false, requiresCloud: true },
    ],
  },
];

export function resolveSettingsSidebarGroups({
  cloudEnabled,
}: SettingsVisibilityContext): readonly SettingsSidebarGroupModel[] {
  return SETTINGS_SIDEBAR_GROUPS
    .filter((group) => !group.requiresCloud || cloudEnabled)
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => !item.requiresCloud || cloudEnabled),
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
