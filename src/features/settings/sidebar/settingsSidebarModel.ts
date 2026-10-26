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
  type LucideIcon,
} from "lucide-react";
import type { SettingsSection } from "../types";

export type SettingsSidebarItem = {
  id: SettingsSection;
  labelId: string;
  icon: LucideIcon;
  disabled: boolean;
  requiresLocalWorkspace?: boolean;
  requiresCloud?: boolean;
  requiresOtherAppImports?: boolean;
};

export type SettingsSidebarGroupModel = {
  id: string;
  labelId: string;
  items: readonly SettingsSidebarItem[];
  requiresLocalWorkspace?: boolean;
  requiresCloud?: boolean;
};

export type SettingsVisibilityContext = {
  cloudEnabled: boolean;
  otherAppImportsEnabled?: boolean;
  localWorkspaceAvailable?: boolean;
};

/**
 * Cloud leads the list.
 *
 * Two reasons, and neither is promotion. The nav scrolls: on a short window
 * the last group is below the fold, and the account a user came to find is the
 * one thing that must never need scrolling to. And this is where money is
 * decided — identity, plan and price — so it sits where a user looks first
 * rather than after seven rows of application preferences.
 *
 * Settings still opens on General (`App.tsx`); first in the list is not the
 * default page, it is the first thing visible.
 */
export const SETTINGS_SIDEBAR_GROUPS: readonly SettingsSidebarGroupModel[] = [
  {
    id: "cloud",
    labelId: "settings.sidebar.cloud",
    items: [
      // Signing in only serves Cloud, so a local-first Desktop shows neither
      // page: with Cloud off there is no account to show and nothing to buy.
      // Who you are, then what you pay. Account reports identity and nothing
      // that costs money; Plan (section id "seats": the product is priced per
      // person) is the only place a price appears or a charge begins. The split that failed before was "Account / Plan", where both
      // pages answered what you hold.
      //
      // Invoices are deliberately absent: they are documents, card forms and
      // tax fields, which belong in a browser rather than a settings pane, so
      // Plan links out to them instead of hosting a third entry here.
      { id: "account", labelId: "settings.sidebar.account", icon: UserRound, disabled: false, requiresCloud: true },
      { id: "seats", labelId: "settings.sidebar.seats", icon: CreditCard, disabled: false, requiresCloud: true },
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
  otherAppImportsEnabled = false,
  localWorkspaceAvailable = true,
}: SettingsVisibilityContext): readonly SettingsSidebarGroupModel[] {
  return SETTINGS_SIDEBAR_GROUPS
    .filter((group) => (!group.requiresCloud || cloudEnabled)
      && (!group.requiresLocalWorkspace || localWorkspaceAvailable))
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => (
        (!item.requiresCloud || cloudEnabled)
        && (!item.requiresLocalWorkspace || localWorkspaceAvailable)
        && (!item.requiresOtherAppImports || otherAppImportsEnabled)
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
