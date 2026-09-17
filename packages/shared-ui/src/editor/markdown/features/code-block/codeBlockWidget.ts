import { EditorSelection } from "@codemirror/state";
import { EditorView, WidgetType } from "@codemirror/view";
import { bidiIsolate } from "@puppyone/localization/core";
import { disposeWidgetSessionDom } from "../../platform/codemirror/widgetSession";
import { getMarkdownEmbedHost } from "../../platform/codemirror/embedHost";
import {
  formatMarkdownCodeSourceReference,
  sanitizeCodeLanguage,
  serializeMarkdownCodeBlock,
  type MarkdownCodeSourceReference,
} from "./codeBlockModel";
import { getDocRevision, type CommitResult } from "../../platform/brokers/transactionBroker";
import { estimateCodeBlockLayoutHeight } from "./codeBlockLayout";
import {
  getMappedWidgetSourceRange,
  normalizeLineEndings,
  stopCodeMirrorEvent,
} from "../../shared/widgets/widgetDom";
import { getMarkdownLocalization } from "../../core/editor/markdownLocalization";
import {
  MARKDOWN_RICH_BLOCK_EXECUTION,
  type MarkdownMountedBlockExecution,
} from "../../core/plans/markdownBlockExecution";
import {
  highlightMarkdownCode,
  type MarkdownCodeHighlighter,
  type MarkdownCodeHighlightResult,
} from "./codeBlockHighlight";

/**
 * Immutable descriptor. Mounted listeners and draft commit ownership live in
 * the per-view DOM session, not on this WidgetType instance.
 */
export class CodeBlockWidget extends WidgetType {
  constructor(
    private readonly code: string,
    private readonly language: string,
    private readonly from: number,
    private readonly to: number,
    private readonly sourceReference: MarkdownCodeSourceReference | null = null,
    private readonly layoutEstimatedHeight = estimateCodeBlockLayoutHeight(code),
    private readonly execution: MarkdownMountedBlockExecution = MARKDOWN_RICH_BLOCK_EXECUTION,
    private readonly highlighter: MarkdownCodeHighlighter = highlightMarkdownCode,
  ) {
    super();
  }

  eq(widget: WidgetType): boolean {
    return (
      widget instanceof CodeBlockWidget &&
      widget.code === this.code &&
      widget.language === this.language &&
      widget.from === this.from &&
      widget.to === this.to &&
      widget.layoutEstimatedHeight === this.layoutEstimatedHeight &&
      widget.execution.mode === this.execution.mode &&
      widget.execution.budgetVersion === this.execution.budgetVersion &&
      widget.highlighter === this.highlighter &&
      codeSourceReferencesEqual(widget.sourceReference, this.sourceReference)
    );
  }

  get estimatedHeight(): number {
    return this.layoutEstimatedHeight;
  }

