import { DesktopMenuItem, DesktopMenuSurface } from "../../components/DesktopMenu";
import { OnboardingProjectList } from "../../components/onboarding/OnboardingProjectList";
import { DesktopWindowChrome } from "../../components/DesktopWindowChrome";
import { DesktopShellLocationBar } from "../app-shell/DesktopShellLocationBar";
import { AuxiliaryWorkbenchCloseDialog } from "../app-shell/auxiliary-workbench/AuxiliaryWorkbenchCloseDialog";
import { useLocalization } from "@puppyone/localization/react";
import {
  ExplorerTree,
  type DataNode,
} from "@puppyone/shared-ui";
import { FolderOpen, GitBranch, Settings, SquareTerminal } from "lucide-react";
import { useEffect } from "react";
import {
  getInterfaceStyleDefinition,
  parseInterfaceStyle,
} from "./interfaceStyles";
import {
  createTypographyRootProps,
  DEFAULT_TYPOGRAPHY_PREFERENCES,
  resolveTypography,
  TYPOGRAPHY_SCALE_OPTIONS,
  withTypographyScale,
} from "../typography";
import "./appearance-visual-smoke.css";

const searchParams = new URLSearchParams(window.location.search);
const style = parseInterfaceStyle(searchParams.get("style"));
const dialogFixture = searchParams.get("dialog");
const requestedTypographyScale = searchParams.get("scale");
const typographyScale = TYPOGRAPHY_SCALE_OPTIONS.find(
  (candidate) => candidate === requestedTypographyScale,
) ?? DEFAULT_TYPOGRAPHY_PREFERENCES.scale;
const profile = getInterfaceStyleDefinition(style);
const root = document.documentElement;
root.dataset.interfaceStyle = style;
root.dataset.interfaceStyleFamily = profile.profile.family;
root.dataset.interfaceStyleVariant = profile.profile.variant;
root.dataset.interfaceStylePalette = profile.profile.palette;
root.dataset.initialTheme = "light";
root.dataset.appearanceTokenSet = profile.tokenSet;
root.dataset.shellComposition = profile.composition.shell;
root.dataset.titlebarComposition = profile.composition.titlebar;
root.dataset.navigationComposition = profile.composition.navigation;
root.dataset.locationBarComposition = profile.composition.locationBar;
root.dataset.scrollbarComposition = profile.composition.scrollbar;
root.dataset.iconPack = profile.composition.iconPack;
const typographyRootProps = createTypographyRootProps(
  resolveTypography(withTypographyScale(DEFAULT_TYPOGRAPHY_PREFERENCES, typographyScale)),
);

const surfaceFamilies = [
  "document",
  "code",
  "grid",
  "canvas",
  "media",
  "embedded",
  "fallback",
] as const;
const fixtureTreeNodes: DataNode[] = [
  folderFixture("Desktop"),
  folderFixture("My Documents"),
  folderFixture("PuppyOne", [
    fileFixture("PuppyOne/README.md", "markdown"),
    fileFixture("PuppyOne/index.html", "html"),
    folderFixture("PuppyOne/Archive", [
      fileFixture("PuppyOne/Archive/wireframe.png", "image"),
      fileFixture("PuppyOne/Archive/release.zip", "archive"),
    ]),
  ]),
];
const fixtureExpandedPaths = new Set(["PuppyOne", "PuppyOne/Archive"]);
const fixtureSelectedPaths = new Set(["PuppyOne"]);
const codeFixture = "const style = resolveAppearance(profile);";
const gridFixture = { firstColumn: "id", secondColumn: "family", file: "README.md" };
const smokeNavigationItems = [
  { dataItem: "data", icon: FolderOpen, labelKey: "shell.navigation.files" },
  { dataItem: "git", icon: GitBranch, labelKey: "shell.navigation.git" },
  { dataItem: "settings", icon: Settings, labelKey: "shell.navigation.settings" },
] as const;

