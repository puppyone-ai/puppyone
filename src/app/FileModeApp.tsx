import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useLocalization } from "@puppyone/localization/react";
import { MoreHorizontal } from "lucide-react";
import {
  createDataPortMarkdownAssetResolver,
  createDocumentNavigationPort,
  DEFAULT_EDITOR_INTERACTION_PREFERENCES,
  EditorPaneMenuContributionProvider,
  EMPTY_MARKDOWN_WORKSPACE_ENVIRONMENT,
  FileGlyphIcon,
  FilePreview,
  getEditorProviderPolicy,
  isDocumentDataNode,
  Tooltip,
  useDocumentInput,
  type DataPort,
  type DocumentDataNode,
  type EditorPaneMenuContribution,
  type EditorPaneMenuSegmentedControl,
  type EditorPaneMenuToggle,
  type MarkdownWorkspaceEnvironment,
} from "@puppyone/shared-ui";
import { DesktopWindowChrome } from "../components/DesktopWindowChrome";
import { EditorPaneActionsMenu } from "../components/EditorPaneActionsMenu";
import { EditorViewModeMenu } from "../components/EditorViewModeMenu";
import { PageLoading } from "../components/loading";
import { resolveSurfaceAppearance, SurfaceAppearanceProvider } from "../features/appearance/AppearanceRuntime";
import {
  selectFileIconTheme,
  useDesktopAppearance,
  useDesktopPreference,
  useDesktopPreferenceEffects,
} from "../features/settings";
import { useSubThemeCatalog } from "../features/themes/useSubThemeCatalog";
import { useTypographyCatalog, useTypographyRuntime } from "../features/typography";
import {
  createLocalDataPort,
  getInitialWorkspace,
  openExternalUrl,
  subscribeFileModeFileChanges,
} from "../lib/localFiles";
import type { FileModeTarget } from "../types/electron";
import "./file-mode.css";

/** Links leave for the browser. A lone file has no neighbours to open. */
const FILE_MODE_NAVIGATION = createDocumentNavigationPort({ openExternalUrl });

type OpenedFile = Readonly<{ target: FileModeTarget; dataPort: DataPort; node: DocumentDataNode | null }>;

/** One file in one window: no project, Workbench, Agent, Git or Terminal. */
export function FileModeApp() {
  const { locale, t } = useLocalization();
  const subThemeCatalog = useSubThemeCatalog();
  useDesktopPreferenceEffects(subThemeCatalog.snapshot);
  const appearance = useFileModeAppearance(locale);
  const [opened, setOpened] = useState<OpenedFile | null>(null);
  const [failed, setFailed] = useState(false);
  const [menuContribution, setMenuContribution] = useState<EditorPaneMenuContribution | null>(null);
  const controls = useMemo(() => splitMenuContribution(menuContribution), [menuContribution]);
  const name = opened?.target.name ?? null;

  useEffect(() => {
    let cancelled = false;
    void openBoundFile().then((file) => {
      if (!cancelled) setOpened(file);
    }).catch((error) => {
      console.error("Unable to open the file:", error);
      if (!cancelled) setFailed(true);
    });
    return () => { cancelled = true; };
  }, []);

  return (
    <SurfaceAppearanceProvider value={appearance}>
      <div
        {...appearance.rootProps}
        className={`file-mode-window${appearance.appearance.effectiveColorMode === "dark" ? " dark" : ""}`}
      >
        {/* A project window's Header: the file stands where a project does, its controls where a project's tools do. */}
        <DesktopWindowChrome
          context={name && <FileHeaderContext name={name} />}
          actions={controls && <FileControls name={name} {...controls} />}
        />
        <main className="file-mode-window__document">
          {failed && <FileUnavailable />}
          {opened?.target.tooLarge && <FileUnavailable sizeLimit={opened.target.sizeLimit} />}
          {opened?.node && (
            // Editors hand their view switch and settings to the Header, as they do to a project pane's menu.
            <EditorPaneMenuContributionProvider onContributionChange={setMenuContribution}>
              <FileModeDocument target={opened.target} dataPort={opened.dataPort} node={opened.node} />
            </EditorPaneMenuContributionProvider>
          )}
          {!failed && !opened && (
            <PageLoading variant="fill" size="md" label={null} ariaLabel={t("editor.loadingFile")} />
          )}
        </main>
      </div>
    </SurfaceAppearanceProvider>
  );
}