  toDOM(view: EditorView): HTMLElement {
    const { direction, t } = getMarkdownLocalization(view);
    const host = getMarkdownEmbedHost(view);
    const wrapper = document.createElement("div");
    wrapper.className = "cm-md-code-widget";
    wrapper.dir = direction;
    const panel = document.createElement("div");
    panel.className = "cm-md-code-panel";
    const readOnly = view.state.readOnly;
    const sourceLength = Math.max(0, this.to - this.from);
    const baseSource = view.state.sliceDoc(this.from, this.to);
    const baseRevision = getDocRevision(view.state.doc);
    const initialSession = readOnly
      ? null
      : host.editSessions.acquire({
          featureId: "codeBlock",
          mappedRange: { from: this.from, to: this.to },
          baseSource,
          baseRevision,
          draft: { code: this.code, language: this.language },
          mode: "editing",
        });
    const recoveredDraft = readCodeBlockDraft(initialSession?.draft, {
      code: this.code,
      language: this.language,
    });
    let elementId = initialSession?.elementId ?? null;
    let committed = false;
    let skipBlurCommit = false;

    const header = document.createElement("div");
    header.className = "cm-md-code-header";

    const languageInput = document.createElement("input");
    languageInput.className = "cm-md-code-language";
    if (!recoveredDraft.language) languageInput.classList.add("is-empty");
    languageInput.value = recoveredDraft.language;
    languageInput.placeholder = t("editor.markdown.code.languagePlaceholder");
    languageInput.setAttribute("aria-label", t("editor.markdown.code.language"));
    languageInput.readOnly = readOnly;
    languageInput.spellcheck = false;
    languageInput.dir = "ltr";

    if (this.sourceReference) {
      header.classList.add("has-source-reference");
      const sourceReference = document.createElement("span");
      const sourceReferenceText = formatMarkdownCodeSourceReference(this.sourceReference);
      sourceReference.className = "cm-md-code-source-reference";
      sourceReference.textContent = sourceReferenceText;
      sourceReference.title = sourceReferenceText;
      sourceReference.setAttribute(
        "aria-label",
        t("editor.markdown.code.source", { source: bidiIsolate(sourceReferenceText) }),
      );
      header.append(sourceReference, languageInput);
    } else {
      header.appendChild(languageInput);
    }

    const codeSurface = document.createElement("div");
    codeSurface.className = "cm-md-code-surface";
    codeSurface.dir = "ltr";
    const codeHighlight = document.createElement("pre");
    codeHighlight.className = "cm-md-code-highlight";
    codeHighlight.setAttribute("aria-hidden", "true");
    const codeEditor = document.createElement("textarea");
    codeEditor.className = "cm-md-code-textarea";
    codeEditor.dataset.poScrollbar = "horizontal";
    codeEditor.value = recoveredDraft.code;
    codeEditor.readOnly = readOnly;
    codeEditor.spellcheck = false;
    codeEditor.wrap = "off";
    codeEditor.dir = "ltr";
    codeEditor.rows = Math.max(1, recoveredDraft.code.split("\n").length);

    let highlightRequest = 0;
    let highlightFrame: number | null = null;
    let highlightDisposed = false;
    let highlightSuppression: Readonly<{
      languageLabel: string;
      sourceLength: number;
      result: MarkdownCodeHighlightResult;
    }> | null = null;
    const applyHighlightMetadata = (result: MarkdownCodeHighlightResult) => {
      codeHighlight.dataset.language = result.language;
      if (result.fallbackReason) {
        codeHighlight.dataset.highlightFallback = result.fallbackReason;
      } else {
        delete codeHighlight.dataset.highlightFallback;
      }
      codeSurface.style.setProperty("--cm-md-code-tab-size", String(result.tabSize));
    };
    const refreshHighlight = (request: number) => {
      const code = normalizeLineEndings(codeEditor.value);
      const languageLabel = languageInput.value.trim().toLowerCase();
      codeHighlight.textContent = code;
      codeSurface.classList.remove("is-highlighted");
      if (
        highlightSuppression
        && highlightSuppression.languageLabel === languageLabel
        && code.length >= Math.max(1, Math.floor(highlightSuppression.sourceLength / 2))
      ) {
        applyHighlightMetadata(highlightSuppression.result);
        return;
      }
      highlightSuppression = null;
      void this.highlighter(code, languageInput.value, {
        isCurrent: () => !highlightDisposed && request === highlightRequest,
      }).then((result) => {
        if (!result || highlightDisposed || request !== highlightRequest) return;
        if (result.fallbackReason === "parse-budget" || result.fallbackReason === "dom-budget") {
          highlightSuppression = { languageLabel, sourceLength: code.length, result };
        } else {
          highlightSuppression = null;
        }
        const fragment = codeHighlight.ownerDocument.createDocumentFragment();
        for (const segment of result.segments) {
          if (!segment.className) {
            fragment.appendChild(codeHighlight.ownerDocument.createTextNode(segment.text));
            continue;
          }
          const token = codeHighlight.ownerDocument.createElement("span");
          token.className = segment.className;
          token.textContent = segment.text;
          fragment.appendChild(token);
        }
        codeHighlight.replaceChildren(fragment);
        applyHighlightMetadata(result);
        codeSurface.classList.toggle(
          "is-highlighted",
          result.segments.some((segment) => segment.className !== null),
        );
      }).catch(() => {
        if (!highlightDisposed && request === highlightRequest) {
          codeSurface.classList.remove("is-highlighted");
        }
      });
    };
    const scheduleHighlightRefresh = (immediate = false) => {
      const request = ++highlightRequest;
      const ownerWindow = codeSurface.ownerDocument.defaultView;
      if (immediate || !ownerWindow) {
        if (highlightFrame !== null) {
          ownerWindow?.cancelAnimationFrame(highlightFrame);
          highlightFrame = null;
        }
        refreshHighlight(request);
        return;
      }
      if (highlightFrame !== null) return;
      highlightFrame = ownerWindow.requestAnimationFrame(() => {
        highlightFrame = null;
        refreshHighlight(highlightRequest);
      });
    };
    scheduleHighlightRefresh(true);

    const ensureSession = () => {
      const existing = elementId ? host.editSessions.get(elementId) : undefined;
      if (existing) return existing;
      const mappedRange = getMappedWidgetSourceRange(view, wrapper, sourceLength);
      if (!mappedRange) return null;
      const session = host.editSessions.acquire({
        featureId: "codeBlock",
        mappedRange,
        baseSource: view.state.sliceDoc(mappedRange.from, mappedRange.to),
        baseRevision: getDocRevision(view.state.doc),
        draft: {
          code: normalizeLineEndings(codeEditor.value),
          language: languageInput.value,
        },
        mode: "editing",
      });
      elementId = session.elementId;
      return session;
    };

    const syncDraft = () => {
      const session = ensureSession();
      if (!session) return;
      host.editSessions.update(session.elementId, {
        draft: {
          code: normalizeLineEndings(codeEditor.value),
          language: languageInput.value,
        },
        mode: "editing",
        lifecycle: "mounted",
      });
    };

    const commit = (options: { finish?: boolean; selection?: "start" | "end" } = {}): CommitResult | null => {
      if (committed || readOnly) return null;
      const session = ensureSession();
      if (!session) return null;
      committed = true;
      const language = sanitizeCodeLanguage(languageInput.value);
      const code = normalizeLineEndings(codeEditor.value);
      const nextSource = serializeMarkdownCodeBlock(language, code, {
        sourceReference: this.sourceReference,
      });
      if (language === this.language && code === this.code) {
        const mappedRange = session.mappedRange;
        if (options.finish) host.editSessions.complete(session.elementId);
        if (options.selection) {
          const position = options.selection === "start" ? mappedRange.from : mappedRange.to;
          view.dispatch({ selection: EditorSelection.cursor(position) });
        }
        committed = false;
        return { ok: true, mappedTo: mappedRange };
      }

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
        // Conflict with external/Agent edit: keep draft visible, allow retry.
        host.editSessions.markConflicted(session.elementId);
        committed = false;
      }
      return result;
    };

