import type { ReactNode } from "react";
import type {
  FileIconThemeMetadata,
  FileVisualKind,
} from "../fileIconTypes";

export type FileIconRenderContext = {
  kind: FileVisualKind;
  name: string;
  type?: string | null;
  label: string;
  size: number;
  color: string;
};

export type FileIconPreviewContext = FileIconRenderContext & {
  snippet?: string | null;
  childrenCount?: number | null;
};

export type FileIconRenderer<TContext extends FileIconRenderContext> = (
  context: TContext,
) => ReactNode;

/**
 * Base themes must account for every semantic kind. Multiple keys may
 * intentionally share a renderer, but none may disappear into a fallback.
 */
export type FileIconRendererMap<TContext extends FileIconRenderContext> =
  Readonly<Record<FileVisualKind, FileIconRenderer<TContext>>>;

export type FileIconThemeDefinition = FileIconThemeMetadata & {
  renderGlyph: FileIconRenderer<FileIconRenderContext>;
  renderPreview: FileIconRenderer<FileIconPreviewContext>;
};
