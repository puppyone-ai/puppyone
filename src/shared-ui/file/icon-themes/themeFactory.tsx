import type { FileIconThemeMetadata, FileVisualKind } from "../fileIconTypes";
import type {
  FileIconPreviewContext,
  FileIconRenderContext,
  FileIconRenderer,
  FileIconRendererMap,
  FileIconThemeDefinition,
} from "./iconThemeTypes";
import { renderIconThemePreview } from "./shared/PreviewShell";

export function createThemeVariant({
  id,
  base,
  glyphOverrides = {},
  previewOverrides = {},
}: FileIconThemeMetadata & {
  base: FileIconThemeDefinition;
  glyphOverrides?: Partial<Record<FileVisualKind, FileIconRenderer<FileIconRenderContext>>>;
  previewOverrides?: Partial<Record<FileVisualKind, FileIconRenderer<FileIconPreviewContext>>>;
}): FileIconThemeDefinition {
  return {
    id,
    renderGlyph: (context) => (glyphOverrides[context.kind] ?? base.renderGlyph)(context),
    renderPreview: (context) => (previewOverrides[context.kind] ?? base.renderPreview)(context),
  };
}

export function createIconTheme({
  id,
  glyphRenderers,
  renderFolderPreviewGlyph,
}: FileIconThemeMetadata & {
  glyphRenderers: FileIconRendererMap<FileIconRenderContext>;
  renderFolderPreviewGlyph: FileIconRenderer<FileIconRenderContext>;
}): FileIconThemeDefinition {
  const renderGlyph = createGlyphRenderer(glyphRenderers);

  return {
    id,
    renderGlyph,
    renderPreview: (context) => (
      renderIconThemePreview(context, renderGlyph, renderFolderPreviewGlyph)
    ),
  };
}

export function createCustomPreviewIconTheme({
  id,
  glyphRenderers,
  renderPreview,
}: FileIconThemeMetadata & {
  glyphRenderers: FileIconRendererMap<FileIconRenderContext>;
  renderPreview: FileIconRenderer<FileIconPreviewContext>;
}): FileIconThemeDefinition {
  return {
    id,
    renderGlyph: createGlyphRenderer(glyphRenderers),
    renderPreview,
  };
}

function createGlyphRenderer(
  renderers: FileIconRendererMap<FileIconRenderContext>,
): FileIconRenderer<FileIconRenderContext> {
  return (context) => renderers[context.kind](context);
}
