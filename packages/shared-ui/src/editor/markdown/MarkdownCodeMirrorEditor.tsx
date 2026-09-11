"use client";

import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocalization } from "@puppyone/localization/react";
import {
  markdownCodeMirrorLanguageExtension,
  markdownCodeMirrorUrgentExtensions,
  markdownLivePreviewCoreExtension,
} from "./markdownCodeMirrorExtensions";
import { markdownLivePreviewContextExtension } from "./core/editor/markdownLivePreviewContext";
import { markdownAiEditExtension } from "./core/editor/markdownAiEditExtension";
import { markdownBlockDragExtension } from "./core/interaction/markdownBlockDrag";
import { markdownHeadingOutlineExtension } from "./core/interaction/markdownHeadingOutline";
import { getMarkdownPlanIndex } from "./core/plans/markdownPlanIndex";
import { markdownRevealedSourceEffect } from "./core/state/revealedSource";
import { getDocRevision } from "./platform/brokers/transactionBroker";
import type { AiEditFile } from "../ai-edits/types";
import {
  EMPTY_MARKDOWN_LINK_COMMANDS,
  type MarkdownAssetUrlResolver,
  type MarkdownDialectId,
  type MarkdownHtmlTrustMode,
  type MarkdownLinkCommands,
  type MarkdownLinkGraph,
} from "../registry/viewerTypes";
import type {
  EditorSourceRevision,
  EditorSourceSnapshotPort,
} from "../sourceSnapshot";
import { getRendererPerformanceTracker } from "../../performance/rendererPerformance";
import { subscribeTypographyChanges } from "../../core/typography";
import { markdownLocalizationExtension } from "./core/editor/markdownLocalization";
import { resolveMarkdownDialect } from "./core/dialect/markdownDialect";
import {
  resolveMarkdownContentLanguage,
  type MarkdownContentLanguageResolution,
} from "./core/presentation/markdownContentLanguage";
import {
  bindMarkdownFormatHotkeys,
  syncMarkdownEditorCommandAvailability,
} from "./core/commands/markdownFormatHotkeys";
import { CodeMirrorFindAdapter } from "../find/codeMirrorFindAdapter";
import { useRegisterEditorFindAdapter } from "../find/editorFind";
import { useEditorAppearanceRevision } from "../../core/appearance/EditorAppearanceContext";
import { useDocumentModelOwner } from "../document-session/DocumentModelOwner";
import { CodeMirrorDocumentModel, externalDocumentUpdate } from "../document-session/CodeMirrorDocumentModel";

const rendererPerformance = getRendererPerformanceTracker();

export type MarkdownCodeMirrorEditorProps = {
  value: string;
  readOnly: boolean;
  livePreview: boolean;
  blockDragEnabled?: boolean;
  aiEditFile?: AiEditFile | null;
  htmlTrustMode?: MarkdownHtmlTrustMode;
  documentPath?: string;
  documentLanguage?: string | null;
  markdownDialect?: MarkdownDialectId | null;
  workspaceId?: string;
  workspaceRoot?: string | null;
  markdownLinkGraph?: MarkdownLinkGraph | null;
  markdownLinkCommands?: MarkdownLinkCommands;
  markdownAssetUrlResolver?: MarkdownAssetUrlResolver | null;
  markdownAssetResolverRevision?: number;
  /** Legacy controlled boundary. Product Markdown surfaces use snapshot ports. */
  onChange?: (value: string) => void;
  onSourceRevisionChange?: (revision: EditorSourceRevision) => void;
  onSnapshotPortChange?: (port: EditorSourceSnapshotPort | null) => void;
  onEditorBaseReady?: (revision: string) => void;
  onPreviewReady?: (revision: string) => void;
  onPreviewError?: (error: Error) => void;
};

const PREVIEW_PENDING_MESSAGE_DELAY_MS = 150;

export type MarkdownPreviewPresentationState = "source" | "pending" | "ready" | "error";

