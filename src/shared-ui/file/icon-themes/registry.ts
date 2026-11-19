import type {
  FileIconThemeId,
  FileIconThemeMetadata,
} from "../fileIconTypes";
import { defaultTheme } from "./default";
import type { FileIconThemeDefinition } from "./iconThemeTypes";

/**
 * The plug-in point for file-icon themes. To add a theme: build it in its own
 * folder with `createIconTheme`, `createCustomPreviewIconTheme` or
 * `createThemeVariant`, add its id to `FileIconThemeId`, and list it here.
 * Appearance settings offer a choice only once more than one theme exists.
 */
const FILE_ICON_THEME_ORDER: readonly FileIconThemeId[] = [
  "default",
];

export const FILE_ICON_THEME_REGISTRY = {
  default: defaultTheme,
} satisfies Record<FileIconThemeId, FileIconThemeDefinition>;

export const FILE_ICON_THEMES = FILE_ICON_THEME_ORDER.map(
  (id) => getThemeMetadata(FILE_ICON_THEME_REGISTRY[id]),
) as readonly FileIconThemeMetadata[];

const FILE_ICON_THEME_IDS = new Set<string>(FILE_ICON_THEME_ORDER);

/**
 * Ids that were once installed. Saved preferences naming them migrate here
 * instead of failing, so retiring a theme never strands a user's setting.
 */
const RETIRED_FILE_ICON_THEME_IDS: Readonly<Record<string, FileIconThemeId>> = Object.freeze({
  vscode: "default",
  lines: "default",
  semantic: "default",
  material: "default",
  minimal: "default",
});

export function isFileIconThemeId(
  value: string | null | undefined,
): value is FileIconThemeId {
  return typeof value === "string" && FILE_ICON_THEME_IDS.has(value);
}

export function parseFileIconThemeId(
  value: string | null | undefined,
): FileIconThemeId | null {
  if (isFileIconThemeId(value)) return value;
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(RETIRED_FILE_ICON_THEME_IDS, value)
    ? RETIRED_FILE_ICON_THEME_IDS[value]
    : null;
}

export function getFileIconThemeDefinition(
  theme?: FileIconThemeId | null,
): FileIconThemeDefinition {
  return isFileIconThemeId(theme)
    ? FILE_ICON_THEME_REGISTRY[theme]
    : FILE_ICON_THEME_REGISTRY.default;
}

function getThemeMetadata(
  theme: FileIconThemeDefinition,
): FileIconThemeMetadata {
  return { id: theme.id };
}
