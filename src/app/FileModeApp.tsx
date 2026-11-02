import { useEffect, useMemo, useState } from "react";
import { useLocalization } from "@puppyone/localization/react";
import {
  createDataPortMarkdownAssetResolver,
  createDocumentNavigationPort,
  DEFAULT_EDITOR_INTERACTION_PREFERENCES,
  EMPTY_MARKDOWN_WORKSPACE_ENVIRONMENT,
  FilePreview,
  getEditorProviderPolicy,
  isDocumentDataNode,
  subscribeUnsavedDocumentSessions,
  useDocumentInput,
  type DataPort,
  type DocumentDataNode,
  type MarkdownWorkspaceEnvironment,
} from "@puppyone/shared-ui";
import { PageLoading } from "../components/loading";
import { useDesktopPreference, useDesktopPreferenceEffects } from "../features/settings";
import { useSubThemeCatalog } from "../features/themes/useSubThemeCatalog";
import { useTypographyCatalog, useTypographyRuntime } from "../features/typography";
import {
  createLocalDataPort,
  getInitialWorkspace,
  openExternalUrl,
  openFileFolder,
  setFileEdited,
} from "../lib/localFiles";
import type { FileModeTarget } from "../types/electron";
import "./file-mode.css";

/** Saves are explicit here, so the window has to show when a change is unsaved. */
const FILE_MODE_EDITOR_PREFERENCES = {
  ...DEFAULT_EDITOR_INTERACTION_PREFERENCES,
  showSaveStatus: true,
};

/** Links leave for the browser. A lone file has no neighbours to open. */
const FILE_MODE_NAVIGATION = createDocumentNavigationPort({ openExternalUrl });

type OpenedFile = Readonly<{ target: FileModeTarget; dataPort: DataPort; node: DocumentDataNode | null }>;

/** One file in one window: no project, Workbench, Agent, Git or Terminal. */
export function FileModeApp() {
  const { locale, t } = useLocalization();
  const subThemeCatalog = useSubThemeCatalog();
  useDesktopPreferenceEffects(subThemeCatalog.snapshot);
  useTypographyRuntime(useDesktopPreference((state) => state.typographyPreferences), useTypographyCatalog(), locale);

  const [opened, setOpened] = useState<OpenedFile | null>(null);
  const [failed, setFailed] = useState(false);

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

  useEffect(() => subscribeUnsavedDocumentSessions(setFileEdited), []);

  return (
    <div className="file-mode-window">
      <header className="file-mode-window__titlebar" data-window-drag-region="true">
        <span className="file-mode-window__name" dir="auto">{opened?.target.name}</span>
        {opened && (
          <button
            type="button"
            className="file-mode-window__action"
            data-po-interaction="navigation"
            onClick={() => void openFileFolder().catch((error) => console.error("Unable to open the folder:", error))}
          >
            {t("editor.fileMode.openFolder")}
          </button>
        )}
      </header>
      <main className="file-mode-window__document">
        {failed && <FileUnavailable />}
        {opened?.target.tooLarge && <FileUnavailable sizeLimit={opened.target.sizeLimit} />}
        {opened?.node && <FileModeDocument target={opened.target} dataPort={opened.dataPort} node={opened.node} />}
        {!failed && !opened && (
          <PageLoading variant="fill" size="md" label={null} ariaLabel={t("editor.loadingFile")} />
        )}
      </main>
    </div>
  );
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
  // There is no folder watcher here, so outside changes are picked up on return.
  useEffect(() => {
    const refresh = () => retry();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
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
        editorSaveMode="manual"
        htmlTrustMode="safe"
        workspaceRoot={target.rootPath}
        markdownEnvironment={markdownEnvironment}
        documentNavigation={FILE_MODE_NAVIGATION}
        editorInteractionPreferences={FILE_MODE_EDITOR_PREFERENCES}
        previewServices={dataPort.previewServices}
        documentPersistence={readOnly ? null : dataPort.documentPersistence ?? null}
        onDocumentPersisted={source.applyPersistedCommit}
      />
    </>
  );
}
