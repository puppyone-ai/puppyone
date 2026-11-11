import type { DataNode } from "@puppyone/shared-ui";

export const CREATE_NEW_ITEM_IDS = [
  "markdown",
  "contextMap",
  "text",
  "json",
  "csv",
  "html",
  "whiteboard",
  "slides",
  "app",
  "puppyflow",
] as const;
export type CreateNewItemId = typeof CREATE_NEW_ITEM_IDS[number];
export const CREATE_NEW_SUBMENU_ID = "customFiles" as const;
export type CreateNewSubmenuId = typeof CREATE_NEW_SUBMENU_ID;
export type CreateNewMainMenuEntry = CreateNewItemId | CreateNewSubmenuId;

export type CreateEntryMenuItemKind = "folder" | CreateNewItemId;
export type CreateNewMenuPlacement = "main" | "submenu" | "hidden";

export type CreateEntryMenuItemDefinition = Readonly<{
  kind: CreateEntryMenuItemKind;
  defaultPlacement: Exclude<CreateNewMenuPlacement, "hidden">;
  order: number;
  defaultEnabled: boolean;
  experimentalSetting?: "enablePuppyFlowFiles";
  extension: string;
  iconName: string;
  iconType: DataNode["type"];
}>;

const CREATE_ENTRY_MENU_ITEM_REGISTRY = {
  folder: {
    kind: "folder",
    defaultPlacement: "main",
    order: 0,
    defaultEnabled: true,
    extension: "",
    iconName: "folder",
    iconType: "folder",
  },
  markdown: {
    kind: "markdown",
    defaultPlacement: "main",
    order: 10,
    defaultEnabled: true,
    extension: ".md",
    iconName: "Untitled.md",
    iconType: "markdown",
  },
  csv: {
    kind: "csv",
    defaultPlacement: "main",
    order: 20,
    defaultEnabled: true,
    extension: ".csv",
    iconName: "Untitled.csv",
    iconType: "spreadsheet",
  },
  html: {
    kind: "html",
    defaultPlacement: "main",
    order: 30,
    defaultEnabled: true,
    extension: ".html",
    iconName: "Untitled.html",
    iconType: "html",
  },
  whiteboard: {
    kind: "whiteboard",
    defaultPlacement: "main",
    order: 40,
    defaultEnabled: true,
    extension: ".excalidraw",
    iconName: "Untitled.excalidraw",
    iconType: "whiteboard",
  },
  contextMap: {
    kind: "contextMap",
    defaultPlacement: "submenu",
    order: 10,
    defaultEnabled: true,
    extension: ".contextmap",
    iconName: "Untitled.contextmap",
    iconType: "context-map",
  },
  text: {
    kind: "text",
    defaultPlacement: "submenu",
    order: 20,
    defaultEnabled: false,
    extension: ".txt",
    iconName: "Untitled.txt",
    iconType: "text",
  },
  json: {
    kind: "json",
    defaultPlacement: "submenu",
    order: 30,
    defaultEnabled: false,
    extension: ".json",
    iconName: "Untitled.json",
    iconType: "json",
  },
  slides: {
    kind: "slides",
    defaultPlacement: "submenu",
    order: 40,
    defaultEnabled: false,
    extension: ".puppyoneapp",
    iconName: "Untitled Slides.puppyoneapp",
    iconType: "app",
  },
  app: {
    kind: "app",
    defaultPlacement: "submenu",
    order: 50,
    defaultEnabled: false,
    extension: ".puppyoneapp",
    iconName: "Untitled.puppyoneapp",
    iconType: "app",
  },
  puppyflow: {
    kind: "puppyflow",
    defaultPlacement: "submenu",
    order: 60,
    defaultEnabled: false,
    experimentalSetting: "enablePuppyFlowFiles",
    extension: ".puppyflow",
    iconName: "Untitled.puppyflow",
    iconType: "workflow",
  },
} as const satisfies Record<CreateEntryMenuItemKind, CreateEntryMenuItemDefinition>;

export function getCreateEntryMenuItem(
  kind: CreateEntryMenuItemKind,
): CreateEntryMenuItemDefinition {
  return CREATE_ENTRY_MENU_ITEM_REGISTRY[kind];
}

export function getDefaultCreateNewMenuLayout(): Readonly<{
  main: CreateNewMainMenuEntry[];
  submenu: CreateNewItemId[];
  hidden: CreateNewItemId[];
}> {
  const definitions = CREATE_NEW_ITEM_IDS
    .map((kind) => CREATE_ENTRY_MENU_ITEM_REGISTRY[kind])
    .sort((left, right) => {
      if (left.defaultPlacement !== right.defaultPlacement) {
        return left.defaultPlacement === "main" ? -1 : 1;
      }
      return left.order - right.order;
    });
  return {
    main: [
      ...definitions
        .filter((item) => item.defaultEnabled && item.defaultPlacement === "main")
        .map((item) => item.kind),
      CREATE_NEW_SUBMENU_ID,
    ],
    submenu: definitions
      .filter((item) => item.defaultEnabled && item.defaultPlacement === "submenu")
      .map((item) => item.kind),
    hidden: definitions
      .filter((item) => !item.defaultEnabled)
      .map((item) => item.kind),
  };
}

export function getConfiguredCreateEntryMenuItems(
  kinds: readonly CreateNewItemId[],
): CreateEntryMenuItemDefinition[] {
  return kinds.map((kind) => getCreateEntryMenuItem(kind));
}