export function MarkdownCodeMirrorEditor({
  value,
  readOnly,
  livePreview,
  blockDragEnabled = false,
  aiEditFile = null,
  htmlTrustMode = "safe",
  documentPath = "",
  documentLanguage = null,
  markdownDialect = null,
  workspaceId = "",
  workspaceRoot = null,
  markdownLinkGraph = null,
  markdownLinkCommands = EMPTY_MARKDOWN_LINK_COMMANDS,
  markdownAssetUrlResolver = null,
  markdownAssetResolverRevision = 0,
  onChange,
  onSourceRevisionChange,
  onSnapshotPortChange,
  onEditorBaseReady,
  onPreviewReady,
  onPreviewError,
}: MarkdownCodeMirrorEditorProps) {
  const appearanceRevision = useEditorAppearanceRevision();
  const { direction, formatNumber, locale, t } = useLocalization();
  const localization = useMemo(
    () => ({ direction, formatNumber, locale, t }),
    [direction, formatNumber, locale, t],
  );
  const resolvedDialect = useMemo(
    () => resolveMarkdownDialect({ documentPath, explicitDialect: markdownDialect }).dialect,
    [documentPath, markdownDialect],
  );
  const contentLanguageKey = `${documentPath}\u0000${documentLanguage ?? ""}\u0000${locale}`;
  const contentLanguageStateRef = useRef<{
    key: string;
    awaitingContent: boolean;
    resolution: MarkdownContentLanguageResolution;
  } | null>(null);
  let contentLanguageState = contentLanguageStateRef.current;
  const hasContent = value.trim().length > 0;
  if (
    contentLanguageState === null
    || contentLanguageState.key !== contentLanguageKey
    || (contentLanguageState.awaitingContent && hasContent)
  ) {
    contentLanguageState = {
      key: contentLanguageKey,
      awaitingContent: !hasContent,
      resolution: resolveMarkdownContentLanguage(value, locale, documentLanguage),
    };
    contentLanguageStateRef.current = contentLanguageState;
  }
  const contentLanguage = contentLanguageState.resolution;
  const initialLocalizationRef = useRef(localization);
  const findAdapter = useMemo(() => new CodeMirrorFindAdapter(), []);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const modelOwner = useDocumentModelOwner();
  const modelRef = useRef<CodeMirrorDocumentModel | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const externalValueRef = useRef(value);
  const documentPathRef = useRef(documentPath);
  documentPathRef.current = documentPath;
  const callbacksRef = useRef({
    onChange,
    onSourceRevisionChange,
    onSnapshotPortChange,
    onEditorBaseReady,
    onPreviewReady,
    onPreviewError,
  });
  callbacksRef.current = {
    onChange,
    onSourceRevisionChange,
    onSnapshotPortChange,
    onEditorBaseReady,
    onPreviewReady,
    onPreviewError,
  };
  const editableCompartmentRef = useRef(new Compartment());
  const languageCompartmentRef = useRef(new Compartment());
  const livePreviewCoreCompartmentRef = useRef(new Compartment());
  const blockDragCompartmentRef = useRef(new Compartment());
  const headingOutlineCompartmentRef = useRef(new Compartment());
  const livePreviewContextCompartmentRef = useRef(new Compartment());
  const aiEditCompartmentRef = useRef(new Compartment());
  const localizationCompartmentRef = useRef(new Compartment());
  const initialEditorConfigRef = useRef({ aiEditFile, readOnly, value });
  const previewActivatedRef = useRef(false);
  const blockDragEnabledRef = useRef(blockDragEnabled);
  blockDragEnabledRef.current = blockDragEnabled;
  const previewGenerationRef = useRef(0);
  const [previewState, setPreviewState] = useState<MarkdownPreviewPresentationState>(
    () => livePreview ? "pending" : "source",
  );
  const [showPendingMessage, setShowPendingMessage] = useState(false);

  useRegisterEditorFindAdapter(findAdapter);
  const livePreviewContextRef = useRef({
    htmlTrustMode,
    markdownLinkGraph,
    markdownLinkCommands,
    documentPath,
    markdownAssetUrlResolver,
    markdownAssetResolverRevision,
    workspaceId,
    workspaceRoot,
  });
  livePreviewContextRef.current = {
    htmlTrustMode,
    markdownLinkGraph,
    markdownLinkCommands,
    documentPath,
    markdownAssetUrlResolver,
    markdownAssetResolverRevision,
    workspaceId,
    workspaceRoot,
  };

  useLayoutEffect(() => {
    previewGenerationRef.current += 1;
    previewActivatedRef.current = false;
    setShowPendingMessage(false);
    setPreviewState(livePreview ? "pending" : "source");

    if (livePreview) return;
    const view = viewRef.current;
    if (!view) return;
    try {
      view.dispatch({
        effects: [
          livePreviewContextCompartmentRef.current.reconfigure([]),
          livePreviewCoreCompartmentRef.current.reconfigure([]),
          blockDragCompartmentRef.current.reconfigure([]),
          headingOutlineCompartmentRef.current.reconfigure([]),
        ],
      });
    } catch (error) {
      callbacksRef.current.onPreviewError?.(toError(error));
    }
  }, [documentPath, livePreview, resolvedDialect]);

  useEffect(() => {
    if (previewState !== "pending") {
      setShowPendingMessage(false);
      return undefined;
    }
    const timeoutId = window.setTimeout(() => {
      setShowPendingMessage(true);
    }, PREVIEW_PENDING_MESSAGE_DELAY_MS);
    return () => window.clearTimeout(timeoutId);
  }, [previewState]);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const initialConfig = initialEditorConfigRef.current;
    const model = modelOwner?.getOrCreate("codemirror-markdown", () => new CodeMirrorDocumentModel(initialConfig.value, getDocRevision))
      ?? new CodeMirrorDocumentModel(initialConfig.value, getDocRevision);
    modelOwner?.activate(model);
    modelRef.current = model;

    const editorCreateStartedAt = performance.now();
    const view = new EditorView({
      scrollTo: model.getScrollSnapshot(),
      parent: host,
      dispatchTransactions: (transactions, targetView) => {
        const startedAt = performance.now();
        model.acceptTransactions(transactions, targetView);
        if (transactions.some((transaction) => (
          transaction.docChanged
          && !transaction.annotation(externalDocumentUpdate)
        ))) {
          rendererPerformance.recordInputTransaction(performance.now() - startedAt);
        }
      },
      state: model.createViewState([
          ...markdownCodeMirrorUrgentExtensions(initialConfig.readOnly, false),
          findAdapter.extension,
          localizationCompartmentRef.current.of(
            markdownLocalizationExtension(initialLocalizationRef.current, initialConfig.readOnly),
          ),
          editableCompartmentRef.current.of(getEditableExtensions(initialConfig.readOnly)),
          languageCompartmentRef.current.of([]),
          livePreviewContextCompartmentRef.current.of([]),
          livePreviewCoreCompartmentRef.current.of([]),
          blockDragCompartmentRef.current.of([]),
          headingOutlineCompartmentRef.current.of([]),
          aiEditCompartmentRef.current.of(markdownAiEditExtension(initialConfig.aiEditFile)),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            if (update.transactions.some((transaction) => transaction.annotation(externalDocumentUpdate))) return;
            const revision = getDocRevision(update.state.doc);
            callbacksRef.current.onSourceRevisionChange?.({ revision, origin: "local-edit" });
            // Compatibility only. The main Markdown persistence path never
            // supplies this callback, so ordinary typing does not stringify.
            if (callbacksRef.current.onChange) {
              callbacksRef.current.onChange(update.state.doc.toString());
            }
          }),
        ]),
    });
    model.attachView(view);
    view.scrollDOM.dataset.poScrollbar = "content";
    rendererPerformance.recordOperation(
      "editor_base_create",
      performance.now() - editorCreateStartedAt,
    );

    viewRef.current = view;
    findAdapter.attach(view);
    const unbindFormatHotkeys = bindMarkdownFormatHotkeys(view);
    const unsubscribeTypography = subscribeTypographyChanges(host.ownerDocument, () => {
      view.requestMeasure();
    });
    const snapshotPort: EditorSourceSnapshotPort = {
      retainedSource: model,
      prepareDetach: model.prepareDetach,
      setInputEnabled: model.setInputEnabled,
      readSnapshot: model.readSnapshot,
      replaceContent: (content) => {
        externalValueRef.current = content;
        const snapshot = model.replaceContentWithEffects(content, [markdownRevealedSourceEffect.of(null)]);
        return snapshot;
      },
    };
    callbacksRef.current.onSnapshotPortChange?.(snapshotPort);
    const baseRevision = getDocRevision(view.state.doc);
    callbacksRef.current.onSourceRevisionChange?.({
      revision: baseRevision,
      origin: "model-initialization",
    });
    callbacksRef.current.onEditorBaseReady?.(baseRevision);
    if (documentPathRef.current) {
      rendererPerformance.markActiveDocument(documentPathRef.current, "editor_base_ready");
    }

    return () => {
      previewGenerationRef.current += 1;
      unbindFormatHotkeys();
      unsubscribeTypography();
      // Detaching the port synchronously lets the host capture the final
      // snapshot while the CodeMirror document is still alive.
      callbacksRef.current.onSnapshotPortChange?.(null);
      const destroyStartedAt = performance.now();
      findAdapter.dispose();
      model.detachView(view);
      view.destroy();
      rendererPerformance.recordOperation(
        "editor_destroy",
        performance.now() - destroyStartedAt,
      );
      viewRef.current = null;
      modelRef.current = null;
      if (!modelOwner) model.dispose();
    };
  }, [findAdapter, modelOwner]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: editableCompartmentRef.current.reconfigure(getEditableExtensions(readOnly)),
    });
    syncMarkdownEditorCommandAvailability(view);
  }, [readOnly]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: localizationCompartmentRef.current.reconfigure(
        markdownLocalizationExtension(localization, readOnly),
      ),
    });
  }, [localization, readOnly]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return undefined;

    const generation = previewGenerationRef.current;
    let cancelled = false;
    let languageTask: CancellableRendererTask | null = null;
    let planTask: CancellableRendererTask | null = null;
    let previewTask: CancellableRendererTask | null = null;
    let readyFrame: number | null = null;

    const isCurrent = () => (
      !cancelled
      && viewRef.current === view
      && previewGenerationRef.current === generation
    );
    const failPreview = (cause: unknown) => {
      if (!isCurrent()) return;
      const error = toError(cause);
      previewActivatedRef.current = false;
      setPreviewState("error");
      callbacksRef.current.onPreviewError?.(error);
    };
    const confirmPreviewPaint = () => {
      if (!isCurrent()) return;
      const candidateRevision = getDocRevision(view.state.doc);
      readyFrame = window.requestAnimationFrame(() => {
        readyFrame = null;
        if (!isCurrent()) return;
        const paintedRevision = getDocRevision(view.state.doc);
        if (paintedRevision !== candidateRevision) {
          confirmPreviewPaint();
          return;
        }
        setPreviewState("ready");
        callbacksRef.current.onPreviewReady?.(paintedRevision);
        if (documentPathRef.current) {
          rendererPerformance.markActiveDocument(documentPathRef.current, "preview_ready");
        }
      });
    };

    languageTask = scheduleRendererTask(() => {
      languageTask = null;
      if (!isCurrent()) return;
      const languageStartedAt = performance.now();
      try {
        const languageExtension = livePreview
          ? markdownCodeMirrorLanguageExtension(resolvedDialect)
          : [];
        view.dispatch({
          effects: languageCompartmentRef.current.reconfigure(languageExtension),
        });
      } catch (error) {
        if (livePreview) failPreview(error);
        else console.warn("Unable to activate Markdown language support:", error);
        return;
      }
      rendererPerformance.recordOperation(
        "markdown_language_activate",
        performance.now() - languageStartedAt,
      );
      if (documentPathRef.current) {
        rendererPerformance.markActiveDocument(documentPathRef.current, "markdown_language_ready");
      }
      if (!livePreview) return;

      // Plan normalization can be a meaningful share of first-open work for a
      // feature-dense document. Populate the revision/tree-scoped plan cache
      // in its own renderer task so installing the geometry-sensitive
      // projection never combines semantic compilation and DOM decoration in
      // one Long Task. The next task consumes this exact cache entry; a syntax
      // tree or source revision change invalidates it through the index itself.
      planTask = scheduleRendererTask(() => {
        planTask = null;
        if (!isCurrent()) return;
        const planStartedAt = performance.now();
        try {
          getMarkdownPlanIndex(view.state);
        } catch (error) {
          failPreview(error);
          return;
        }
        rendererPerformance.recordOperation(
          "markdown_plan_precompute",
          performance.now() - planStartedAt,
        );

        previewTask = scheduleRendererTask(() => {
          previewTask = null;
          if (!isCurrent()) return;
          const context = livePreviewContextRef.current;
          previewActivatedRef.current = true;
          const previewStartedAt = performance.now();
          try {
            view.dispatch({
              effects: [
                livePreviewContextCompartmentRef.current.reconfigure(
                  markdownLivePreviewContextExtension(
                    context.htmlTrustMode,
                    context.markdownLinkGraph,
                    context.documentPath,
                    context.markdownAssetUrlResolver,
                    context.workspaceId,
                    context.workspaceRoot,
                    context.markdownLinkCommands,
                    context.markdownAssetResolverRevision,
                  ),
                ),
                livePreviewCoreCompartmentRef.current.reconfigure(
                  markdownLivePreviewCoreExtension(resolvedDialect),
                ),
                blockDragCompartmentRef.current.reconfigure(
                  blockDragEnabledRef.current ? markdownBlockDragExtension() : [],
                ),
                headingOutlineCompartmentRef.current.reconfigure(
                  markdownHeadingOutlineExtension(),
                ),
              ],
            });
          } catch (error) {
            failPreview(error);
            return;
          }
          rendererPerformance.recordOperation(
            "markdown_preview_activate",
            performance.now() - previewStartedAt,
          );
          confirmPreviewPaint();
        });
      });
    });

    return () => {
      cancelled = true;
      previewActivatedRef.current = false;
      languageTask?.cancel();
      planTask?.cancel();
      previewTask?.cancel();
      if (readyFrame !== null) window.cancelAnimationFrame(readyFrame);
    };
  }, [documentPath, livePreview, resolvedDialect]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || !livePreview || !previewActivatedRef.current) return;
    view.dispatch({
      effects: blockDragCompartmentRef.current.reconfigure(
        blockDragEnabled ? markdownBlockDragExtension() : [],
      ),
    });
  }, [blockDragEnabled, livePreview]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || !livePreview || !previewActivatedRef.current) return undefined;
    let cancelled = false;
    const frame = window.requestAnimationFrame(() => {
      if (cancelled || viewRef.current !== view || !previewActivatedRef.current) return;
      const context = livePreviewContextRef.current;
      view.dispatch({
        effects: livePreviewContextCompartmentRef.current.reconfigure(
          markdownLivePreviewContextExtension(
            context.htmlTrustMode,
            context.markdownLinkGraph,
            context.documentPath,
            context.markdownAssetUrlResolver,
            context.workspaceId,
            context.workspaceRoot,
            context.markdownLinkCommands,
            context.markdownAssetResolverRevision,
          ),
        ),
      });
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
    };
  }, [
    documentPath,
    htmlTrustMode,
    livePreview,
    markdownAssetResolverRevision,
    markdownLinkCommands,
    markdownLinkGraph?.revision,
    workspaceId,
    workspaceRoot,
  ]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    try {
      view.dispatch({
        effects: aiEditCompartmentRef.current.reconfigure(markdownAiEditExtension(aiEditFile)),
      });
    } catch (error) {
      console.warn("Unable to apply AI edit decorations:", error);
      view.dispatch({
        effects: aiEditCompartmentRef.current.reconfigure([]),
      });
    }
  }, [aiEditFile]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || Object.is(externalValueRef.current, value)) return;
    externalValueRef.current = value;
    // A controlled host can echo the editor's newly persisted bytes back as a
    // prop. Replacing an already-identical CodeMirror document would create a
    // new document revision, rebuild every decoration, and restart async image
    // resolution for no semantic change. Prop convergence is not an external
    // edit; keep the canonical EditorView and its mounted widget sessions.
    if (
      view.state.doc.length === value.length
      && view.state.doc.toString() === value
    ) return;
    modelRef.current?.replaceContentWithEffects(value, [markdownRevealedSourceEffect.of(null)]);
    callbacksRef.current.onSourceRevisionChange?.({
      revision: getDocRevision(view.state.doc),
      origin: "model-initialization",
    });
  }, [value]);

  useLayoutEffect(() => {
    viewRef.current?.requestMeasure();
  }, [appearanceRevision]);

  const previewMessage = previewState === "error"
    ? t("editor.markdown.previewUnavailable")
    : previewState === "pending" && showPendingMessage
      ? t("editor.markdown.preparingPreview")
      : null;

  return (
    <>
      <div
        ref={hostRef}
        dir="auto"
        lang={contentLanguage.language}
        className="markdown-codemirror-editor"
        data-editor-appearance-revision={appearanceRevision}
        data-po-typography-role="content"
        data-po-content-language-source={contentLanguage.source}
        data-live-preview={livePreview ? "true" : "false"}
        data-preview-state={previewState}
        data-preview-message={previewMessage ?? undefined}
        data-readonly={readOnly ? "true" : "false"}
        aria-busy={previewState === "pending"}
      />
      <span
        className="markdown-preview-announcer"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {previewMessage ?? ""}
      </span>
    </>
  );
}

