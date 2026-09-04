import { useEffect, useMemo, useRef, type CSSProperties } from "react";
import { dispatchTypographyChange } from "@puppyone/shared-ui";
import {
  BUILTIN_FONT_CATALOG,
  createCatalogFontFamily,
  resolveTypography,
  TYPOGRAPHY_SCALE_METRICS,
  type FontCatalogEntry,
  type ResolvedTypography,
  type TypographyPreferences,
} from "./fontCatalog";

type TypographyCustomProperties = CSSProperties & {
  "--po-font-ui-primary": string;
  "--po-font-content-primary": string;
  "--po-font-code-primary": string;
  "--po-font-terminal-primary": string;
  "--po-font-editor-content-user"?: string;
  "--po-user-left-sidebar-font-size": string;
  "--po-user-left-sidebar-meta-font-size": string;
  "--po-user-left-sidebar-line-height": string;
  "--po-user-header-font-size": string;
  "--po-user-header-line-height": string;
  "--po-user-header-meta-font-size": string;
  "--po-user-header-meta-line-height": string;
  "--po-user-text-size-content": string;
  "--po-user-editor-line-height": string;
  "--po-user-text-size-data": string;
  "--po-user-code-font-size": string;
  "--po-user-editor-heading-1-font-size": string;
  "--po-user-editor-heading-2-font-size": string;
  "--po-user-editor-heading-3-font-size": string;
  "--po-user-editor-heading-4-font-size": string;
  "--po-user-editor-heading-5-font-size": string;
  "--po-user-editor-heading-6-font-size": string;
  "--po-user-text-size-conversation": string;
  "--po-user-right-sidebar-control-line-height": string;
  "--po-user-right-sidebar-meta-font-size": string;
  "--po-user-right-sidebar-meta-line-height": string;
  "--po-user-right-sidebar-caption-font-size": string;
  "--po-user-right-sidebar-caption-line-height": string;
  "--po-user-right-sidebar-micro-font-size": string;
  "--po-user-right-sidebar-micro-line-height": string;
  "--po-user-right-sidebar-code-font-size": string;
  "--po-user-terminal-font-size": string;
  "--po-user-right-sidebar-heading-1-font-size": string;
  "--po-user-right-sidebar-heading-2-font-size": string;
};

export type TypographyRootProps = {
  "data-font-ui": string;
  "data-font-ui-category": FontCatalogEntry["category"];
  "data-font-content": string;
  "data-font-content-category": FontCatalogEntry["category"];
  "data-font-editor-content-mode": "follow-theme" | "explicit";
  "data-font-editor-content"?: string;
  "data-font-code": string;
  "data-font-code-category": FontCatalogEntry["category"];
  "data-font-terminal": string;
  "data-font-terminal-category": FontCatalogEntry["category"];
  "data-typography-left-sidebar-scale": ResolvedTypography["scales"]["leftSidebar"];
  "data-typography-header-scale": ResolvedTypography["scales"]["header"];
  "data-typography-editor-scale": ResolvedTypography["scales"]["editor"];
  "data-typography-right-sidebar-scale": ResolvedTypography["scales"]["rightSidebar"];
  style: TypographyCustomProperties;
};

export function useTypographyRuntime(
  preferences: TypographyPreferences,
  catalog: readonly FontCatalogEntry[] = BUILTIN_FONT_CATALOG,
  locale = "en",
) {
  const resolved = useMemo(
    () => resolveTypography(preferences, catalog),
    [catalog, preferences],
  );
  const sizeRevision = serializeTypographySizes(resolved);
  const generationRef = useRef(0);

  useEffect(() => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    let cancelled = false;
    let appliedFrame: number | null = requestAnimationFrame(() => {
      appliedFrame = null;
      if (!cancelled) dispatchTypographyChange(document, { generation, phase: "applied" });
    });

    const families = new Set([
      resolved.ui.family,
      resolved.content.family,
      resolved.code.family,
      resolved.terminal.family,
      resolved.editorContentOverride?.family,
    ]);
    const fontsReady = document.fonts
      ? Promise.allSettled([...families]
        .filter((family): family is string => Boolean(family))
        .map((family) => document.fonts.load(`16px ${family}`)))
        .then(() => document.fonts.ready)
      : Promise.resolve();
    void fontsReady.then(() => {
      if (cancelled) return;
      requestAnimationFrame(() => {
        if (!cancelled) dispatchTypographyChange(document, { generation, phase: "ready" });
      });
    });

    return () => {
      cancelled = true;
      if (appliedFrame !== null) cancelAnimationFrame(appliedFrame);
    };
  }, [
    resolved.code.family,
    resolved.code.category,
    resolved.code.id,
    resolved.content.family,
    resolved.content.category,
    resolved.content.id,
    resolved.editorContentOverride?.family,
    resolved.editorContentOverride?.category,
    resolved.editorContentOverride?.id,
    resolved.ui.family,
    resolved.ui.category,
    resolved.ui.id,
    resolved.terminal.family,
    resolved.terminal.category,
    resolved.terminal.id,
    sizeRevision,
    locale,
  ]);

  return resolved;
}

