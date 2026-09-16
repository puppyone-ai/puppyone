"use client";

import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, historyKeymap, indentWithTab } from "@codemirror/commands";
import {
  foldGutter,
  foldKeymap,
  bracketMatching,
  indentOnInput,
  syntaxHighlighting,
} from "@codemirror/language";
import { highlightSelectionMatches } from "@codemirror/search";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import {
  crosshairCursor,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  highlightTrailingWhitespace,
  keymap,
  lineNumbers,
  rectangularSelection,
} from "@codemirror/view";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { subscribeTypographyChanges } from "../../../core/typography";
import { CodeMirrorFindAdapter } from "../../find/codeMirrorFindAdapter";
import { useRegisterEditorFindAdapter } from "../../find/editorFind";
import { puppyCodeHighlightStyle } from "../../code/codeHighlightStyle";
import { codeIndentGuides } from "./codeIndentGuides";
import {
  loadCodeLanguageExtension,
  resolveCodeLanguageKey,
} from "../../code/codeLanguageSupport";
import type {
  EditorSourceRevision,
  EditorSourceSnapshotPort,
} from "../../sourceSnapshot";

import { useDocumentModelOwner } from "../../document-session/DocumentModelOwner";
import { CodeMirrorDocumentModel, externalDocumentUpdate, getCodeMirrorDocumentRevision as getCodeDocumentRevision } from "../../document-session/CodeMirrorDocumentModel";

export type CodeMirrorCodeEditorProps = {
  content: string;
  nodeName?: string;
  language?: string | null;
  readOnly?: boolean;
  onChange?: (content: string) => void;
  onSourceRevisionChange?: (revision: EditorSourceRevision) => void;
  onSnapshotPortChange?: (port: EditorSourceSnapshotPort | null) => void;
};

