import { useEffect, useMemo, useState } from "react";
import { useLocalization } from "@puppyone/localization/react";
import {
  createDataPortMarkdownAssetResolver,
  DEFAULT_EDITOR_INTERACTION_PREFERENCES,
  EMPTY_MARKDOWN_WORKSPACE_ENVIRONMENT,
  FilePreview,
  isDocumentDataNode,
  useDocumentInput,
  type DataPort,
  type DocumentDataNode,
  type MarkdownWorkspaceEnvironment,
} from "@puppyone/shared-ui";
import { PageLoading } from "../components/loading";
import { useDesktopPreference, useDesktopPreferenceEffects } from "../features/settings";
import { useSubThemeCatalog } from "../features/themes/useSubThemeCatalog";
import { useTypographyCatalog, useTypographyRuntime } from "../features/typography";
import { createLocalDataPort, getInitialWorkspace } from "../lib/localFiles";
import type { FileModeTarget } from "../types/electron";
import "./file-mode.css";

/** Saves are explicit here, so the window has to show when a change is unsaved. */
const FILE_MODE_EDITOR_PREFERENCES = {
  ...DEFAULT_EDITOR_INTERACTION_PREFERENCES,
  showSaveStatus: true,
};

type OpenedFile = Readonly<{ target: FileModeTarget; dataPort: DataPort; node: DocumentDataNode }>;

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

  return (
    <div className="file-mode-window">
      <header className="file-mode-window__titlebar" data-window-drag-region="true">
        <span className="file-mode-window__name" dir="auto">{opened?.target.name}</span>
      </header>
      <main className="file-mode-window__document">
        {failed && (
          <div className="editor-state editor-state--stacked" role="alert">
            <strong>{t("editor.unavailable.title")}</strong>
          </div>
        )}
        {opened && <FileModeDocument {...opened} />}
        {!failed && !opened && (
          <PageLoading variant="fill" size="md" label={null} ariaLabel={t("editor.loadingFile")} />
        )}
      </main>
    </div>
  );
}

async function openBoundFile(): Promise<OpenedFile> {
  const { initialFile: target } = await getInitialWorkspace();
  if (!target) throw new Error("This window has no file.");
  const dataPort = createLocalDataPort(target.rootPath);
  const node = await dataPort.resolveNode?.(target.name);
  if (!isDocumentDataNode(node)) throw new Error("The file is unavailable.");
  return { target, dataPort, node };
}

function FileModeDocument({ target, dataPort, node }: OpenedFile) {
  const source = useDocumentInput(node, dataPort);
  const markdownEnvironment = useMemo<MarkdownWorkspaceEnvironment>(() => ({
    ...EMPTY_MARKDOWN_WORKSPACE_ENVIRONMENT,
    assetUrlResolver: createDataPortMarkdownAssetResolver(dataPort, target.rootPath),
  }), [dataPort, target.rootPath]);
  const { retry } = source;
  // There is no folder watcher here, so outside changes are picked up on return.
  useEffect(() => {
    const refresh = () => retry();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [retry]);

  return (
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
      editorSaveMode="manual"
      htmlTrustMode="safe"
      workspaceRoot={target.rootPath}
      markdownEnvironment={markdownEnvironment}
      editorInteractionPreferences={FILE_MODE_EDITOR_PREFERENCES}
      previewServices={dataPort.previewServices}
      editorAssets={dataPort.editorAssets}
      documentPersistence={dataPort.documentPersistence ?? null}
      onDocumentPersisted={source.applyPersistedCommit}
    />
  );
}
