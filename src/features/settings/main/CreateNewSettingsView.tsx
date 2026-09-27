import { useMemo, useState, type DragEvent } from "react";
import {
  ChevronRight,
  GripVertical,
  LockKeyhole,
  RotateCcw,
  Workflow,
} from "lucide-react";
import {
  FileGlyphIcon,
  type DataNode,
  type FileIconThemeId,
} from "@puppyone/shared-ui";
import { useLocalization } from "@puppyone/localization";
import {
  CREATE_NEW_MENU_VERSION,
  CREATE_NEW_SUBMENU_ID,
  cloneDefaultCreateNewMenuSettings,
  isCreateNewItemAvailable,
  isCreateNewItemId,
  type CreateNewItemId,
  type CreateNewMainMenuEntry,
  type CreateNewMenuPlacement,
  type CreateNewMenuSettings,
  type CreateNewSubmenuId,
  type ExperimentalSettings,
} from "../../../preferences";
import { getCreateEntryMenuItem } from "../../create-new/createEntryMenuRegistry";
import { SettingsSectionHeader } from "../components";

type CreateNewDraggableEntry = CreateNewItemId | CreateNewSubmenuId;
type MenuGroup = CreateNewMenuPlacement;
type DragTarget = {
  group: MenuGroup;
  index: number;
};