export function CodeMirrorCodeEditor({
  content,
  nodeName = "",
  language = null,
  readOnly = true,
  onChange,
  onSourceRevisionChange,
  onSnapshotPortChange,
}: CodeMirrorCodeEditorProps) {
  const modelOwner = useDocumentModelOwner();
  const modelRef = useRef<CodeMirrorDocumentModel | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const languageCompartmentRef = useRef(new Compartment());
  const readOnlyCompartmentRef = useRef(new Compartment());
  const callbacksRef = useRef({ onChange, onSnapshotPortChange, onSourceRevisionChange });
  const readOnlyRef = useRef(readOnly);
  const externalContentRef = useRef(content);
  const languageKey = useMemo(() => resolveCodeLanguageKey(language, nodeName), [language, nodeName]);
  const findAdapter = useMemo(() => new CodeMirrorFindAdapter(), []);
  const initialEditorConfigRef = useRef({ content, languageKey, nodeName, readOnly });

  useRegisterEditorFindAdapter(findAdapter);

  useEffect(() => {
    callbacksRef.current = { onChange, onSnapshotPortChange, onSourceRevisionChange };
  }, [onChange, onSnapshotPortChange, onSourceRevisionChange]);

  useEffect(() => {
    readOnlyRef.current = readOnly;
  }, [readOnly]);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const initialConfig = initialEditorConfigRef.current;

    const model = modelOwner?.getOrCreate("codemirror-code", () => new CodeMirrorDocumentModel(initialConfig.content))
      ?? new CodeMirrorDocumentModel(initialConfig.content);
    modelOwner?.activate(model);
    modelRef.current = model;
    const state = model.createViewState([
        lineNumbers(),
        foldGutter({ openText: "⌄", closedText: "›" }),
        highlightSpecialChars(),
        highlightActiveLineGutter(),
        drawSelection(),
        dropCursor(),
        EditorState.allowMultipleSelections.of(true),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        rectangularSelection(),
        crosshairCursor(),
        highlightActiveLine(),
        highlightSelectionMatches({ minSelectionLength: 2 }),
        highlightTrailingWhitespace(),
        codeIndentGuides,
        syntaxHighlighting(puppyCodeHighlightStyle),
        findAdapter.extension,
        keymap.of([
          indentWithTab,
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...historyKeymap,
          ...foldKeymap,
        ]),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged || readOnlyRef.current) return;
          if (update.transactions.some((transaction) => transaction.annotation(externalDocumentUpdate))) return;
          callbacksRef.current.onSourceRevisionChange?.({
            revision: getCodeDocumentRevision(update.state.doc),
            origin: "local-edit",
          });
          // Compatibility for controlled hosts. The built-in code viewer uses
          // the snapshot port so ordinary typing does not stringify the file.
          callbacksRef.current.onChange?.(update.state.doc.toString());
        }),
        EditorView.theme({
          "&": { height: "100%" },
          ".cm-scroller": { overflow: "auto" },
        }),
        languageCompartmentRef.current.of([]),
        readOnlyCompartmentRef.current.of(getReadOnlyExtension(initialConfig.readOnly)),
      ]);

    const view = new EditorView({ state, parent: host, scrollTo: model.getScrollSnapshot(), dispatchTransactions: (transactions, target) => model.acceptTransactions(transactions, target) });
    model.attachView(view);
    view.scrollDOM.dataset.poScrollbar = "content";
    viewRef.current = view;
    findAdapter.attach(view);
    const unsubscribeTypography = subscribeTypographyChanges(host.ownerDocument, () => {
      view.requestMeasure();
    });
    const snapshotPort: EditorSourceSnapshotPort = {
      retainedSource: model,
      prepareDetach: model.prepareDetach,
      setInputEnabled: model.setInputEnabled,
      readSnapshot: model.readSnapshot,
      replaceContent: (nextContent) => {
        externalContentRef.current = nextContent;
        return model.replaceContent(nextContent);
      },
    };
    callbacksRef.current.onSnapshotPortChange?.(snapshotPort);
    callbacksRef.current.onSourceRevisionChange?.({
      revision: getCodeDocumentRevision(view.state.doc),
      origin: "model-initialization",
    });

    return () => {
      unsubscribeTypography();
      callbacksRef.current.onSnapshotPortChange?.(null);
      findAdapter.dispose();
      model.detachView(view);
      view.destroy();
      viewRef.current = null;
      modelRef.current = null;
      if (!modelOwner) model.dispose();
    };
  }, [findAdapter, modelOwner]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    if (Object.is(externalContentRef.current, content)) return;
    externalContentRef.current = content;
    if (view.state.doc.length === content.length && view.state.doc.toString() === content) return;
    modelRef.current?.replaceContent(content);
    callbacksRef.current.onSourceRevisionChange?.({
      revision: getCodeDocumentRevision(view.state.doc),
      origin: "model-initialization",
    });
  }, [content]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    view.dispatch({
      effects: readOnlyCompartmentRef.current.reconfigure(getReadOnlyExtension(readOnly)),
    });
  }, [readOnly]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    let active = true;
    view.dispatch({ effects: languageCompartmentRef.current.reconfigure([]) });
    void loadCodeLanguageExtension(languageKey).then((extension) => {
      if (!active || viewRef.current !== view) return;
      view.dispatch({ effects: languageCompartmentRef.current.reconfigure(extension) });
    }).catch((error) => {
      console.warn(`Unable to load ${languageKey} code language support:`, error);
    });
    return () => { active = false; };
  }, [languageKey]);

  return (
    <div
      className="code-codemirror-editor"
      data-language={languageKey || "plaintext"}
      data-po-typography-role="code"
    >
      <div ref={hostRef} className="code-codemirror-editor__host" />
    </div>
  );
}

function getReadOnlyExtension(readOnly: boolean): Extension {
  return [
    EditorState.readOnly.of(readOnly),
    EditorView.editable.of(!readOnly),
  ];
}
