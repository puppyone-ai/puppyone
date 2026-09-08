import { EditorSelection } from "@codemirror/state";
import { EditorView, WidgetType } from "@codemirror/view";
import { bidiIsolate } from "@puppyone/localization/core";
import { getMarkdownEmbedHost } from "../../platform/codemirror/embedHost";
import { disposeWidgetSessionDom } from "../../platform/codemirror/widgetSession";
import { MARKDOWN_HTML_PROFILE_VERSION } from "../../platform/policy/markdownHtmlProfiles";
import {
  serializeMarkdownCodeBlock,
  type MarkdownCodeSourceReference,
} from "../code-block/codeBlockModel";
import {
  getMermaidThemeSnapshot,
  mountSanitizedMermaidSvg,
  renderMermaidDiagram,
  subscribeMermaidThemeChanges,
  type MermaidRenderResult,
} from "./mermaidRenderer";
import { MarkdownWidgetMeasureController } from "../../platform/codemirror/layoutCoordinator";
import { estimateMermaidLayoutHeight } from "../code-block/codeBlockLayout";
import { getDocRevision, type CommitResult } from "../../platform/brokers/transactionBroker";
import { createPrincipalFromView, openMarkdownHref } from "../../core/editor/markdownLivePreviewContext";
import {
  getMappedWidgetSourceRange,
  normalizeLineEndings,
  stopCodeMirrorEvent,
} from "../../shared/widgets/widgetDom";
import {
  getMarkdownLocalization,
  type MarkdownLocalization,
} from "../../core/editor/markdownLocalization";
import {
  MARKDOWN_RICH_BLOCK_EXECUTION,
  type MarkdownMountedBlockExecution,
} from "../../core/plans/markdownBlockExecution";

/**
 * Immutable Mermaid descriptor. Debounce, theme subscription, measure, and
 * async render cancellation belong to the DOM session.
 */
export class MermaidBlockWidget extends WidgetType {
  constructor(
    private readonly code: string,
    private readonly language: string,
    private readonly from: number,
    private readonly to: number,
    private readonly sourceReference: MarkdownCodeSourceReference | null = null,
    private readonly layoutEstimatedHeight = estimateMermaidLayoutHeight(code),
    private readonly execution: MarkdownMountedBlockExecution = MARKDOWN_RICH_BLOCK_EXECUTION,
  ) {
    super();
  }

  eq(widget: WidgetType): boolean {
    return (
      widget instanceof MermaidBlockWidget &&
      widget.code === this.code &&
      widget.language === this.language &&
      widget.from === this.from &&
      widget.to === this.to &&
      widget.layoutEstimatedHeight === this.layoutEstimatedHeight &&
      widget.execution.mode === this.execution.mode &&
      widget.execution.budgetVersion === this.execution.budgetVersion &&
      codeSourceReferencesEqual(widget.sourceReference, this.sourceReference)
    );
  }

  get estimatedHeight(): number {
    return this.layoutEstimatedHeight;
  }

