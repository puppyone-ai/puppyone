import { useLocalization } from "@puppyone/localization";
import { Plus } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import type { ProjectHomeItem } from "../../lib/workspaceHomeModel";
import { useComputerModeEnabled } from "../flags";
import { MutedLocalFoldersSection } from "./MutedLocalFoldersSection";
import type { ComputerVisualPowerState } from "./ProjectComputerGlyph";
import { normalizeComputerWorkspacePath, useLocalComputers } from "./useLocalComputers";

function toVisualPowerState(status: string): ComputerVisualPowerState {
  if (status === "asleep" || status === "stopped") return "asleep";
  if (status === "provisioning") return "provisioning";
  return "running";
}

export function useComputerModeHomepage<TSharing>({
  localItems,
  platform,
  canCreateProject,
  onCreateComputer,
  renderComputerList,
  renderPlainFolderList,
}: {
  localItems: readonly ProjectHomeItem[];
  platform?: string;
  canCreateProject: boolean;
  onCreateComputer: () => void;
  renderComputerList: (
    items: ProjectHomeItem[],
    sharing: TSharing | undefined,
    powerByPath: ReadonlyMap<string, ComputerVisualPowerState>,
  ) => ReactNode;
  renderPlainFolderList: (items: ProjectHomeItem[], sharing?: TSharing) => ReactNode;
}) {
  const { t } = useLocalization();
  const computerMode = useComputerModeEnabled();
  const { computersByPath } = useLocalComputers();

  const computerPowerByPath = useMemo(() => {
    const map = new Map<string, ComputerVisualPowerState>();
    for (const [workspacePath, record] of computersByPath.entries()) {
      map.set(workspacePath, toVisualPowerState(record.status));
    }
    return map;
  }, [computersByPath]);

  const { computerItems, plainFolderItems } = useMemo(() => {
    if (!computerMode) {
      return { computerItems: [] as ProjectHomeItem[], plainFolderItems: [...localItems] };
    }
    const computers: ProjectHomeItem[] = [];
    const folders: ProjectHomeItem[] = [];
    for (const item of localItems) {
      if (computersByPath.has(normalizeComputerWorkspacePath(item.localPath))) {
        computers.push(item);
      } else {
        folders.push(item);
      }
    }
    return { computerItems: computers, plainFolderItems: folders };
  }, [computerMode, computersByPath, localItems]);

  if (!computerMode) {
    return {
      computerMode: false as const,
      sectionTitle: t("onboarding.projects.title"),
      computerPowerByPath,
      computerGroup: undefined,
      plainFoldersFooter: undefined,
    };
  }

  const groupTitle = platform === "macos"
    ? t("onboarding.computerMode.thisMacTitle")
    : t("onboarding.computerMode.thisComputerTitle");

  const addAction = canCreateProject ? (
    <button
      type="button"
      className="computer-mode-group-add-button"
      onClick={onCreateComputer}
    >
      <Plus size={13} strokeWidth={2} aria-hidden="true" />
      <span>{t("onboarding.computerMode.createAction")}</span>
    </button>
  ) : undefined;

  const emptyState = computerItems.length === 0 && plainFolderItems.length > 0 ? (
    <div className="computer-mode-empty-computers">
      <span>{t("onboarding.computerMode.emptyOnDevice")}</span>
      {addAction}
    </div>
  ) : undefined;

  const computerGroup = computerItems.length > 0 || emptyState ? {
    title: groupTitle,
    items: computerItems,
    render: (items: ProjectHomeItem[], sharing?: TSharing) => (
      renderComputerList(items, sharing, computerPowerByPath)
    ),
    actions: computerItems.length > 0 ? addAction : undefined,
    emptyState,
  } : undefined;

  const plainFoldersFooter = plainFolderItems.length > 0
    ? (sharing?: TSharing) => (
      <MutedLocalFoldersSection count={plainFolderItems.length}>
        {renderPlainFolderList([...plainFolderItems], sharing)}
      </MutedLocalFoldersSection>
    )
    : undefined;

  return {
    computerMode: true as const,
    sectionTitle: t("onboarding.computerMode.sectionTitle"),
    computerPowerByPath,
    computerGroup,
    plainFoldersFooter,
  };
}