/** The file's kind and name, set as a project's name is in its Header. */
function FileHeaderContext({ name }: { name: string }) {
  const fileIconTheme = useDesktopPreference(selectFileIconTheme);
  return (
    <div className="desktop-titlebar-context">
      <div className="desktop-titlebar-context-item">
        <FileGlyphIcon name={name} size={15} theme={fileIconTheme} />
        <span className="desktop-titlebar-context-name" dir="auto">{name}</span>
      </div>
    </div>
  );
}

type FileHeaderControls = Readonly<{
  /** The document's own switches, such as Edit and the source panel: pressed commands. */
  toggles: readonly EditorPaneMenuToggle[];
  switches: readonly EditorPaneMenuSegmentedControl[];
  settings: EditorPaneMenuContribution | null;
}>;

const isHeaderToggle = (item: EditorPaneMenuContribution["viewItems"][number]): item is EditorPaneMenuToggle =>
  item.kind === "toggle" && item.icon !== undefined;

/**
 * What the editor hands a project pane's menu, split for the Header: its own
 * switches as pressed commands, a view as one control showing the current
 * view, anything else behind the pane's menu. Null when it hands over nothing.
 */
function splitMenuContribution(contribution: EditorPaneMenuContribution | null): FileHeaderControls | null {
  if (!contribution) return null;
  const toggles = contribution.viewItems.filter(isHeaderToggle);
  const switches = contribution.viewItems.filter(
    (item): item is EditorPaneMenuSegmentedControl => item.kind === "segmented",
  );
  const settingsItems = contribution.viewItems.filter((item) => item.kind !== "segmented" && !isHeaderToggle(item));
  if (!toggles.length && !switches.length && !settingsItems.length) return null;
  return { toggles, switches, settings: settingsItems.length ? { ...contribution, viewItems: settingsItems } : null };
}

/** The file's controls, as Header commands beside each other like a project's tools. */
function FileControls({ name, toggles, switches, settings }: FileHeaderControls & { name: string | null }) {
  const { t } = useLocalization();
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const label = name ? t("editor.panes.actionsFor", { name }) : t("editor.panes.actions");
  return (
    <>
      {toggles.map((item) => (
        <Tooltip key={item.id} content={item.label}><button
          type="button"
          className="desktop-titlebar-action file-mode-window__toggle"
          data-control={item.id}
          aria-label={item.label}
          aria-pressed={item.checked}
          onClick={() => item.setChecked(!item.checked)}
        >
          {item.icon}
        </button></Tooltip>
      ))}
      {switches.map((item) => (
        <EditorViewModeMenu
          key={item.id}
          item={item}
          boundarySelector=".file-mode-window"
          className="desktop-titlebar-action file-mode-window__view-mode"
        />
      ))}
      {settings && (toggles.length > 0 || switches.length > 0) && (
        <span className="desktop-titlebar-action-divider" aria-hidden="true" />
      )}
      {settings && <FileSettingsMenu
        buttonRef={buttonRef}
        label={label}
        name={name}
        settings={settings}
        open={open}
        onToggle={() => setOpen((current) => !current)}
        onClose={close}
      />}
    </>
  );
}

function FileSettingsMenu({ buttonRef, label, name, settings, open, onToggle, onClose }: {
  buttonRef: RefObject<HTMLButtonElement>;
  label: string;
  name: string | null;
  settings: EditorPaneMenuContribution;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
}) {
  return (
    <>
      <Tooltip content={label}><button
        ref={buttonRef}
        type="button"
        className="desktop-titlebar-action file-mode-window__settings"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={onToggle}
      >
        <MoreHorizontal aria-hidden="true" />
      </button></Tooltip>
      <EditorPaneActionsMenu
        anchorRef={buttonRef}
        boundarySelector=".file-mode-window"
        alignment="end"
        editorLabel={name}
        findCommand={null}
        menuContribution={settings}
        open={open}
        onCloseMenu={onClose}
        onOpenExternal={null}
      />
    </>
  );
}