  toDOM(view: EditorView): HTMLElement {
    const { direction, t } = getMarkdownLocalization(view);
    const host = getMarkdownEmbedHost(view);
    const shell = document.createElement("div");
    shell.className = "cm-md-mermaid-widget";
    shell.dir = direction;
    const readOnly = view.state.readOnly;
    const measure = new MarkdownWidgetMeasureController(host.layout);
    const sourceLength = Math.max(0, this.to - this.from);
    const elementKey = `${this.from}:${this.to}`;
    const baseSource = view.state.sliceDoc(this.from, this.to);
    const recoveryKey = {
      featureId: "mermaid",
      mappedRange: { from: this.from, to: this.to },
      baseSource,
    };
    const recoverableSession = readOnly ? undefined : host.editSessions.findRecoverable(recoveryKey);
    let editSessionId = recoverableSession?.elementId ?? null;
    const recoveredDraft = readMermaidDraft(recoverableSession?.draft, {
      code: this.code,
      language: this.language,
    });

    let editing = !readOnly && recoverableSession?.mode === "editing";
    let committed = false;
    let draftCode = recoveredDraft.code;
    let lastGoodSvg: string | null = null;
    let textarea: HTMLTextAreaElement | null = null;
    let debounceTimer: number | null = null;
    let renderGeneration = 0;
    let activeRenderExecutionSessionId: string | null = null;
    let activated = this.execution.mode !== "deferred";

    const toolbar = document.createElement("div");
    toolbar.className = "cm-md-mermaid-toolbar";
    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.className = "cm-md-mermaid-action";
    toolbar.appendChild(editButton);

    const body = document.createElement("div");
    body.className = "cm-md-mermaid-body";
    const preview = document.createElement("div");
    preview.className = "cm-md-mermaid-preview is-loading";
    preview.dataset.poScrollbar = "content";
    const errorStrip = document.createElement("div");
    errorStrip.className = "cm-md-mermaid-error";
    errorStrip.hidden = true;

    const clearDebounce = () => {
      if (debounceTimer !== null) {
        window.clearTimeout(debounceTimer);
        debounceTimer = null;
      }
    };

    const ensureEditSession = (mode: "preview" | "editing" = editing ? "editing" : "preview") => {
      const existing = editSessionId ? host.editSessions.get(editSessionId) : undefined;
      if (existing) return existing;
      const mappedRange = getMappedWidgetSourceRange(view, shell, sourceLength);
      if (!mappedRange) return null;
      const session = host.editSessions.acquire({
        featureId: "mermaid",
        mappedRange,
        baseSource: view.state.sliceDoc(mappedRange.from, mappedRange.to),
        baseRevision: getDocRevision(view.state.doc),
        draft: { code: draftCode, language: this.language },
        mode,
      });
      editSessionId = session.elementId;
      return session;
    };

    const syncDraft = () => {
      const session = ensureEditSession("editing");
      if (!session) return;
      host.editSessions.update(session.elementId, {
        draft: { code: draftCode, language: this.language },
        mode: "editing",
        lifecycle: "mounted",
      });
    };

    const commit = (options: { focus?: boolean; selection?: "start" | "end" } = {}): CommitResult | null => {
      if (committed || readOnly) return null;
      const session = ensureEditSession("editing");
      if (!session) return null;
      committed = true;
      const nextCode = normalizeLineEndings(textarea?.value ?? draftCode);
      if (nextCode === this.code) {
        editing = false;
        host.editSessions.complete(session.elementId);
        committed = false;
        if (options.selection) {
          const position = options.selection === "start"
            ? session.mappedRange.from
            : session.mappedRange.to;
          view.dispatch({ selection: EditorSelection.cursor(position) });
        }
        renderSurface();
        if (options.focus) view.focus();
        return { ok: true, mappedTo: session.mappedRange };
      }

      const nextSource = serializeMarkdownCodeBlock(this.language || "mermaid", nextCode, {
        sourceReference: this.sourceReference,
      });
      const nextTo = session.mappedRange.from + nextSource.length;
      const selectionPosition = options.selection === "start"
        ? session.mappedRange.from
        : options.selection === "end" ? nextTo : null;
      const result = host.transactions.commit(view, {
        mappedRange: session.mappedRange,
        baseSource: session.baseSource,
        baseRevision: session.baseRevision,
        nextSource,
        rebase: "if-source-unchanged",
        selection: selectionPosition == null
          ? undefined
          : { from: selectionPosition, to: selectionPosition },
      });
      if (result.ok) {
        host.editSessions.complete(session.elementId);
      } else {
        host.editSessions.markConflicted(session.elementId);
        committed = false;
      }
      if (options.focus && result.ok) view.focus();
      return result;
    };

    const cancelEdit = (options: { focus?: boolean } = {}) => {
      if (editSessionId) host.editSessions.cancel(editSessionId);
      editSessionId = null;
      draftCode = this.code;
      editing = false;
      committed = false;
      renderSurface();
      if (options.focus) view.focus();
    };

    const disposeActiveRender = () => {
      const id = activeRenderExecutionSessionId;
      if (!id) return;
      activeRenderExecutionSessionId = null;
      host.executionSessions.get(id)?.dispose();
    };

    const runRender = (source: string) => {
      disposeActiveRender();
      const theme = getMermaidThemeSnapshot(view.dom);
      const generation = ++renderGeneration;
      let abortKey = "";
      const executionSession = host.executionSessions.create({
        principal: createPrincipalFromView(view, "async-render"),
        documentRevision: getDocRevision(view.state.doc),
        featureId: "mermaid-render",
        onDispose: () => {
          if (abortKey) host.asyncRender.abort(abortKey);
          if (activeRenderExecutionSessionId === executionSession.id) {
            activeRenderExecutionSessionId = null;
            renderGeneration += 1;
          }
        },
      });
      activeRenderExecutionSessionId = executionSession.id;
      const renderKey = {
        featureId: "mermaid",
        elementKey,
        source,
        themeKey: theme.key,
        policyVersion: MARKDOWN_HTML_PROFILE_VERSION,
        principalKey: `${host.viewId}:${executionSession.id}`,
      };
      abortKey = [
        renderKey.featureId,
        renderKey.elementKey,
        renderKey.source,
        renderKey.themeKey,
        renderKey.policyVersion,
        renderKey.principalKey,
      ].join("\u0000");
      void host.asyncRender
        .run({
          key: renderKey,
          principal: executionSession.principal,
          run: async () => renderMermaidDiagram({ source, theme }),
        })
        .then((result) => {
          if (!host.executionSessions.get(executionSession.id)) return;
          if (!result || generation !== renderGeneration || !shell.isConnected) {
            executionSession.dispose();
            return;
          }
          lastGoodSvg = result.value.svg;
          setMermaidPreviewSvg(preview, result.value, (href) => openMarkdownHref(href, view));
          errorStrip.hidden = true;
          errorStrip.textContent = "";
          removeMermaidSourceFallback(preview);
          measure.schedule();
          executionSession.dispose();
        })
        .catch((error: unknown) => {
          if (!host.executionSessions.get(executionSession.id)) return;
          if (generation !== renderGeneration || !shell.isConnected) {
            executionSession.dispose();
            return;
          }
          preview.classList.remove("is-loading");
          showMermaidError(errorStrip, error instanceof Error ? error : new Error(String(error)), t);
          if (lastGoodSvg) mountMermaidPreviewSvg(preview, lastGoodSvg, (href) => openMarkdownHref(href, view));
          else preview.replaceChildren(createMermaidSourceFallback(source, t));
          measure.schedule();
          executionSession.dispose();
        });
    };

    const renderPreview = (delayMs: number) => {
      const source = textarea?.value ?? draftCode;
      if (!activated && !editing) {
        clearDebounce();
        disposeActiveRender();
        preview.classList.remove("is-loading");
        preview.replaceChildren(createDeferredMermaidPlaceholder(t, () => {
          activated = true;
          renderPreview(0);
        }));
        return;
      }
      if (!lastGoodSvg) {
        preview.classList.add("is-loading");
        preview.replaceChildren(createMermaidLoadingElement(t));
      }
      clearDebounce();
      if (delayMs <= 0) {
        runRender(source);
        return;
      }
      debounceTimer = window.setTimeout(() => {
        debounceTimer = null;
        runRender(source);
      }, delayMs);
    };

    const openEditor = () => {
      if (readOnly || editing) return;
      const session = ensureEditSession("editing");
      if (!session) return;
      activated = true;
      editing = true;
      committed = false;
      draftCode = textarea?.value ?? draftCode;
      host.editSessions.update(session.elementId, {
        draft: { code: draftCode, language: this.language },
        mode: "editing",
        lifecycle: "mounted",
      });
      renderSurface();
      textarea?.focus();
    };

    const renderSurface = () => {
      shell.replaceChildren();
      body.replaceChildren();

      editButton.textContent = editing
        ? t("editor.markdown.mermaid.done")
        : t("editor.markdown.mermaid.edit");
      editButton.setAttribute(
        "aria-label",
        editing
          ? t("editor.markdown.mermaid.finishEditing")
          : t("editor.markdown.mermaid.editDiagram"),
      );
      editButton.hidden = readOnly;
      editButton.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (editing) commit({ focus: true });
        else openEditor();
      };

      if (!readOnly) shell.appendChild(toolbar);

      if (editing) {
        preview.onclick = (event) => {
          event.stopPropagation();
        };
        textarea = document.createElement("textarea");
        textarea.className = "cm-md-mermaid-source";
        textarea.dataset.poScrollbar = "content";
        textarea.dir = "ltr";
        textarea.value = draftCode;
        textarea.spellcheck = false;
        textarea.rows = Math.max(4, draftCode.split("\n").length);
        textarea.addEventListener("mousedown", stopCodeMirrorEvent);
        textarea.addEventListener("click", stopCodeMirrorEvent);
        textarea.addEventListener("input", (event) => {
          event.stopPropagation();
          draftCode = textarea?.value ?? draftCode;
          committed = false;
          syncDraft();
          renderPreview(250);
        });
        textarea.addEventListener("keydown", (event) => {
          event.stopPropagation();
          const activeTextarea = textarea;
          if (!activeTextarea) return;
          if (event.key === "ArrowUp" && activeTextarea.selectionStart === 0 && activeTextarea.selectionEnd === 0) {
            event.preventDefault();
            const result = commit({ selection: "start" });
            if (result?.ok) view.focus();
            return;
          }
          if (
            event.key === "ArrowDown" &&
            activeTextarea.selectionStart === activeTextarea.value.length &&
            activeTextarea.selectionEnd === activeTextarea.value.length
          ) {
            event.preventDefault();
            const result = commit({ selection: "end" });
            if (result?.ok) view.focus();
            return;
          }
          if (event.key === "Escape") {
            event.preventDefault();
            cancelEdit({ focus: true });
          }
        });
        textarea.addEventListener("blur", (event) => {
          const nextTarget = event.relatedTarget;
          if (nextTarget instanceof Node && shell.contains(nextTarget)) return;
          commit();
        });

        body.classList.add("is-editing");
        body.append(textarea, preview, errorStrip);
      } else {
        textarea = null;
        body.classList.remove("is-editing");
        preview.onclick = (event) => {
          event.preventDefault();
          event.stopPropagation();
          openEditor();
        };
        body.append(preview, errorStrip);
      }

      shell.appendChild(body);
      renderPreview(0);
      measure.schedule();
    };