/** Deterministic Chromium fixture for the representative Style × Surface CI matrix. */
export function AppearanceVisualSmokeHarness() {
  const { t } = useLocalization();
  const hasShellToolbar = profile.composition.navigation === "sidebar-top-toolbar";
  const hasLocationBar = profile.composition.locationBar === "workspace-path-v1";

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('[data-explorer-path="PuppyOne"]')?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  return (
    <main
      {...typographyRootProps}
      className="app-shell appearance-visual-smoke"
      data-po-appearance-root="true"
      data-appearance-token-set={profile.tokenSet}
      data-appearance-visual-ready="true"
      data-icon-pack={profile.composition.iconPack}
      data-interface-style={style}
      data-location-bar-composition={profile.composition.locationBar}
      data-navigation-composition={profile.composition.navigation}
      data-scrollbar-composition={profile.composition.scrollbar}
      data-shell-composition={profile.composition.shell}
      data-smoke-style={style}
      data-titlebar-composition={profile.composition.titlebar}
    >
      <div className="desktop-shell">
        <DesktopWindowChrome
          context={(
            <div className="appearance-visual-title-context">
              <span className="appearance-visual-app-mark" aria-hidden="true">P</span>
              <strong>{t(profile.labelKey)}</strong>
              <span>{t("settings.appearance.interfaceStyle.title")} · {style}</span>
            </div>
          )}
          actions={<button className="desktop-titlebar-action" type="button">?</button>}
        />
        {hasShellToolbar && (
          <div className="desktop-shell-navigation-toolbar-host" data-window-no-drag="true">
            <SmokeToolbarActions />
            <SmokeNavigation shellToolbar />
          </div>
        )}
        {hasLocationBar && (
          <div className="desktop-shell-location-bar-host" data-window-no-drag="true">
            <DesktopShellLocationBar
              path={"C:\\Documents and Settings\\Amanda\\My Documents\\PuppyOne\\README.md"}
              onNavigate={() => undefined}
            />
          </div>
        )}
        <div className="appearance-visual-body">
          <aside className="appearance-visual-explorer">
            {!hasShellToolbar && <SmokeNavigation />}
            <div className="appearance-visual-tree-frame">
              <ExplorerTree
                activePath="PuppyOne"
                currentFolderPath="PuppyOne"
                expandedPaths={fixtureExpandedPaths}
                nodes={fixtureTreeNodes}
                onSelectNode={() => undefined}
                onToggleFolder={() => undefined}
                renderListEnd={() => <div className="appearance-visual-scroll-spacer" aria-hidden="true" />}
                selectedPaths={fixtureSelectedPaths}
                showRoot={false}
              />
            </div>
          </aside>
          <section
            className="appearance-visual-content"
            aria-label={t("settings.appearance.interfaceStyle.title")}
            data-po-scrollbar="content"
          >
            <div
              className="appearance-visual-axis-scroll-fixture"
              data-axis-scroll-fixture="true"
              data-po-scrollbar="content"
            >
              <div aria-hidden="true" />
            </div>
            {surfaceFamilies.map((family) => (
              <article
                className="po-viewer-surface-boundary appearance-visual-surface"
                data-viewer-id={`visual-${family}`}
                data-viewer-surface-family={family}
                key={family}
              >
                <header>{family}</header>
                <SurfaceSample family={family} label={t(profile.labelKey)} />
              </article>
            ))}
            <div className="appearance-visual-content-overflow-fixture" aria-hidden="true" />
          </section>
        </div>
      </div>
      <section hidden data-typography-hierarchy-fixture="true">
        <div className="desktop-titlebar">
          <span className="desktop-titlebar-context-name">{t(profile.labelKey)}</span>
        </div>
        <div className="onboarding-homepage">
          <OnboardingProjectList
            items={[{ id: "typography-project", label: "PuppyOne", localPath: "/Users/demo/Desktop/PuppyOne", lastOpenedAt: null }]}
            busy={false}
            openingPath={null}
            removingPath={null}
            draggingPath={null}
            onOpen={() => undefined}
            onDragStart={() => undefined}
            onDragEnd={() => undefined}
          />
        </div>
        <DesktopMenuItem className="typography-standalone-row" label={t(profile.labelKey)} detail={fixtureTreeNodes[2].name} />
        {(["header", "right-sidebar"] as const).map((surface) => (
          <DesktopMenuSurface key={surface} typographySurface={surface}>
            <DesktopMenuItem label={t(profile.labelKey)} detail={fixtureTreeNodes[2].name} />
          </DesktopMenuSurface>
        ))}
      </section>
      {dialogFixture === "terminal-close" && (
        <AuxiliaryWorkbenchCloseDialog
          pending={Object.freeze({
            itemId: "appearance-terminal-close",
            decision: Object.freeze({
              kind: "confirm" as const,
              tone: "danger" as const,
              dialog: Object.freeze({
                title: t("terminal.closeDialog.title", {
                  title: t("terminal.sessionTitle", { number: 1 }),
                }),
                detail: t("terminal.closeDialog.detail"),
                actionLabel: t("terminal.closeDialog.confirm"),
              }),
            }),
          })}
          committing={false}
          onDismiss={() => undefined}
          onConfirm={() => undefined}
        />
      )}
    </main>
  );
}

