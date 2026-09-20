import type {
  FileIconThemeId,
  FileIconThemeMetadata,
} from "../fileIconTypes";
import { defaultTheme } from "./default";
import type { FileIconThemeDefinition } from "./iconThemeTypes";
import { linesTheme } from "./lines";
import { materialTheme } from "./material";
import { minimalTheme } from "./minimal";
import { semanticTheme } from "./semantic";

const FILE_ICON_THEME_ORDER: readonly FileIconThemeId[] = [
  "default",
  "lines",
  "semantic",
  "material",
  "minimal",
];

export const FILE_ICON_THEME_REGISTRY = {
  default: defaultTheme,
  lines: linesTheme,
  semantic: semanticTheme,
  material: materialTheme,
  minimal: minimalTheme,
} satisfies Record<FileIconThemeId, FileIconThemeDefinition>;

export const FILE_ICON_THEMES = FILE_ICON_THEME_ORDER.map(
  (id) => getThemeMetadata(FILE_ICON_THEME_REGISTRY[id]),
) as readonly FileIconThemeMetadata[];

const FILE_ICON_THEME_IDS = new Set<string>(FILE_ICON_THEME_ORDER);
const LEGACY_FILE_ICON_THEME_ALIASES: Readonly<Record<string, FileIconThemeId>> = Object.freeze({
  vscode: "semantic",
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
  return typeof value === "string"
    ? LEGACY_FILE_ICON_THEME_ALIASES[value] ?? null
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