function serializeTypographySizes(resolved: ResolvedTypography): string {
  return [
    resolved.scales.leftSidebar,
    resolved.scales.header,
    resolved.scales.editor,
    resolved.scales.rightSidebar,
  ].join(",");
}

export function createTypographyRootProps(resolved: ResolvedTypography): TypographyRootProps {
  const metrics = resolveScaleMetrics(resolved);
  return {
    "data-font-ui": resolved.ui.id,
    "data-font-ui-category": resolved.ui.category,
    "data-font-content": resolved.content.id,
    "data-font-content-category": resolved.content.category,
    "data-font-editor-content-mode": resolved.editorContentOverride ? "explicit" : "follow-theme",
    ...(resolved.editorContentOverride
      ? { "data-font-editor-content": resolved.editorContentOverride.id }
      : {}),
    "data-font-code": resolved.code.id,
    "data-font-code-category": resolved.code.category,
    "data-font-terminal": resolved.terminal.id,
    "data-font-terminal-category": resolved.terminal.category,
    "data-typography-left-sidebar-scale": resolved.scales.leftSidebar,
    "data-typography-header-scale": resolved.scales.header,
    "data-typography-editor-scale": resolved.scales.editor,
    "data-typography-right-sidebar-scale": resolved.scales.rightSidebar,
    style: {
      "--po-font-ui-primary": resolved.ui.family,
      "--po-font-content-primary": resolved.content.family,
      "--po-font-code-primary": resolved.code.family,
      "--po-font-terminal-primary": resolved.terminal.family,
      ...(resolved.editorContentOverride
        ? { "--po-font-editor-content-user": createCatalogFontFamily(resolved.editorContentOverride) }
        : {}),
      "--po-user-left-sidebar-font-size": `${metrics.leftSidebar.content}px`,
      "--po-user-left-sidebar-meta-font-size": `${metrics.leftSidebar.meta}px`,
      "--po-user-left-sidebar-line-height": `${metrics.leftSidebar.lineHeight}px`,
      "--po-user-header-font-size": `${metrics.header.content}px`,
      "--po-user-header-line-height": `${metrics.header.lineHeight}px`,
      "--po-user-header-meta-font-size": `${metrics.header.meta}px`,
      "--po-user-header-meta-line-height": `${metrics.header.metaLineHeight}px`,
      "--po-user-text-size-content": `${metrics.editor.content}px`,
      "--po-user-editor-line-height": `${metrics.editor.lineHeight}px`,
      "--po-user-text-size-data": `${metrics.editor.data}px`,
      "--po-user-code-font-size": `${metrics.editor.code}px`,
      "--po-user-editor-heading-1-font-size": `${metrics.editor.heading1}px`,
      "--po-user-editor-heading-2-font-size": `${metrics.editor.heading2}px`,
      "--po-user-editor-heading-3-font-size": `${metrics.editor.heading3}px`,
      "--po-user-editor-heading-4-font-size": `${metrics.editor.heading4}px`,
      "--po-user-editor-heading-5-font-size": `${metrics.editor.heading5}px`,
      "--po-user-editor-heading-6-font-size": `${metrics.editor.heading6}px`,
      "--po-user-text-size-conversation": `${metrics.rightSidebar.content}px`,
      "--po-user-right-sidebar-control-line-height": `${metrics.rightSidebar.controlLineHeight}px`,
      "--po-user-right-sidebar-meta-font-size": `${metrics.rightSidebar.meta}px`,
      "--po-user-right-sidebar-meta-line-height": `${metrics.rightSidebar.metaLineHeight}px`,
      "--po-user-right-sidebar-caption-font-size": `${metrics.rightSidebar.caption}px`,
      "--po-user-right-sidebar-caption-line-height": `${metrics.rightSidebar.captionLineHeight}px`,
      "--po-user-right-sidebar-micro-font-size": `${metrics.rightSidebar.micro}px`,
      "--po-user-right-sidebar-micro-line-height": `${metrics.rightSidebar.microLineHeight}px`,
      "--po-user-right-sidebar-code-font-size": `${metrics.rightSidebar.code}px`,
      "--po-user-terminal-font-size": `${metrics.rightSidebar.terminal}px`,
      "--po-user-right-sidebar-heading-1-font-size": `${metrics.rightSidebar.heading1}px`,
      "--po-user-right-sidebar-heading-2-font-size": `${metrics.rightSidebar.heading2}px`,
    },
  };
}