    const cancelDraft = () => {
      if (elementId) host.editSessions.cancel(elementId);
      elementId = null;
      languageInput.value = this.language;
      languageInput.classList.toggle("is-empty", !this.language.trim());
      codeEditor.value = this.code;
      codeEditor.rows = Math.max(1, this.code.split("\n").length);
      scheduleHighlightRefresh(true);
      committed = false;
      skipBlurCommit = true;
    };

    const onLanguageKeyDown = (event: KeyboardEvent) => {
      event.stopPropagation();
      if (event.key === "Enter") {
        event.preventDefault();
        languageInput.blur();
      }
      if (event.key === "Escape") {
        event.preventDefault();
        cancelDraft();
        languageInput.blur();
      }
    };
    const onCodeKeyDown = (event: KeyboardEvent) => {
      event.stopPropagation();
      if (event.key === "ArrowUp" && codeEditor.selectionStart === 0 && codeEditor.selectionEnd === 0) {
        event.preventDefault();
        const result = commit({ finish: true, selection: "start" });
        if (result?.ok) view.focus();
        return;
      }
      if (
        event.key === "ArrowDown" &&
        codeEditor.selectionStart === codeEditor.value.length &&
        codeEditor.selectionEnd === codeEditor.value.length
      ) {
        event.preventDefault();
        const result = commit({ finish: true, selection: "end" });
        if (result?.ok) view.focus();
        return;
      }
      if (
        event.key === "Backspace" &&
        !codeEditor.value &&
        codeEditor.selectionStart === 0 &&
        codeEditor.selectionEnd === 0
      ) {
        event.preventDefault();
        committed = true;
        const session = ensureSession();
        if (!session) {
          committed = false;
          return;
        }
        const deleteFrom = session.mappedRange.from;
        const result = host.transactions.commit(view, {
          mappedRange: session.mappedRange,
          baseSource: session.baseSource,
          baseRevision: session.baseRevision,
          nextSource: "",
          selection: { from: deleteFrom, to: deleteFrom },
          rebase: "if-source-unchanged",
        });
        if (result.ok) {
          host.editSessions.complete(session.elementId);
          view.focus();
        } else {
          host.editSessions.markConflicted(session.elementId);
          committed = false;
        }
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        cancelDraft();
        codeEditor.blur();
      }
    };