export function CreateNewSettingsView({
  settings,
  experimentalSettings,
  fileIconTheme,
  onChange,
}: {
  settings: CreateNewMenuSettings;
  experimentalSettings: ExperimentalSettings;
  fileIconTheme: FileIconThemeId;
  onChange: (settings: CreateNewMenuSettings) => void;
}) {
  const { t } = useLocalization();
  const [draggedEntry, setDraggedEntry] = useState<CreateNewDraggableEntry | null>(null);
  const [dragTarget, setDragTarget] = useState<DragTarget | null>(null);
  const defaultSettings = useMemo(() => cloneDefaultCreateNewMenuSettings(), []);
  const defaultsRestored = menuSettingsEqual(settings, defaultSettings);

  const clearDragState = () => {
    setDraggedEntry(null);
    setDragTarget(null);
  };

  const handleDragStart = (
    event: DragEvent<HTMLButtonElement>,
    entry: CreateNewDraggableEntry,
  ) => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", entry);
    setDraggedEntry(entry);
  };

  const setDropTarget = (
    event: DragEvent<HTMLElement>,
    group: MenuGroup,
    index: number,
  ) => {
    if (!draggedEntry || (draggedEntry === CREATE_NEW_SUBMENU_ID && group !== "main")) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    setDragTarget({ group, index });
  };

  const setRowDropTarget = (
    event: DragEvent<HTMLDivElement>,
    group: MenuGroup,
    index: number,
    entry: CreateNewDraggableEntry,
  ) => {
    if (!draggedEntry || draggedEntry === entry) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const pointerRatio = bounds.height > 0
      ? (event.clientY - bounds.top) / bounds.height
      : 0;
    if (
      entry === CREATE_NEW_SUBMENU_ID
      && draggedEntry !== CREATE_NEW_SUBMENU_ID
      && pointerRatio >= 0.25
      && pointerRatio <= 0.75
    ) {
      setDropTarget(event, "submenu", settings.submenu.length);
      return;
    }
    setDropTarget(event, group, index + (pointerRatio >= 0.5 ? 1 : 0));
  };

  const completeDrop = (
    event: DragEvent<HTMLElement>,
    fallbackTarget: DragTarget,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const rawEntry = event.dataTransfer.getData("text/plain");
    if (!isCreateNewDraggableEntry(rawEntry)) {
      clearDragState();
      return;
    }
    const target = dragTarget ?? fallbackTarget;
    onChange(moveEntry(settings, rawEntry, target.group, target.index));
    clearDragState();
  };

  const renderRow = (
    entry: CreateNewDraggableEntry,
    group: MenuGroup,
    index: number,
  ) => {
    const isSubmenu = entry === CREATE_NEW_SUBMENU_ID;
    const label = isSubmenu
      ? t("workspace.node.customFiles")
      : t(`workspace.node.create.kind.${entry}.label`);
    const available = isSubmenu || isCreateNewItemAvailable(entry, experimentalSettings);
    const dragBefore = dragTarget?.group === group && dragTarget.index === index;
    const dragAfter = dragTarget?.group === group && dragTarget.index === index + 1;

    return (
      <div
        className={`desktop-create-new-row ${isSubmenu ? "desktop-create-new-submenu-row" : "desktop-create-new-file-row"}`}
        data-drag-before={dragBefore || undefined}
        data-drag-after={dragAfter || undefined}
        data-dragging={draggedEntry === entry || undefined}
        data-entry={entry}
        data-group={group}
        data-unavailable={!available || undefined}
        key={entry}
        role="listitem"
        title={!available ? t("settings.createNew.unavailable") : undefined}
        onDragOver={(event) => setRowDropTarget(event, group, index, entry)}
        onDrop={(event) => completeDrop(event, { group, index })}
      >
        <button
          className="desktop-create-new-drag-handle"
          type="button"
          draggable
          aria-label={t("settings.createNew.dragToReorder", { type: label })}
          title={t("settings.createNew.dragToReorder", { type: label })}
          onDragStart={(event) => handleDragStart(event, entry)}
          onDragEnd={clearDragState}
        >
          <GripVertical size={14} aria-hidden="true" />
        </button>
        {isSubmenu ? (
          <span className="desktop-create-new-submenu-glyph" aria-hidden="true">
            <Workflow size={15} />
          </span>
        ) : (
          <CreateNewGlyph
            iconName={getCreateEntryMenuItem(entry).iconName}
            iconType={getCreateEntryMenuItem(entry).iconType}
            theme={fileIconTheme}
          />
        )}
        <span className="desktop-create-new-row-label">{label}</span>
        {isSubmenu && (
          <div className="desktop-create-new-row-controls">
            <span className="desktop-create-new-submenu-badge">
              {t("settings.createNew.submenu.badge")}
            </span>
            <ChevronRight className="po-directional-icon" size={14} aria-hidden="true" />
          </div>
        )}
      </div>
    );
  };

  const renderDropZone = (group: MenuGroup, index: number, empty: boolean) => (
    <div
      className="desktop-create-new-drop-zone"
      data-active={dragTarget?.group === group && dragTarget.index === index || undefined}
      data-empty={empty || undefined}
      data-group={group}
      onDragOver={(event) => setDropTarget(event, group, index)}
      onDrop={(event) => completeDrop(event, { group, index })}
    >
      {empty && (
        <span>
          {group === "submenu"
            ? t("settings.createNew.submenu.empty")
            : t("settings.createNew.hidden.empty")}
        </span>
      )}
    </div>
  );

  return (
    <section className="desktop-utility-view desktop-settings-view">
      <div className="desktop-utility-body desktop-settings-body" data-po-scrollbar="content">
        <div className="desktop-settings-section desktop-create-new-settings">
          <SettingsSectionHeader
            title={t("settings.createNew.title")}
          />

          <div className="desktop-create-new-layout">
            <section className="desktop-create-new-editor">
              <header className="desktop-create-new-group-header">
                <span className="desktop-create-new-group-title">
                  {t("settings.createNew.location.main")}
                </span>
              </header>
              <div className="desktop-create-new-tree" role="list">
                <div className="desktop-create-new-row desktop-create-new-row-fixed" role="listitem">
                  <span className="desktop-create-new-fixed-marker" aria-hidden="true">
                    <LockKeyhole size={12} />
                  </span>
                  <CreateNewGlyph iconName="folder" iconType="folder" theme={fileIconTheme} />
                  <span className="desktop-create-new-row-label">
                    {t("workspace.node.create.kind.folder.label")}
                  </span>
                  <span className="desktop-create-new-fixed-label">
                    {t("settings.createNew.fixed")}
                  </span>
                </div>
                <div className="desktop-create-new-divider" aria-hidden="true" />
                {settings.main.map((entry, index) => (
                  entry === CREATE_NEW_SUBMENU_ID ? (
                    <div className="desktop-create-new-submenu-node" key={entry}>
                      {renderRow(entry, "main", index)}
                      <div
                        className="desktop-create-new-submenu-children"
                        data-drop-active={dragTarget?.group === "submenu" || undefined}
                        role="group"
                        aria-label={t("settings.createNew.submenu.title")}
                      >
                        {settings.submenu.map((kind, childIndex) => (
                          renderRow(kind, "submenu", childIndex)
                        ))}
                        {renderDropZone("submenu", settings.submenu.length, settings.submenu.length === 0)}
                      </div>
                    </div>
                  ) : renderRow(entry, "main", index)
                ))}
                {renderDropZone("main", settings.main.length, false)}
              </div>
            </section>

            <section className="desktop-create-new-hidden-section">
              <header className="desktop-create-new-group-header">
                <span className="desktop-create-new-group-title">
                  {t("settings.createNew.hidden.title")}
                </span>
              </header>
              <div
                className="desktop-create-new-hidden-list"
                data-drop-active={dragTarget?.group === "hidden" || undefined}
                role="list"
              >
                {settings.hidden.map((kind, index) => (
                  renderRow(kind, "hidden", index)
                ))}
                {renderDropZone("hidden", settings.hidden.length, settings.hidden.length === 0)}
              </div>
            </section>

            <footer className="desktop-create-new-footer">
              <button
                className="desktop-settings-action"
                type="button"
                disabled={defaultsRestored}
                onClick={() => onChange(cloneDefaultCreateNewMenuSettings())}
              >
                <RotateCcw size={13} aria-hidden="true" />
                <span>{t("settings.createNew.restoreDefaults")}</span>
              </button>
            </footer>
          </div>
        </div>
      </div>
    </section>
  );
}