    renderSurface();
    measure.observe(shell);
    const unsubscribeTheme = subscribeMermaidThemeChanges(() => {
      renderPreview(0);
      measure.schedule();
    });

    host.sessions.mount(shell, () => ({
      dispose() {
        clearDebounce();
        disposeActiveRender();
        renderGeneration += 1;
        measure.destroy();
        unsubscribeTheme();
        if (editSessionId) host.editSessions.detach(editSessionId);
      },
    }));

    return shell;
  }

  destroy(dom: HTMLElement) {
    disposeWidgetSessionDom(dom);
  }

  ignoreEvent() {
    return true;
  }
}

type MermaidDraft = {
  code: string;
  language: string;
};

function codeSourceReferencesEqual(
  left: MarkdownCodeSourceReference | null,
  right: MarkdownCodeSourceReference | null,
): boolean {
  return left === right || (
    left !== null &&
    right !== null &&
    left.path === right.path &&
    left.startLine === right.startLine &&
    left.endLine === right.endLine
  );
}

function readMermaidDraft(value: unknown, fallback: MermaidDraft): MermaidDraft {
  if (!value || typeof value !== "object") return fallback;
  const candidate = value as Partial<MermaidDraft>;
  return {
    code: typeof candidate.code === "string" ? candidate.code : fallback.code,
    language: typeof candidate.language === "string" ? candidate.language : fallback.language,
  };
}