/** The theme boundary a project window has, so sub-themes reach this window too. */
function useFileModeAppearance(locale: string) {
  const { resolvedAppearance, lightThemePreset, darkThemePreset } = useDesktopAppearance();
  const typography = useTypographyRuntime(
    useDesktopPreference((state) => state.typographyPreferences),
    useTypographyCatalog(),
    locale,
  );
  const markdownPresentation = useDesktopPreference((state) => state.markdownPresentation);
  const loadingPlaceholderStyle = useDesktopPreference((state) => state.loadingPlaceholderStyle);
  const pointerCursors = useDesktopPreference((state) => state.pointerCursors);
  const diffMarkers = useDesktopPreference((state) => state.diffMarkers);
  return useMemo(() => resolveSurfaceAppearance({
    appearance: resolvedAppearance,
    typography,
    markdownPresentation,
    loadingPlaceholderStyle,
    lightThemePreset,
    darkThemePreset,
    pointerCursors,
    diffMarkers,
  }), [
    darkThemePreset,
    diffMarkers,
    lightThemePreset,
    loadingPlaceholderStyle,
    markdownPresentation,
    pointerCursors,
    resolvedAppearance,
    typography,
  ]);
}

function FileUnavailable({ sizeLimit }: { sizeLimit?: number }) {
  const { t } = useLocalization();
  return (
    <div className="editor-state editor-state--stacked" role="alert">
      <strong>{t("editor.unavailable.title")}</strong>
      {sizeLimit !== undefined && (
        <span>{t("editor.unavailable.resourceLimit", { limit: `${Math.round(sizeLimit / 1024 / 1024)} MB` })}</span>
      )}
    </div>
  );
}

async function openBoundFile(): Promise<OpenedFile> {
  const { initialFile: target } = await getInitialWorkspace();
  if (!target) throw new Error("This window has no file.");
  const dataPort = createLocalDataPort(target.rootPath);
  if (target.tooLarge) return { target, dataPort, node: null };
  const node = await dataPort.resolveNode?.(target.name);
  if (!isDocumentDataNode(node)) throw new Error("The file is unavailable.");
  return { target, dataPort, node };
}

function FileModeDocument({ target, dataPort, node }: OpenedFile & { node: DocumentDataNode }) {
  const { t } = useLocalization();
  const source = useDocumentInput(node, dataPort);
  const { retry } = source;
  const markdownEnvironment = useMemo<MarkdownWorkspaceEnvironment>(() => ({
    ...EMPTY_MARKDOWN_WORKSPACE_ENVIRONMENT,
    assetUrlResolver: createDataPortMarkdownAssetResolver(dataPort, target.rootPath),
  }), [dataPort, target.rootPath]);
  // Main watches only this file; returning to the window reads it again too.
  useEffect(() => {
    const refresh = () => retry();
    window.addEventListener("focus", refresh);
    const unsubscribe = subscribeFileModeFileChanges(refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      unsubscribe();
    };
  }, [retry]);

  // Text we could not read as UTF-8 cannot be written back without changing it.
  const encoding = source.content?.encoding;
  const readOnly = encoding !== undefined && encoding !== "utf-8";
  const { sourceToggle } = getEditorProviderPolicy({
    path: node.path,
    name: node.name,
    type: node.type,
    mimeType: node.mimeType,
  });

  return (
    <>
      {readOnly && (
        <p className="file-mode-window__notice" role="status">{t("editor.fileMode.readOnlyEncoding")}</p>
      )}
      <FilePreview
        node={node}
        inputGeneration={source.generation}
        fileContent={source.content}
        fileUrl={source.fileUrl}
        fileUrlLoading={source.fileUrlLoading}
        fileUrlError={source.fileUrlError}
        loading={source.loading}
        error={source.error}
        onRetry={source.retry}
        showHeader={false}
        hideSourceView={!sourceToggle}
        // The page to read, an Edit switch, and its source in a panel beside it, from the Header.
        documentControls="edit-and-source-panel"
        // Edits are saved as they are made, as in a project window.
        editorSaveMode="auto"
        htmlTrustMode="safe"
        workspaceRoot={target.rootPath}
        markdownEnvironment={markdownEnvironment}
        documentNavigation={FILE_MODE_NAVIGATION}
        editorInteractionPreferences={DEFAULT_EDITOR_INTERACTION_PREFERENCES}
        previewServices={dataPort.previewServices}
        documentPersistence={readOnly ? null : dataPort.documentPersistence ?? null}
        onDocumentPersisted={source.applyPersistedCommit}
      />
    </>
  );
}