function folderFixture(path: string, children: DataNode[] = []): DataNode {
  const name = path.split("/").at(-1) ?? path;
  return {
    id: `folder:${path}`,
    name,
    path,
    type: "folder",
    hasChildren: children.length > 0,
    children,
  };
}

function fileFixture(path: string, type: DataNode["type"]): DataNode {
  return {
    id: `file:${path}`,
    name: path.split("/").at(-1) ?? path,
    path,
    type,
  };
}

function SmokeToolbarActions() {
  const { t } = useLocalization();
  return (
    <div
      className="desktop-shell-navigation-toolbar-actions desktop-shell-toolbar-section"
      data-shell-toolbar-section="actions"
    >
      <button
        className="desktop-shell-toolbar-button desktop-shell-toolbar-terminal"
        data-toolbar-action="terminal"
        type="button"
        aria-pressed="true"
      >
        <i
          className="desktop-shell-toolbar-button-icon"
          aria-hidden="true"
        >
          <SquareTerminal size={19} strokeWidth={1.8} />
        </i>
        <span className="desktop-shell-toolbar-button-label">
          {t("terminal.title")}
        </span>
      </button>
    </div>
  );
}

function SmokeNavigation({ shellToolbar = false }: { shellToolbar?: boolean }) {
  const { t } = useLocalization();
  return (
    <nav
      className={`desktop-sidebar-top-navigation desktop-sidebar-navigation-surface horizontal${shellToolbar ? " desktop-shell-toolbar-navigation desktop-shell-toolbar-section" : ""}`}
      aria-label={t("shell.navigation.ariaLabel")}
      data-placement="top"
      data-orientation="horizontal"
      data-shell-toolbar-section={shellToolbar ? "navigation" : undefined}
    >
      <div className={`desktop-sidebar-top-navigation-list${shellToolbar ? " desktop-shell-toolbar-list" : ""}`}>
        <div className={`desktop-sidebar-top-navigation-group desktop-sidebar-top-navigation-local${shellToolbar ? " desktop-shell-toolbar-group" : ""}`}>
          {smokeNavigationItems.map(({ dataItem, icon: Icon, labelKey }) => (
            <button
              className={`desktop-sidebar-top-navigation-button${shellToolbar ? " desktop-shell-toolbar-button" : ""}${dataItem === "data" ? " active" : ""}`}
              data-navigation-item={dataItem}
              aria-current={dataItem === "data" ? "page" : undefined}
              type="button"
              key={dataItem}
            >
              <i className={`desktop-sidebar-nav-icon-wrap${shellToolbar ? " desktop-shell-toolbar-button-icon" : ""}`} aria-hidden="true"><Icon size={16} /></i>
              <span className={`desktop-sidebar-nav-label${shellToolbar ? " desktop-shell-toolbar-button-label" : ""}`}>{t(labelKey)}</span>
              {dataItem === "git" && !shellToolbar && (
                <em className="desktop-sidebar-nav-badge workspace" aria-hidden="true" />
              )}
            </button>
          ))}
        </div>
      </div>
    </nav>
  );
}

function SurfaceSample({
  family,
  label,
}: {
  family: (typeof surfaceFamilies)[number];
  label: string;
}) {
  if (family === "code") return <pre><code>{codeFixture}</code></pre>;
  if (family === "grid") {
    return (
      <table>
        <tbody>
          <tr><th>{gridFixture.firstColumn}</th><th>{gridFixture.secondColumn}</th></tr>
          <tr><td>{gridFixture.file}</td><td>{family}</td></tr>
        </tbody>
      </table>
    );
  }
  if (family === "canvas") return <div className="appearance-visual-canvas-node">{family}</div>;
  if (family === "media") return <div className="appearance-visual-media">▶ 00:42</div>;
  if (family === "embedded") return <div className="appearance-visual-embedded">{family}</div>;
  if (family === "fallback") return <div className="appearance-visual-fallback">{family}</div>;
  return <p>{label}</p>;
}
