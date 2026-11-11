import { useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { Excalidraw, MainMenu, FONT_FAMILY, serializeAsJSON, hashElementsVersion } from "@excalidraw/excalidraw";
import { useLocalization } from "@puppyone/localization/react";
import { useDocumentModelOwner } from "../../document-session/DocumentModelOwner";
import { useEditableDocumentSource } from "../../document-session/EditableDocumentSourceContext";
import type { PresetViewerRenderContext } from "../../registry/viewerTypes";
import { ExcalidrawDocumentModel } from "./ExcalidrawDocumentModel";
import { isLocalHtmlEmbed, WhiteboardEmbed } from "./WhiteboardEmbed";
import "@excalidraw/excalidraw/index.css";
import "./whiteboard.css";

const LANGUAGES: Record<string, string> = { en: "en", "zh-Hans": "zh-CN", de: "de-DE", es: "es-ES", fr: "fr-FR", ja: "ja-JP", ko: "ko-KR", "pt-BR": "pt-BR" };

export function ExcalidrawViewer(props: PresetViewerRenderContext) {
  const { t, locale } = useLocalization();
  const owner = useDocumentModelOwner();
  const source = useEditableDocumentSource();
  const container = useRef<HTMLDivElement>(null);
  const model = useMemo(() => {
    const create = () => new ExcalidrawDocumentModel(props.content);
    return owner?.getOrCreate("excalidraw", create) ?? create();
    // External changes are adopted by the document session, preserving its save barrier.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, props.document.path]);
  const lastChange = useRef<{ model: ExcalidrawDocumentModel; generation: number; version: number; state: string; files: unknown } | null>(null);
  const generation = useSyncExternalStore(model.subscribe, model.getGeneration, model.getGeneration);
  const scene = model.getScene();
  useLayoutEffect(() => {
    owner?.activate(model);
    if (!source) return;
    const detach = source.attachSource({
      retainedSource: model,
      readSnapshot: model.readSnapshot,
      replaceContent: model.replaceContent,
      setInputEnabled: model.setInputEnabled,
      prepareDetach: async () => {
        const active = document.activeElement;
        if (active instanceof HTMLElement && container.current?.contains(active)) active.blur();
        // Excalidraw commits its text editor on blur before the host captures the source.
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      },
    });
    source.reportRevision({ revision: model.readSnapshot().revision, origin: "model-initialization" });
    return detach;
  }, [model, owner, source]);
  useLayoutEffect(() => {
    if (!source && model.readSnapshot().content !== props.content) model.replaceContent(props.content);
  }, [model, props.content, source]);

  return <div ref={container} className="whiteboard-editor" aria-label={t("editor.whiteboard.label")}>
    {scene ? <Excalidraw
      key={generation}
      initialData={{
        ...scene,
        appState: {
          currentItemRoughness: 0,
          currentItemFontFamily: FONT_FAMILY.Nunito,
          ...scene.appState,
        },
        scrollToContent: true,
      }}
      name={props.document.name}
      langCode={LANGUAGES[locale] ?? "en"}
      viewModeEnabled={!props.canEdit}
      handleKeyboardGlobally={false}
      autoFocus={false}
      aiEnabled={false}
      UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false, export: false, toggleTheme: false } }}
      onChange={(elements, state, files) => {
        // Pointer motion, selection and zoom must not repeatedly serialize embedded images.
        const version = hashElementsVersion(elements);
        const persistedState = serializeAsJSON([], state, {}, "local");
        const previous = lastChange.current;
        if (previous?.model === model && previous.generation === generation && previous.version === version && previous.state === persistedState && previous.files === files) return;
        lastChange.current = { model, generation, version, state: persistedState, files };
        if (props.canEdit && model.acceptScene(`${serializeAsJSON(elements, state, files, "local")}\n`, generation)) {
          source?.reportRevision({ revision: model.readSnapshot().revision, origin: "local-edit" });
        }
      }}
      onLinkOpen={(element, event) => {
        event.preventDefault();
        const navigation = props.documentNavigation;
        const reference = element.link && navigation?.resolveReference(props.document.path, element.link);
        if (reference && navigation?.canOpenReference(reference)) {
          void Promise.resolve(navigation.openReference(reference)).catch(() => undefined);
        }
      }}
      validateEmbeddable={isLocalHtmlEmbed}
      renderEmbeddable={(element) => <WhiteboardEmbed link={element.link ?? ""} documentPath={props.document.path}
        resolver={props.markdownEnvironment?.assetUrlResolver} htmlTrustMode={props.htmlTrustMode}
        workspaceRoot={props.workspaceRoot} documentNavigation={props.documentNavigation} />}
    >
      <MainMenu><MainMenu.DefaultItems.SaveAsImage /><MainMenu.DefaultItems.ClearCanvas /><MainMenu.DefaultItems.ChangeCanvasBackground /></MainMenu>
    </Excalidraw> : <div role="alert" className="editor-state danger">{t("editor.whiteboard.invalidFile")}</div>}
  </div>;
}
