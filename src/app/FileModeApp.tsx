import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useLocalization } from "@puppyone/localization/react";
import { MoreHorizontal } from "lucide-react";
import {
  createDataPortMarkdownAssetResolver,
  createDocumentNavigationPort,
  DEFAULT_EDITOR_INTERACTION_PREFERENCES,
  EditorPaneMenuContributionProvider,
  EMBEDDED_SCROLL_EVENT,
  EMPTY_MARKDOWN_WORKSPACE_ENVIRONMENT,
  FilePreview,
  getEditorProviderPolicy,
  isDocumentDataNode,
  Tooltip,
  useDocumentInput,
  type DataPort,
  type DocumentDataNode,
  type EditorPaneMenuContribution,
  type EditorPaneMenuSegmentedControl,
  type EmbeddedScrollDetail,
  type MarkdownWorkspaceEnvironment,
} from "@puppyone/shared-ui";
import { EditorPaneActionsMenu } from "../components/EditorPaneActionsMenu";
import { EditorViewModeMenu } from "../components/EditorViewModeMenu";
import { useEditorPaneChromeReveal } from "../components/useEditorPaneChromeReveal";
import { PageLoading } from "../components/loading";
import { useDesktopPlatformCapabilities } from "../platform/useDesktopPlatformCapabilities";
import { resolveSurfaceAppearance, SurfaceAppearanceProvider } from "../features/appearance/AppearanceRuntime";
import { useDesktopAppearance, useDesktopPreference, useDesktopPreferenceEffects } from "../features/settings";
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
  const platformCapabilities = useDesktopPlatformCapabilities();
  const [opened, setOpened] = useState<OpenedFile | null>(null);
  const [failed, setFailed] = useState(false);
  const [menuContribution, setMenuContribution] = useState<EditorPaneMenuContribution | null>(null);
  const documentRef = useRef<HTMLElement>(null);
  useScrolledUnderTitlebar(documentRef);
  // The file's controls appear as a project pane's do: only near the top of the window.
  const windowRef = useRef<HTMLDivElement>(null);
  const controlsReveal = useEditorPaneChromeReveal(windowRef, false);

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
        ref={windowRef}
        className={`file-mode-window${appearance.appearance.effectiveColorMode === "dark" ? " dark" : ""}`}
        data-controls-revealed={controlsReveal.revealed ? "true" : undefined}
        onPointerMove={controlsReveal.onPointerMove}
        onPointerLeave={controlsReveal.onPointerLeave}
      >
        <header
          className="file-mode-window__titlebar"
          data-window-drag-region="true"
          data-window-chrome-mode={platformCapabilities?.windowChrome.mode}
          data-window-platform={platformCapabilities?.platform}
        >
          <span className="file-mode-window__name" dir="auto">{opened?.target.name}</span>
          <FileControls name={opened?.target.name ?? null} contribution={menuContribution} />
        </header>
        <main ref={documentRef} className="file-mode-window__document">
          {failed && <FileUnavailable />}
          {opened?.target.tooLarge && <FileUnavailable sizeLimit={opened.target.sizeLimit} />}
          {opened?.node && (
            // Editors hand their view switch and settings to the title bar, as they do to a project pane's menu.
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

/**
 * What the editor hands a project pane's menu, in the title bar: its view as one
 * control showing the current view, anything else behind the pane's menu.
 */
function FileControls({ name, contribution }: { name: string | null; contribution: EditorPaneMenuContribution | null }) {
  const { t } = useLocalization();
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const switches = useMemo(() => (contribution?.viewItems ?? []).filter(
    (item): item is EditorPaneMenuSegmentedControl => item.kind === "segmented",
  ), [contribution]);
  const settings = useMemo(() => contribution && {
    ...contribution,
    viewItems: contribution.viewItems.filter((item) => item.kind !== "segmented"),
  }, [contribution]);
  if (!switches.length && !settings?.viewItems.length) return null;
  const label = name ? t("editor.panes.actionsFor", { name }) : t("editor.panes.actions");
  return (
    <div className="file-mode-window__controls">
      {switches.map((item) => (
        <EditorViewModeMenu
          key={item.id}
          item={item}
          boundarySelector=".file-mode-window"
          className="file-mode-window__action file-mode-window__view-mode"
        />
      ))}
      {settings?.viewItems.length ? <FileSettingsMenu
        buttonRef={buttonRef}
        label={label}
        name={name}
        settings={settings}
        open={open}
        onToggle={() => setOpen((current) => !current)}
        onClose={close}
      /> : null}
    </div>
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
        className="file-mode-window__action"
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

/**
 * Marks the document while its text is scrolled up under the title bar, which
 * then fades that text out instead of drawing a divider. Only the scroller that
 * starts right under the bar counts, not a code block or table scrolling inside
 * the page. A page in a frame (HTML) scrolls out of sight, so its viewer
 * reports how far instead. A view switch can replace the scroller without a
 * scroll event.
 */
function useScrolledUnderTitlebar(documentRef: RefObject<HTMLElement>) {
  useEffect(() => {
    const surface = documentRef.current;
    if (!surface) return undefined;
    let scroller: Element | null = null;
    // How far a frame's page is scrolled, as its viewer reported; null for an ordinary scroller.
    let reportedTop: number | null = null;
    const update = () => {
      const top = reportedTop ?? scroller?.scrollTop ?? 0;
      surface.toggleAttribute("data-scrolled", !!scroller?.isConnected && top > 0);
    };
    const startsUnderTitlebar = (target: Element) =>
      Math.abs(target.getBoundingClientRect().top - surface.getBoundingClientRect().top) <= 1;
    const onScroll = (event: Event) => {
      const target = event.target;
      if (target !== scroller) {
        if (!(target instanceof Element) || target.scrollHeight <= target.clientHeight) return;
        if (!startsUnderTitlebar(target)) return;
        scroller = target;
        reportedTop = null;
      }
      update();
    };
    const onEmbeddedScroll = (event: Event) => {
      const target = event.target;
      const top = (event as CustomEvent<EmbeddedScrollDetail>).detail?.top;
      if (!(target instanceof Element) || typeof top !== "number") return;
      if (target !== scroller && !startsUnderTitlebar(target)) return;
      scroller = target;
      reportedTop = top;
      update();
    };
    const replaced = new MutationObserver(() => {
      if (scroller && !scroller.isConnected) {
        scroller = null;
        update();
      }
    });
    surface.addEventListener("scroll", onScroll, { capture: true, passive: true });
    surface.addEventListener(EMBEDDED_SCROLL_EVENT, onEmbeddedScroll);
    replaced.observe(surface, { childList: true, subtree: true });
    return () => {
      surface.removeEventListener("scroll", onScroll, { capture: true });
      surface.removeEventListener(EMBEDDED_SCROLL_EVENT, onEmbeddedScroll);
      replaced.disconnect();
    };
  }, [documentRef]);
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