function getEditableExtensions(readOnly: boolean): Extension[] {
  return [
    EditorState.readOnly.of(readOnly),
    EditorView.editable.of(!readOnly),
  ];
}

type CancellableRendererTask = {
  cancel(): void;
};

function scheduleRendererTask(callback: () => void): CancellableRendererTask {
  const schedulerApi = (globalThis as typeof globalThis & {
    scheduler?: {
      postTask(
        task: () => void,
        options?: { priority?: "user-blocking" | "user-visible" | "background"; signal?: AbortSignal },
      ): Promise<unknown>;
    };
  }).scheduler;
  if (schedulerApi?.postTask) {
    const controller = new AbortController();
    let taskStarted = false;
    let fallbackTimeoutId: number | null = null;
    void schedulerApi.postTask(() => {
      taskStarted = true;
      callback();
    }, {
      priority: "user-blocking",
      signal: controller.signal,
    }).catch((error) => {
      if (error instanceof Error && error.name === "AbortError") return;
      if (taskStarted) {
        console.warn("Markdown activation task failed after starting:", error);
        return;
      }
      console.warn("Unable to schedule Markdown activation task; using timer fallback:", error);
      if (controller.signal.aborted) return;
      fallbackTimeoutId = window.setTimeout(callback, 0);
    });
    return {
      cancel: () => {
        controller.abort();
        if (fallbackTimeoutId !== null) window.clearTimeout(fallbackTimeoutId);
      },
    };
  }

  const timeoutId = window.setTimeout(callback, 0);
  return { cancel: () => window.clearTimeout(timeoutId) };
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
