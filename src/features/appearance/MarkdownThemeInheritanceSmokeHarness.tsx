import { useMemo, useState, type CSSProperties } from "react";
import {
  EditorAppearanceProvider,
  FilePreview,
  type DocumentDataNode,
} from "@puppyone/shared-ui";
import { DEFAULT_MARKDOWN_PRESENTATION_SETTINGS } from "../markdown/markdownPresentation";
import {
  BUILTIN_FONT_IDS,
  DEFAULT_TYPOGRAPHY_PREFERENCES,
  createTypographyRootProps,
  resolveTypography,
} from "../typography";
import { BUILTIN_SUB_THEMES } from "../themes/builtinSubThemes";
import { SubThemeStyleHost } from "../themes/SubThemeStyleHost";

const DOCUMENT: DocumentDataNode = Object.freeze({
  id: "markdown-theme-inheritance-smoke.md",
  name: "markdown-theme-inheritance-smoke.md",
  path: "markdown-theme-inheritance-smoke.md",
  type: "markdown",
});

const CONTENT = [
  "# Newspaper inheritance",
  "",
  "主题字体必须穿过真实的文档宿主并到达 Markdown 编辑器。",
].join("\n");

/** Chromium integration fixture for the Sub Theme -> host token -> real
 * CodeMirror cascade. Unit DOM emulators do not implement this CSS contract. */
export function MarkdownThemeInheritanceSmokeHarness() {
  const params = new URLSearchParams(window.location.search);
  const explicitSystemFont = params.get("font") === "system";
  const [subThemeId, setSubThemeId] = useState("default.neutral");
  const subTheme = BUILTIN_SUB_THEMES.find((candidate) => candidate.id === subThemeId);
  if (!subTheme) throw new Error(`Missing smoke Sub Theme: ${subThemeId}`);

  const typographyPreferences = useMemo(() => explicitSystemFont
    ? Object.freeze({
        ...DEFAULT_TYPOGRAPHY_PREFERENCES,
        contentFont: { mode: "explicit" as const, fontId: BUILTIN_FONT_IDS.systemSans },
      })
    : DEFAULT_TYPOGRAPHY_PREFERENCES, [explicitSystemFont]);
  const typography = useMemo(
    () => resolveTypography(typographyPreferences),
    [typographyPreferences],
  );
  const typographyRootProps = useMemo(
    () => createTypographyRootProps(typography),
    [typography],
  );
  const rootStyle = {
    ...typographyRootProps.style,
    width: "900px",
    height: "620px",
  } as CSSProperties;

  return (
    <EditorAppearanceProvider revision={`smoke:${subThemeId}`}>
      <SubThemeStyleHost
        subTheme={subTheme}
        colorMode="light"
        markdownPresentation={DEFAULT_MARKDOWN_PRESENTATION_SETTINGS}
      />
      <button
        hidden
        type="button"
        data-smoke-select-newspaper="true"
        onClick={() => setSubThemeId("default.newspaper")}
      />
      <main
        className="app-shell"
        data-po-appearance-root="true"
        data-root-theme-id="default"
        data-sub-theme-id={subThemeId}
        {...typographyRootProps}
        style={rootStyle}
      >
        <FilePreview
          node={DOCUMENT}
          fileContent={{
            path: DOCUMENT.path,
            name: DOCUMENT.name,
            type: "markdown",
            content: CONTENT,
          }}
          showHeader={false}
          hideSourceView
        />
      </main>
    </EditorAppearanceProvider>
  );
}
