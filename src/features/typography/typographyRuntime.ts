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
  [name: `--po-${string}`]: string | undefined;
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
  "data-typography-scale": ResolvedTypography["scale"];
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
  return resolved.scale;
}

export function createTypographyRootProps(resolved: ResolvedTypography): TypographyRootProps {
  return {
    ...buildTypographyDataAttributes(resolved),
    style: buildTypographyCustomProperties(resolved),
  };
}

/** The only runtime projection from the typed scale profile to CSS. App roots,
 * portals, visual fixtures, and independently mounted surfaces all consume
 * this same map so their typography cannot drift. */
export function buildTypographyCustomProperties(
  resolved: ResolvedTypography,
): TypographyCustomProperties {
  const metrics = resolveScaleMetrics(resolved);
  return {
    "--po-control-size": `${metrics.geometry.controlSize}px`,
    "--po-font-ui-primary": resolved.ui.family,
    "--po-font-content-primary": resolved.content.family,
    "--po-font-code-primary": resolved.code.family,
    "--po-font-terminal-primary": resolved.terminal.family,
    ...(resolved.editorContentOverride
      ? { "--po-font-editor-content-user": createCatalogFontFamily(resolved.editorContentOverride) }
      : {}),
    "--po-user-ui-glyph-font-size": `${metrics.ui.glyph}px`,
    "--po-user-ui-micro-font-size": `${metrics.ui.micro}px`,
    "--po-user-ui-caption-font-size": `${metrics.ui.caption}px`,
    "--po-user-ui-hint-font-size": `${metrics.ui.hint}px`,
    "--po-user-ui-meta-font-size": `${metrics.ui.meta}px`,
    "--po-user-ui-label-font-size": `${metrics.ui.label}px`,
    "--po-user-ui-control-font-size": `${metrics.ui.control}px`,
    "--po-user-ui-body-font-size": `${metrics.ui.body}px`,
    "--po-user-ui-body-large-font-size": `${metrics.ui.bodyLarge}px`,
    "--po-user-ui-section-title-font-size": `${metrics.ui.sectionTitle}px`,
    "--po-user-ui-title-font-size": `${metrics.ui.title}px`,
    "--po-user-ui-heading-font-size": `${metrics.ui.heading}px`,
    "--po-user-ui-page-title-font-size": `${metrics.ui.pageTitle}px`,
    "--po-user-ui-display-font-size": `${metrics.ui.display}px`,
    "--po-user-ui-hero-font-size": `${metrics.ui.hero}px`,
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
  };
}

function buildTypographyDataAttributes(
  resolved: ResolvedTypography,
): Omit<TypographyRootProps, "style"> {
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
    "data-typography-scale": resolved.scale,
  };
}

export function applyTypographyToElement(element: HTMLElement, resolved: ResolvedTypography) {
  const props = createTypographyRootProps(resolved);

  for (const attribute of [...element.attributes]) {
    if (isTypographyAttribute(attribute.name)) element.removeAttribute(attribute.name);
  }
  for (const [name, value] of Object.entries(props)) {
    if (name !== "style" && value !== undefined) element.setAttribute(name, String(value));
  }

  const existingStyleProperties = Array.from(
    { length: element.style.length },
    (_, index) => element.style.item(index),
  );
  for (const name of existingStyleProperties) {
    if (isTypographyCustomProperty(name)) element.style.removeProperty(name);
  }
  for (const [name, value] of Object.entries(props.style)) {
    if (value !== undefined && value !== null) element.style.setProperty(name, String(value));
  }
}

function isTypographyAttribute(name: string): boolean {
  return name === "data-content-text-size"
    || name.startsWith("data-font-")
    || name.startsWith("data-typography-")
    || name.startsWith("data-text-size-");
}

function isTypographyCustomProperty(name: string): boolean {
  return name === "--po-control-size"
    || name === "--po-font-editor-content-user"
    || /^--po-font-(?:ui|content|code|terminal)(?:-primary)?$/.test(name)
    || name.startsWith("--po-user-");
}

function resolveScaleMetrics(resolved: ResolvedTypography) {
  const metrics = TYPOGRAPHY_SCALE_METRICS[resolved.scale];
  return {
    geometry: metrics.geometry,
    ui: metrics.ui,
    leftSidebar: metrics.leftSidebar,
    header: metrics.header,
    editor: metrics.editor,
    rightSidebar: metrics.rightSidebar,
  };
}
