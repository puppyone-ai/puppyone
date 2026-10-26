import { createPortal } from "react-dom";
import type { CSSProperties, ReactElement } from "react";
import { getSubThemeVariant, type SubThemeColorMode, type SubThemeDefinition } from "./themeTypes";
import {
  resolveMarkdownPresentationStyle,
  type MarkdownPresentationSettings,
} from "../markdown/markdownPresentation";

export function SubThemeStyleHost({
  subTheme,
  colorMode,
  markdownPresentation,
}: {
  subTheme: SubThemeDefinition;
  colorMode: SubThemeColorMode;
  markdownPresentation: MarkdownPresentationSettings;
}) {
  if (typeof document === "undefined") return null;
  const variant = getSubThemeVariant(subTheme, colorMode);
  if (!variant) return null;
  const styles: ReactElement[] = Object.entries(variant.compiledCss).flatMap(([target, css]) => {
    if (!css) return [];
    return (
      <style
        key={`${subTheme.id}:${colorMode}:${target}`}
        data-po-sub-theme-style={`${subTheme.id}:${colorMode}:${target}`}
        data-po-sub-theme-id={subTheme.id}
        data-po-sub-theme-mode={colorMode}
        data-po-sub-theme-target={target}
        data-po-theme-layer="sub-theme"
      >
        {wrapLayer("sub-theme", css)}
      </style>
    );
  });

  const overrideCss = createMarkdownPresentationCss(markdownPresentation);
  if (overrideCss) {
    styles.push(
      <style
        key="markdown-presentation"
        data-po-sub-theme-style="markdown-presentation"
        data-po-sub-theme-target="markdown"
        data-po-theme-layer="appearance-overrides"
      >
        {wrapLayer("appearance-overrides", overrideCss)}
      </style>,
    );
  }

  return createPortal(styles, document.head);
}

function createMarkdownPresentationCss(settings: MarkdownPresentationSettings): string {
  const declarations = Object.entries(resolveMarkdownPresentationStyle(settings) as CSSProperties)
    .filter((entry): entry is [string, string | number] => (
      typeof entry[1] === "string" || typeof entry[1] === "number"
    ))
    .map(([property, value]) => `  ${property.replace("--po-md-", "--po-user-md-")}: ${String(value)};`);
  if (declarations.length === 0) return "";
  return [
    "@scope ([data-po-appearance-root][data-sub-theme-id]) to ([data-po-appearance-root]) {",
    "  .markdown-codemirror-editor {",
    ...declarations.map(declaration => `  ${declaration}`),
    "  }",
    "}",
  ].join("\n");
}

function wrapLayer(layer: "sub-theme" | "appearance-overrides", css: string): string {
  return `@layer ${layer} {\n${css}\n}`;
}