    const onLanguageInput = () => {
      languageInput.classList.toggle("is-empty", !languageInput.value.trim());
      committed = false;
      syncDraft();
      scheduleHighlightRefresh();
    };
    const onCodeInput = () => {
      codeEditor.rows = Math.max(1, codeEditor.value.split("\n").length);
      committed = false;
      syncDraft();
      scheduleHighlightRefresh();
    };
    const onCodeScroll = () => {
      codeHighlight.scrollLeft = codeEditor.scrollLeft;
    };
    const onBlur = (event: FocusEvent) => {
      const nextTarget = event.relatedTarget;
      if (nextTarget instanceof Node && panel.contains(nextTarget)) return;
      if (skipBlurCommit) {
        skipBlurCommit = false;
        return;
      }
      if (!readOnly) commit();
    };

    languageInput.addEventListener("mousedown", stopCodeMirrorEvent);
    languageInput.addEventListener("click", stopCodeMirrorEvent);
    languageInput.addEventListener("keydown", onLanguageKeyDown);
    languageInput.addEventListener("input", onLanguageInput);
    languageInput.addEventListener("blur", onBlur);
    codeEditor.addEventListener("mousedown", stopCodeMirrorEvent);
    codeEditor.addEventListener("click", stopCodeMirrorEvent);
    codeEditor.addEventListener("keydown", onCodeKeyDown);
    codeEditor.addEventListener("input", onCodeInput);
    codeEditor.addEventListener("scroll", onCodeScroll);
    codeEditor.addEventListener("blur", onBlur);

    codeSurface.append(codeHighlight, codeEditor);
    panel.append(header, codeSurface);
    wrapper.appendChild(panel);

    host.sessions.mount(wrapper, () => ({
      dispose() {
        highlightDisposed = true;
        highlightRequest += 1;
        if (highlightFrame !== null) {
          codeSurface.ownerDocument.defaultView?.cancelAnimationFrame(highlightFrame);
          highlightFrame = null;
        }
        languageInput.removeEventListener("keydown", onLanguageKeyDown);
        languageInput.removeEventListener("input", onLanguageInput);
        languageInput.removeEventListener("blur", onBlur);
        codeEditor.removeEventListener("keydown", onCodeKeyDown);
        codeEditor.removeEventListener("input", onCodeInput);
        codeEditor.removeEventListener("scroll", onCodeScroll);
        codeEditor.removeEventListener("blur", onBlur);
        if (elementId) host.editSessions.detach(elementId);
      },
    }));

    return wrapper;
  }

  destroy(dom: HTMLElement) {
    disposeWidgetSessionDom(dom);
  }

  ignoreEvent() {
    return true;
  }
}

type CodeBlockDraft = {
  code: string;
  language: string;
};

function readCodeBlockDraft(value: unknown, fallback: CodeBlockDraft): CodeBlockDraft {
  if (!value || typeof value !== "object") return fallback;
  const candidate = value as Partial<CodeBlockDraft>;
  return {
    code: typeof candidate.code === "string" ? candidate.code : fallback.code,
    language: typeof candidate.language === "string" ? candidate.language : fallback.language,
  };
}

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
