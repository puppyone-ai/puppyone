import "../../../../src/styles/cascade.css";
import "../../../../src/styles.css";
import { useLayoutEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { TestLocalizationProvider } from "@puppyone/localization/testing";
import englishCatalog from "../../../../src/localization/catalog-loaders/en";
import chineseCatalog from "../../../../src/localization/catalog-loaders/zh-Hans";
import { initializeDesktopPreferences } from "../../../../src/preferencesStore";
import { ExplorerTree, type DataNode } from "@puppyone/shared-ui";
import { AgentChangedFileMark, agentChangedFilesStore } from "../../../../src/features/desktop-agent-presence";
import { resolveAppearance } from "../../../../src/features/appearance/resolveAppearance";
import { applySurfaceAppearanceToElement, resolveSurfaceAppearance, SurfaceAppearanceProvider } from "../../../../src/features/appearance/AppearanceRuntime";
import { createSubThemeCatalogSnapshot } from "../../../../src/features/themes/builtinSubThemes";
import { DEFAULT_TYPOGRAPHY_PREFERENCES, resolveTypography } from "../../../../src/features/typography";
import { DEFAULT_MARKDOWN_PRESENTATION_SETTINGS } from "../../../../src/features/markdown/markdownPresentation";


initializeDesktopPreferences({ getItem: () => null, setItem: () => {}, removeItem: () => {} });
const parameters = new URLSearchParams(location.search);
const themeMode = parameters.get("theme") === "dark" ? "dark" : "light";
function Harness() {
  const [catalog] = useState(() => createSubThemeCatalogSnapshot({ themes: [], diagnostics: [] }));
  const appearance = resolveAppearance({ interfaceStyle: "default", themeMode,
    requestedSubThemeIds: { light: "default.neutral", dark: "default.dark" }, subThemeCatalog: catalog,
    sidebarNavigationLayout: "bottom-horizontal", fileIconTheme: "default" });
  const surface = resolveSurfaceAppearance({ appearance, typography: resolveTypography(DEFAULT_TYPOGRAPHY_PREFERENCES),
    markdownPresentation: DEFAULT_MARKDOWN_PRESENTATION_SETTINGS, lightThemePreset: "neutral", darkThemePreset: "default",
    pointerCursors: false, diffMarkers: "color" });
  useLayoutEffect(() => applySurfaceAppearanceToElement(document.documentElement, surface), [surface]);
  const chinese = parameters.get("lang") === "zh-Hans";
  const [selected, setSelected] = useState<string | null>(null);
  const nodes: DataNode[] = [
    {id:"src",name:"src",path:"src",type:"folder",children:[
      {id:"changed",name:"updated-document.md",path:"src/updated-document.md",type:"file"},
      {id:"read",name:"read-only.md",path:"src/read-only.md",type:"file"},
    ]},
    {id:"added",name:"new-document.md",path:"new-document.md",type:"file"},
  ];
  useLayoutEffect(() => { agentChangedFilesStore.mark("/workspace/highlight", ["src/updated-document.md", "new-document.md"]); }, []);
  return <TestLocalizationProvider messages={chinese ? chineseCatalog : englishCatalog}><SurfaceAppearanceProvider value={surface}>
    <div {...surface.rootProps} className={themeMode === "dark" ? "dark" : ""} style={{ ...surface.rootProps.style, width:288, height:"100vh", background:"var(--po-sidebar)" }}>
      <ExplorerTree nodes={nodes} activePath={selected} showRoot={false} expandedPaths={new Set(["src"])}
        onSelectNode={node => { if(node?.type === "file") {setSelected(node.path); agentChangedFilesStore.acknowledge("/workspace/highlight",node.path);} }}
        renderNodeActions={node => <><AgentChangedFileMark root="/workspace/highlight" path={node.path} folder={node.type === "folder"}/>
          <button className="tree-row-action-button" aria-label="File actions">…</button></>} />
    </div>
  </SurfaceAppearanceProvider></TestLocalizationProvider>;
}
createRoot(document.getElementById("root")!).render(<Harness />);
