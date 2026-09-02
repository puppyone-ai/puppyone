import { useEffect, useMemo, useRef, type CSSProperties } from "react";
import { dispatchTypographyChange } from "@puppyone/shared-ui";
import {
  BUILTIN_FONT_CATALOG,
  createCatalogFontFamily,
  resolveTypography,
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
    locale,
  ]);

  return resolved;
}

export function createTypographyRootProps(resolved: ResolvedTypography): TypographyRootProps {
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
    style: {
      "--po-font-ui-primary": resolved.ui.family,
      "--po-font-content-primary": resolved.content.family,
      "--po-font-code-primary": resolved.code.family,
      "--po-font-terminal-primary": resolved.terminal.family,
      ...(resolved.editorContentOverride
        ? { "--po-font-editor-content-user": createCatalogFontFamily(resolved.editorContentOverride) }
        : {}),
    },
  };
}

export function applyTypographyToElement(element: HTMLElement, resolved: ResolvedTypography) {
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
  element.style.removeProperty("--po-font-ui");
  element.style.removeProperty("--po-font-content");
  element.style.removeProperty("--po-font-code");
  element.style.removeProperty("--po-font-terminal");
  element.style.removeProperty("--po-font-editor-content-user");
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
}
