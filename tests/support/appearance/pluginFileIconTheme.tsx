import type { ReactNode } from "react";
import { FILE_VISUAL_KINDS, type FileIconThemeId } from "../../../packages/shared-ui/src/file/fileIconTypes";
import type {
  FileIconRenderContext,
  FileIconRendererMap,
} from "../../../packages/shared-ui/src/file/icon-themes/iconThemeTypes";
import { createIconTheme } from "../../../packages/shared-ui/src/file/icon-themes/themeFactory";
import type * as Registry from "../../../packages/shared-ui/src/file/icon-themes/registry";

/**
 * A file-icon theme no build ships. Tests install it through the plug-in
 * contract (a theme factory plus the registry) to prove that a second theme
 * reaches every consumer without parent props.
 */
export const PLUGIN_FILE_ICON_THEME_ID = "test-plugin" as unknown as FileIconThemeId;

function renderPluginGlyph({ kind, size }: FileIconRenderContext): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden data-plugin-file-icon={kind}>
      <rect x="2.5" y="2.5" width="11" height="11" rx="2" fill="none" stroke="currentColor" />
    </svg>
  );
}

export const pluginFileIconTheme = createIconTheme({
  id: PLUGIN_FILE_ICON_THEME_ID,
  glyphRenderers: Object.fromEntries(
    FILE_VISUAL_KINDS.map((kind) => [kind, renderPluginGlyph]),
  ) as FileIconRendererMap<FileIconRenderContext>,
  renderFolderPreviewGlyph: renderPluginGlyph,
});

/** The real registry with the test plug-in theme installed; use inside `vi.mock`. */
export function withPluginFileIconTheme(registry: typeof Registry): typeof Registry {
  const installed = (value: string | null | undefined) => value === PLUGIN_FILE_ICON_THEME_ID;
  return {
    ...registry,
    FILE_ICON_THEMES: [...registry.FILE_ICON_THEMES, { id: PLUGIN_FILE_ICON_THEME_ID }],
    isFileIconThemeId: ((value) => installed(value) || registry.isFileIconThemeId(value)) as typeof registry.isFileIconThemeId,
    parseFileIconThemeId: (value) => (installed(value) ? PLUGIN_FILE_ICON_THEME_ID : registry.parseFileIconThemeId(value)),
    getFileIconThemeDefinition: (theme) => (
      installed(theme) ? pluginFileIconTheme : registry.getFileIconThemeDefinition(theme)
    ),
  };
}