export function applyTypographyToElement(element: HTMLElement, resolved: ResolvedTypography) {
  const metrics = resolveScaleMetrics(resolved);
  element.dataset.fontUi = resolved.ui.id;
  element.dataset.fontUiCategory = resolved.ui.category;
  element.dataset.fontContent = resolved.content.id;
  element.dataset.fontContentCategory = resolved.content.category;
  element.dataset.fontEditorContentMode = resolved.editorContentOverride ? "explicit" : "follow-theme";
  if (resolved.editorContentOverride) element.dataset.fontEditorContent = resolved.editorContentOverride.id;
  else delete element.dataset.fontEditorContent;
  element.dataset.fontCode = resolved.code.id;
  element.dataset.fontCodeCategory = resolved.code.category;
  element.dataset.fontTerminal = resolved.terminal.id;
  element.dataset.fontTerminalCategory = resolved.terminal.category;
  element.dataset.typographyLeftSidebarScale = resolved.scales.leftSidebar;
  element.dataset.typographyHeaderScale = resolved.scales.header;
  element.dataset.typographyEditorScale = resolved.scales.editor;
  element.dataset.typographyRightSidebarScale = resolved.scales.rightSidebar;
  delete element.dataset.textSizeContentMode;
  delete element.dataset.textSizeConversationMode;
  delete element.dataset.textSizeMonospaceMode;
  element.style.removeProperty("--po-font-ui");
  element.style.removeProperty("--po-font-content");
  element.style.removeProperty("--po-font-code");
  element.style.removeProperty("--po-font-terminal");
  element.style.removeProperty("--po-font-editor-content-user");
  element.style.removeProperty("--po-user-left-sidebar-font-size");
  element.style.removeProperty("--po-user-left-sidebar-meta-font-size");
  element.style.removeProperty("--po-user-left-sidebar-line-height");
  element.style.removeProperty("--po-user-header-font-size");
  element.style.removeProperty("--po-user-header-line-height");
  element.style.removeProperty("--po-user-header-meta-font-size");
  element.style.removeProperty("--po-user-header-meta-line-height");
  element.style.removeProperty("--po-user-text-size-content");
  element.style.removeProperty("--po-user-editor-line-height");
  element.style.removeProperty("--po-user-text-size-data");
  element.style.removeProperty("--po-user-text-size-conversation");
  element.style.removeProperty("--po-user-right-sidebar-control-line-height");
  element.style.removeProperty("--po-user-right-sidebar-meta-font-size");
  element.style.removeProperty("--po-user-right-sidebar-meta-line-height");
  element.style.removeProperty("--po-user-right-sidebar-caption-font-size");
  element.style.removeProperty("--po-user-right-sidebar-caption-line-height");
  element.style.removeProperty("--po-user-right-sidebar-micro-font-size");
  element.style.removeProperty("--po-user-right-sidebar-micro-line-height");
  element.style.removeProperty("--po-user-right-sidebar-code-font-size");
  element.style.removeProperty("--po-user-code-font-size");
  element.style.removeProperty("--po-user-terminal-font-size");
  element.style.removeProperty("--po-user-editor-heading-1-font-size");
  element.style.removeProperty("--po-user-editor-heading-2-font-size");
  element.style.removeProperty("--po-user-editor-heading-3-font-size");
  element.style.removeProperty("--po-user-editor-heading-4-font-size");
  element.style.removeProperty("--po-user-editor-heading-5-font-size");
  element.style.removeProperty("--po-user-editor-heading-6-font-size");
  element.style.removeProperty("--po-user-right-sidebar-heading-1-font-size");
  element.style.removeProperty("--po-user-right-sidebar-heading-2-font-size");
  element.style.setProperty("--po-font-ui-primary", resolved.ui.family);
  element.style.setProperty("--po-font-content-primary", resolved.content.family);
  element.style.setProperty("--po-font-code-primary", resolved.code.family);
  element.style.setProperty("--po-font-terminal-primary", resolved.terminal.family);
  if (resolved.editorContentOverride) {
    element.style.setProperty(
      "--po-font-editor-content-user",
      createCatalogFontFamily(resolved.editorContentOverride),
    );
  }
  element.style.setProperty("--po-user-left-sidebar-font-size", `${metrics.leftSidebar.content}px`);
  element.style.setProperty("--po-user-left-sidebar-meta-font-size", `${metrics.leftSidebar.meta}px`);
  element.style.setProperty("--po-user-left-sidebar-line-height", `${metrics.leftSidebar.lineHeight}px`);
  element.style.setProperty("--po-user-header-font-size", `${metrics.header.content}px`);
  element.style.setProperty("--po-user-header-line-height", `${metrics.header.lineHeight}px`);
  element.style.setProperty("--po-user-header-meta-font-size", `${metrics.header.meta}px`);
  element.style.setProperty("--po-user-header-meta-line-height", `${metrics.header.metaLineHeight}px`);
  element.style.setProperty("--po-user-text-size-content", `${metrics.editor.content}px`);
  element.style.setProperty("--po-user-editor-line-height", `${metrics.editor.lineHeight}px`);
  element.style.setProperty("--po-user-text-size-data", `${metrics.editor.data}px`);
  element.style.setProperty("--po-user-code-font-size", `${metrics.editor.code}px`);
  element.style.setProperty("--po-user-editor-heading-1-font-size", `${metrics.editor.heading1}px`);
  element.style.setProperty("--po-user-editor-heading-2-font-size", `${metrics.editor.heading2}px`);
  element.style.setProperty("--po-user-editor-heading-3-font-size", `${metrics.editor.heading3}px`);
  element.style.setProperty("--po-user-editor-heading-4-font-size", `${metrics.editor.heading4}px`);
  element.style.setProperty("--po-user-editor-heading-5-font-size", `${metrics.editor.heading5}px`);
  element.style.setProperty("--po-user-editor-heading-6-font-size", `${metrics.editor.heading6}px`);
  element.style.setProperty("--po-user-text-size-conversation", `${metrics.rightSidebar.content}px`);
  element.style.setProperty("--po-user-right-sidebar-control-line-height", `${metrics.rightSidebar.controlLineHeight}px`);
  element.style.setProperty("--po-user-right-sidebar-meta-font-size", `${metrics.rightSidebar.meta}px`);
  element.style.setProperty("--po-user-right-sidebar-meta-line-height", `${metrics.rightSidebar.metaLineHeight}px`);
  element.style.setProperty("--po-user-right-sidebar-caption-font-size", `${metrics.rightSidebar.caption}px`);
  element.style.setProperty("--po-user-right-sidebar-caption-line-height", `${metrics.rightSidebar.captionLineHeight}px`);
  element.style.setProperty("--po-user-right-sidebar-micro-font-size", `${metrics.rightSidebar.micro}px`);
  element.style.setProperty("--po-user-right-sidebar-micro-line-height", `${metrics.rightSidebar.microLineHeight}px`);
  element.style.setProperty("--po-user-right-sidebar-code-font-size", `${metrics.rightSidebar.code}px`);
  element.style.setProperty("--po-user-terminal-font-size", `${metrics.rightSidebar.terminal}px`);
  element.style.setProperty("--po-user-right-sidebar-heading-1-font-size", `${metrics.rightSidebar.heading1}px`);
  element.style.setProperty("--po-user-right-sidebar-heading-2-font-size", `${metrics.rightSidebar.heading2}px`);
}

function resolveScaleMetrics(resolved: ResolvedTypography) {
  return {
    leftSidebar: TYPOGRAPHY_SCALE_METRICS[resolved.scales.leftSidebar].leftSidebar,
    header: TYPOGRAPHY_SCALE_METRICS[resolved.scales.header].header,
    editor: TYPOGRAPHY_SCALE_METRICS[resolved.scales.editor].editor,
    rightSidebar: TYPOGRAPHY_SCALE_METRICS[resolved.scales.rightSidebar].rightSidebar,
  };
}