function setMermaidPreviewSvg(
  preview: HTMLElement,
  result: MermaidRenderResult,
  openHref: (href: string) => void,
) {
  preview.classList.remove("is-loading");
  preview.dataset.mermaidCacheKey = result.cacheKey;
  mountMermaidPreviewSvg(preview, result.svg, openHref);
}

function mountMermaidPreviewSvg(
  preview: HTMLElement,
  svg: string,
  openHref: (href: string) => void,
) {
  const mount = mountSanitizedMermaidSvg(preview, svg, openHref);
  mount.element.classList.add("cm-md-mermaid-svg-root");
}

function showMermaidError(
  errorStrip: HTMLElement,
  error: Error,
  t: MarkdownLocalization["t"],
) {
  errorStrip.hidden = false;
  errorStrip.textContent = error.message
    ? t("editor.markdown.mermaid.renderFailedDetail", { detail: bidiIsolate(error.message) })
    : t("editor.markdown.mermaid.renderFailed");
}

function createMermaidLoadingElement(t: MarkdownLocalization["t"]): HTMLElement {
  const loading = document.createElement("div");
  loading.className = "cm-md-mermaid-loading";
  loading.textContent = t("editor.markdown.mermaid.rendering");
  return loading;
}

function createDeferredMermaidPlaceholder(
  t: MarkdownLocalization["t"],
  onActivate: () => void,
): HTMLElement {
  const placeholder = document.createElement("div");
  placeholder.className = "cm-md-mermaid-deferred";

  const label = document.createElement("span");
  label.textContent = t("editor.markdown.mermaid.largePreviewPaused");

  const button = document.createElement("button");
  button.type = "button";
  button.className = "cm-md-mermaid-action";
  button.textContent = t("editor.markdown.mermaid.renderDiagram");
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onActivate();
  }, { once: true });

  placeholder.append(label, button);
  return placeholder;
}

function createMermaidSourceFallback(
  source: string,
  t: MarkdownLocalization["t"],
): HTMLElement {
  const fallback = document.createElement("pre");
  fallback.className = "cm-md-mermaid-source-fallback";
  fallback.dataset.poScrollbar = "content";
  fallback.dir = "ltr";
  const code = document.createElement("code");
  code.textContent = source || t("editor.markdown.mermaid.empty");
  fallback.appendChild(code);
  return fallback;
}

function removeMermaidSourceFallback(preview: HTMLElement) {
  preview.querySelector(".cm-md-mermaid-source-fallback")?.remove();
}