function isCreateNewDraggableEntry(value: unknown): value is CreateNewDraggableEntry {
  return value === CREATE_NEW_SUBMENU_ID || isCreateNewItemId(value);
}

function getGroupEntries(
  settings: CreateNewMenuSettings,
  group: MenuGroup,
): readonly CreateNewDraggableEntry[] {
  if (group === "main") return settings.main;
  return settings[group];
}

function replaceGroup(
  settings: CreateNewMenuSettings,
  group: MenuGroup,
  entries: readonly CreateNewDraggableEntry[],
): CreateNewMenuSettings {
  if (group === "main") {
    return { ...settings, version: CREATE_NEW_MENU_VERSION, main: entries as CreateNewMainMenuEntry[] };
  }
  const itemEntries = entries.filter(isCreateNewItemId);
  return { ...settings, version: CREATE_NEW_MENU_VERSION, [group]: itemEntries };
}

function moveEntry(
  settings: CreateNewMenuSettings,
  entry: CreateNewDraggableEntry,
  targetGroup: MenuGroup,
  requestedIndex: number,
): CreateNewMenuSettings {
  if (entry === CREATE_NEW_SUBMENU_ID && targetGroup !== "main") return settings;

  const sourceGroup = (["main", "submenu", "hidden"] as const)
    .find((group) => getGroupEntries(settings, group).includes(entry));
  if (!sourceGroup) return settings;
  const sourceIndex = getGroupEntries(settings, sourceGroup).indexOf(entry);
  const withoutEntry = replaceGroup(
    settings,
    sourceGroup,
    getGroupEntries(settings, sourceGroup).filter((candidate) => candidate !== entry),
  );
  const targetEntries = [...getGroupEntries(withoutEntry, targetGroup)];
  const adjustedIndex = sourceGroup === targetGroup && sourceIndex < requestedIndex
    ? requestedIndex - 1
    : requestedIndex;
  targetEntries.splice(Math.max(0, Math.min(adjustedIndex, targetEntries.length)), 0, entry);
  return replaceGroup(withoutEntry, targetGroup, targetEntries);
}

function menuSettingsEqual(left: CreateNewMenuSettings, right: CreateNewMenuSettings): boolean {
  return groupsEqual(left.main, right.main)
    && groupsEqual(left.submenu, right.submenu)
    && groupsEqual(left.hidden, right.hidden);
}

function groupsEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

function CreateNewGlyph({
  iconName,
  iconType,
  theme,
  size = 18,
}: {
  iconName: string;
  iconType: DataNode["type"];
  theme: FileIconThemeId;
  size?: number;
}) {
  return (
    <span className="desktop-create-new-glyph" aria-hidden="true">
      <FileGlyphIcon
        name={iconName}
        type={iconType}
        size={size}
        theme={theme}
      />
    </span>
  );
}
