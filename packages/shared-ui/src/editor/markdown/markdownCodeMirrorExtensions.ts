import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { HighlightStyle, bracketMatching, indentOnInput, syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import {
  EditorView,
  ViewPlugin,
  dropCursor,
  highlightSpecialChars,
  keymap,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";
import {
  markdownLivePreviewDecorations,
} from "./core/decorations/livePreviewDecorations";
import { markdownBlockWidgetSelectionExtension } from "./core/interaction/blockWidgetSelection";
import {
  markdownBlockRelocationEffect,
  markdownBlockRelocationHistoryExtension,
} from "./core/commands/markdownBlockMove";
import { markdownEditingKeymap } from "./core/commands/markdownEditingKeymap";
import { markdownLivePreviewContextExtension } from "./core/editor/markdownLivePreviewContext";
import { markdownComposingBlockLineField, markdownInputCompositionExtension } from "./core/state/composingBlockLine";
import { markdownRevealedSourceField } from "./core/state/revealedSource";
import { markdownLivePreviewFocusExtension } from "./core/state/livePreviewFocus";
import { markdownPointerSelectionExtension } from "./core/state/pointerSelection";
import { markdownHeadingIndexField } from "./core/links/markdownHeadingIndex";
import { markdownAssetUrlResolverFacet, markdownWorkspaceRootFacet } from "./core/editor/markdownLivePreviewContext";
import { getMarkdownEmbedHost, disposeMarkdownEmbedHost } from "./platform/codemirror/embedHost";
import {
  markdownInlineViewportContinuityEffect,
  markdownInlineViewportHistoryExtension,
  type EmbeddedInlineViewportTransactionMapping,
} from "./platform/codemirror/embeddedInlineViewportSession";
import { getDocRevision } from "./platform/brokers/transactionBroker";
import {
  markdownHiddenMarkerSelectionNormalizer,
  trailingLineWhitespaceSelectionExtension,
} from "./core/state/selectionBehavior";
import {
  getMarkdownFeatureComposition,
  markdownFeatureCompositionExtension,
} from "./composition/markdownFeatureComposition";
import {
  EMPTY_MARKDOWN_LINK_COMMANDS,
  type MarkdownAssetUrlResolver,
  type MarkdownDialectId,
  type MarkdownHtmlTrustMode,
  type MarkdownLinkCommands,
  type MarkdownLinkGraph,
} from "../registry/viewerTypes";
import {
  DEFAULT_MARKDOWN_DIALECT,
  markdownDialectFacet,
} from "./core/dialect/markdownDialect";

export function markdownCodeMirrorBaseExtensions(
  readOnly: boolean,
  dialect: MarkdownDialectId = DEFAULT_MARKDOWN_DIALECT,
): Extension[] {
  return [
    ...markdownCodeMirrorUrgentExtensions(readOnly),
    markdownCodeMirrorLanguageExtension(dialect),
  ];
}

/**
 * Interaction-critical editor surface. Keep language parsing out of this set:
 * a document must become focusable/editable before Markdown projection work is
 * allowed onto the renderer's task queue.
 */
export function markdownCodeMirrorUrgentExtensions(readOnly: boolean, includeHistory = true): Extension[] {
  return [
    EditorView.editorAttributes.of({ "data-po-selection-renderer": "native" }),
    highlightSpecialChars(),
    ...(includeHistory ? [history()] : []),
    dropCursor(),
    indentOnInput(),
    bracketMatching(),
    EditorView.lineWrapping,
    trailingLineWhitespaceSelectionExtension,
    EditorView.contentAttributes.of({
      spellcheck: "false",
      autocorrect: "off",
      autocapitalize: "off",
    }),
    // Do not install highlightActiveLine(). Its changing line decoration
    // rebuilds inline replacement widgets when a pointer selection crosses
    // lines. Markdown intentionally has no active-line background, and the
    // rebuild would restart image asset/decode lifecycles for no visible gain.
    keymap.of([...markdownEditingKeymap, ...defaultKeymap, ...historyKeymap, indentWithTab]),
    puppyMarkdownEditorTheme,
  ];
}

/** Language parsing and source highlighting are installed after first paint. */
export function markdownCodeMirrorLanguageExtension(
  dialect: MarkdownDialectId = DEFAULT_MARKDOWN_DIALECT,
): Extension {
  const composition = getMarkdownFeatureComposition(dialect);
  return [
    markdownDialectFacet.of(dialect),
    markdownFeatureCompositionExtension(dialect),
    markdown({ base: markdownLanguage, extensions: composition.parserExtensions }),
    syntaxHighlighting(puppyMarkdownHighlightStyle),
  ];
}

export function markdownLivePreviewExtension(
  htmlTrustMode: MarkdownHtmlTrustMode = "safe",
  markdownLinkGraph: MarkdownLinkGraph | null = null,
  documentPath = "",
  markdownAssetUrlResolver: MarkdownAssetUrlResolver | null = null,
  workspaceId = "",
  workspaceRoot: string | null = null,
  dialect: MarkdownDialectId = DEFAULT_MARKDOWN_DIALECT,
  markdownLinkCommands: MarkdownLinkCommands = EMPTY_MARKDOWN_LINK_COMMANDS,
  markdownAssetResolverRevision = 0,
): Extension {
  return [
    markdownLivePreviewContextExtension(
      htmlTrustMode,
      markdownLinkGraph,
      documentPath,
      markdownAssetUrlResolver,
      workspaceId,
      workspaceRoot,
      markdownLinkCommands,
      markdownAssetResolverRevision,
    ),
    markdownLivePreviewCoreExtension(dialect),
  ];
}

export function markdownLivePreviewCoreExtension(
  dialect: MarkdownDialectId = DEFAULT_MARKDOWN_DIALECT,
): Extension {
  const composition = getMarkdownFeatureComposition(dialect);
  return [
    markdownHiddenMarkerSelectionNormalizer,
    markdownPointerSelectionExtension,
    markdownLivePreviewFocusExtension(),
    markdownInputCompositionExtension,
    markdownComposingBlockLineField,
    markdownRevealedSourceField,
    markdownHeadingIndexField,
    ...composition.livePreviewExtensions,
    // History inversion stays in the live-preview core even when the
    // experimental interaction is disabled, so an earlier move can still
    // undo and redo embedded-session relocation safely.
    markdownBlockRelocationHistoryExtension,
    markdownInlineViewportHistoryExtension,
    markdownEmbedHostLifecycle,
    markdownLivePreviewDecorations,
    markdownBlockWidgetSelectionExtension,
  ];
}

const markdownEmbedHostLifecycle = ViewPlugin.fromClass(class {
  private readonly view: EditorView;

  constructor(view: EditorView) {
    this.view = view;
    getMarkdownEmbedHost(view, {
      resolveAssetUrl: view.state.facet(markdownAssetUrlResolverFacet),
      workspaceRoot: view.state.facet(markdownWorkspaceRootFacet),
    });
  }

  update(update: import("@codemirror/view").ViewUpdate) {
    if (!update.docChanged) return;
    const host = getMarkdownEmbedHost(this.view);
    const previousRevision = getDocRevision(update.startState.doc);
    const nextRevision = getDocRevision(update.state.doc);
    // Transactions in one ViewUpdate are sequential. Map sessions through each
    // one in order so a block-move annotation can preserve relative offsets in
    // the relocated source slice instead of collapsing them into the deletion.
    for (const transaction of update.transactions) {
      if (!transaction.docChanged) continue;
      const relocation = transaction.effects.find((effect) => (
        effect.is(markdownBlockRelocationEffect)
      ))?.value;
      if (relocation) {
        host.editSessions.mapRangesWithRelocation(
          relocation,
          (pos, assoc) => transaction.changes.mapPos(pos, assoc),
        );
        host.inlineViewports.mapRangesWithRelocation(
          relocation,
          (pos, assoc) => transaction.changes.mapPos(pos, assoc),
        );
        host.tableColumnLayouts.mapRangesWithRelocation(
          relocation,
          (pos, assoc) => transaction.changes.mapPos(pos, assoc),
        );
      } else {
        host.editSessions.mapRanges((pos, assoc) => transaction.changes.mapPos(pos, assoc));
        const continuities = transaction.effects
          .filter((effect) => effect.is(markdownInlineViewportContinuityEffect))
          .map((effect) => effect.value);
        const tableMapping: EmbeddedInlineViewportTransactionMapping = {
          continuities,
          mapPos: (pos, assoc) => transaction.changes.mapPos(pos, assoc),
          touchesRange: (range) => {
            let touched = false;
            transaction.changes.iterChangedRanges((fromA, toA) => {
              if (touched) return;
              touched = fromA === toA
                ? fromA > range.from && fromA < range.to
                : fromA < range.to && toA > range.from;
            });
            return touched;
          },
        };
        host.inlineViewports.mapTransaction(tableMapping);
        host.tableColumnLayouts.mapTransaction(tableMapping);
      }
    }
    // Executable and native web-embed capabilities are revision-bound. Static
    // asset handles are instead owned by their mounted widget session: an
    // unrelated text edit must not invalidate still-mounted media. The
    // widget's AbortController revokes the handle when its semantic source is
    // replaced or when the view is disposed.
    host.executionSessions.destroyForRevisionChange(previousRevision, nextRevision);
    host.webEmbeds.destroyStaleRevision(host.viewId, nextRevision);
  }

  destroy() {
    disposeMarkdownEmbedHost(this.view);
  }
});

const puppyMarkdownEditorTheme = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "transparent",
    color: "inherit",
  },
  ".cm-scroller": {
    overflow: "auto",
  },
  ".cm-line": {
    // Vertical block spacing token; 0 in source mode, opened up by
    // markdown-editor.css in live preview (see "Vertical rhythm" note).
    padding: "var(--po-markdown-editor-line-spacing, 0px) 0",
  },
  "&.cm-focused": {
    outline: "none",
  },
});

const puppyMarkdownHighlightStyle = HighlightStyle.define([
  { tag: tags.heading, class: "cm-md-syntax-heading" },
  { tag: [tags.heading1, tags.heading2, tags.heading3, tags.heading4, tags.heading5, tags.heading6], class: "cm-md-syntax-heading" },
  { tag: tags.strong, class: "cm-md-syntax-strong" },
  { tag: tags.emphasis, class: "cm-md-syntax-emphasis" },
  { tag: tags.strikethrough, class: "cm-md-syntax-strikethrough" },
  { tag: [tags.link, tags.url], class: "cm-md-syntax-link" },
  { tag: tags.monospace, class: "cm-md-syntax-monospace" },
  { tag: [tags.meta, tags.processingInstruction, tags.punctuation, tags.contentSeparator], class: "cm-md-syntax-markup" },
  { tag: tags.quote, class: "cm-md-syntax-quote" },
  { tag: tags.list, class: "cm-md-syntax-list" },
]);
