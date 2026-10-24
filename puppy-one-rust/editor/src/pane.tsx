// Product editor pane for the content island. Mirrors the product mount path
//   EditorPaneShell → EditorPaneRuntime contribution providers → EditorFindHost
//   → (DocumentSessionBoundary) → PresetViewerRenderer → Viewer
// with one substitution: the Rust document session owns persistence, so the
// boundary's EditableDocumentSource is a bridge to the native snapshot/dirty
// protocol instead of the product's Working Copy + autosave queue.
import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {Text} from '@codemirror/state';
import {LocalizationProvider} from '@puppyone/localization/react';
import type {AppLocale, LocaleState} from '@puppyone/localization/core';
import {catalogs} from './catalogs.generated.js';
import {resolveTypography, DEFAULT_TYPOGRAPHY_PREFERENCES, withTypographyScale} from '@product/src/features/typography/fontCatalog';
import {applyTypographyToElement} from '@product/src/features/typography/typographyRuntime';
import {getFileSemanticKind, getResolvedFileExtension, resolveFileFormat} from '@product/packages/shared-ui/src/core/fileFormats';
import type {EditorSourceRevision, EditorSourceSnapshotPort} from '@product/packages/shared-ui/src/editor/sourceSnapshot';
import type {EditableDocumentSource} from '@product/packages/shared-ui/src/editor/document-session/types';
import {EditableDocumentSourceProvider} from '@product/packages/shared-ui/src/editor/document-session/EditableDocumentSourceContext';
import {DocumentModelOwner, DocumentModelProvider} from '@product/packages/shared-ui/src/editor/document-session/DocumentModelOwner';
import {CodeMirrorDocumentModel} from '@product/packages/shared-ui/src/editor/document-session/CodeMirrorDocumentModel';
import {EditorFindContributionProvider, EditorFindHost, type EditorFindCommand} from '@product/packages/shared-ui/src/editor/find/editorFind';
import {EditorPaneMenuContributionProvider, type EditorPaneMenuContribution} from '@product/packages/shared-ui/src/editor/editorPaneMenuContribution';
import {EditorAppearanceProvider} from '@product/packages/shared-ui/src/core/appearance/EditorAppearanceContext';
import {normalizePresetViewerContribution} from '@product/packages/shared-ui/src/editor/registry/presetViewerContribution';
import type {PresetViewerContribution, EditorViewerMatch, EditorInteractionPreferences} from '@product/packages/shared-ui/src/editor/registry/viewerTypes';
import {PresetViewerRenderer} from '@product/packages/shared-ui/src/editor/host/PresetViewerRenderer';
import {markdownViewerContribution} from '@product/packages/shared-ui/src/editor/markdown/contribution';
import {jsonViewerContribution, textViewerContribution} from '@product/packages/shared-ui/src/editor/viewers/code/contributions';
import {csvTableViewerContribution} from '@product/packages/shared-ui/src/editor/viewers/csv/contribution';
import {fallbackViewerContribution} from '@product/packages/shared-ui/src/editor/viewers/fallback/contribution';
import {EditorPaneShell} from '@product/src/features/editor-workbench/layout/EditorPaneShell';

// The island's subset of BUILTIN_VIEWER_CONTRIBUTIONS, in product order, with
// createPresetViewerRegistry's first-match semantics. Formats outside it reach
// the product fallback viewer exactly as an unsupported format would.
const viewers = [markdownViewerContribution, jsonViewerContribution, csvTableViewerContribution, textViewerContribution]
  .map(normalizePresetViewerContribution);
const fallback = normalizePresetViewerContribution(fallbackViewerContribution);
function resolveViewer(path: string, name: string) {
  const document = {path, name, type: getFileSemanticKind(name, 'file')} as EditorViewerMatch['document'];
  const format = resolveFileFormat({name: path || name});
  const resolvedExtension = getResolvedFileExtension({name}, format);
  const match = {document, format, resolvedExtension} as EditorViewerMatch;
  return {viewer: viewers.find(v => v.match(match)) ?? fallback, match};
}

function localizer(initial: AppLocale) {
  let state: LocaleState = {locale: initial, direction: 'ltr', preference: initial, systemLanguages: []};
  const listeners = new Set<(state: LocaleState) => void>();
  const change = (locale: AppLocale) => {
    if (!Object.hasOwn(catalogs, locale)) throw new Error('Unsupported locale');
    state = {...state, locale, preference: locale};
    for (const listener of listeners) listener(state);
  };
  return {change, props: {initialState: state, initialCatalog: catalogs[initial], fallbackCatalog: catalogs.en,
    loadCatalog: async (locale: AppLocale) => ({catalog: catalogs[locale], fallbackCatalog: catalogs.en}),
    client: {onLocaleChanged(callback: (state: LocaleState) => void) { listeners.add(callback); callback(state); return () => { listeners.delete(callback); }; },
      async setLanguagePreference() { throw new Error('Language preference is owned by the native host'); }}}};
}

export type PaneOptions = {
  parent: HTMLElement; path: string; name: string; text: string; baselineText?: string;
  dark: boolean; locale: AppLocale; scale: 'small' | 'medium' | 'large';
  interaction?: Partial<EditorInteractionPreferences>;
  onChange: () => void; onReady: () => void; onError: (error: Error) => void;
  onAction: (action: string) => void;
};

/** One open document in the product pane. The adapter is the island's only
 * contract with editor.js; the native session never sees React or models. */
export function createPane(options: PaneOptions) {
  const {parent, path, name, onChange, onReady, onError, onAction} = options;
  const {viewer, match} = resolveViewer(path, name);
  const localization = localizer(options.locale);
  const root = createRoot(parent);
  const owner = new DocumentModelOwner();
  // Viewers may normalise their input (JSON pretty-printing). The product
  // treats the normalised projection as the unedited state, so does the bridge.
  const content = viewer.normalizeContent?.(options.text, match.document) ?? options.text;
  let baselineString = viewer.normalizeContent && options.baselineText === options.text ? content : (options.baselineText ?? options.text);
  let baselineText: Text = Text.of(baselineString.split('\n'));
  let port: EditorSourceSnapshotPort | null = null;
  let dark = options.dark, scale = options.scale, frozen = false, disposed = false, ready = false;
  let menu: EditorPaneMenuContribution | null = null, find: EditorFindCommand | null = null, actionsOpen = false;
  let interaction: EditorInteractionPreferences = {showSaveStatus: false, markdownBlockDragEnabled: false, markdownHeadingOutlineEnabled: false, ...options.interaction};

  const retained = () => port?.retainedSource ?? port;
  const source: EditableDocumentSource = {
    attachSource(next) {
      port = next;
      if (!ready && !disposed) { ready = true; queueMicrotask(guarded(() => { if (!disposed) onReady(); })); }
      return () => { if (port === next) port = null; };
    },
    reportRevision(revision: EditorSourceRevision) {
      if (disposed) return;
      if (revision.origin === 'local-edit') onChange();
    },
  };
  const readText = () => {
    if (!port) throw new Error('Editor model is not ready');
    return port.readSnapshot().content;
  };
  const dirty = () => {
    if (!port) return false;
    const model = retained();
    if (model instanceof CodeMirrorDocumentModel) return !model.editorState.doc.eq(baselineText);
    return readText() !== baselineString;
  };
  const setBaseline = (text: string) => { baselineString = text; baselineText = Text.of(text.split('\n')); };
  const paneMode = (live: boolean) => {
    const control = menu?.viewItems.find(item => item.kind === 'segmented' && item.id === 'editor-view-mode');
    if (control && control.kind === 'segmented') control.setValue(live ? 'live' : 'source');
  };
  const noop = () => {};
  const fileDrop = {dropIntent: null, over: noop, leave: noop, drop: noop};
  const paneMove = {dropIntent: null, prepare: noop, start: noop, move: noop, end: () => 'click' as const, cancel: noop, lostCapture: noop};
  const pane = {kind: 'leaf', id: 'pane-1', editorId: path} as never;
  const contexts = new Map<boolean, never>();
  const context = (canEdit: boolean) => {
    if (!contexts.has(canEdit)) contexts.set(canEdit, buildContext(canEdit));
    return contexts.get(canEdit)!;
  };
  const buildContext = (canEdit: boolean) => ({
    document: {...match.document, version: 'native-1', markdownDialect: null, sourceKind: 'local'},
    format: match.format, resolvedExtension: match.resolvedExtension, content, resourcePolicy: viewer.resourcePolicy,
    aiEditFile: null, fileUrl: null, fileUrlLoading: false, fileUrlError: null, loading: false, error: null,
    canEdit, hideSourceView: false, fileIconTheme: 'default', editorInteractionPreferences: interaction,
    htmlTrustMode: 'safe', workspaceId: 'native', workspaceRoot: null, markdownEnvironment: null,
    documentNavigation: null, contextMapEnvironment: null, appPreview: null,
  }) as never;

  // Contribution callbacks are stable (the product passes useCallback
  // handlers); a new function per render would republish forever.
  let scheduled = false;
  // Microtasks queued from a host-evaluated call surface only as an opaque
  // "Script error."; report the real failure through the fault channel.
  const guarded = (task: () => void) => () => {
    try { task(); } catch (error) { onError(error instanceof Error ? error : new Error(String(error))); }
  };
  const schedule = () => { if (scheduled || disposed) return; scheduled = true; queueMicrotask(guarded(() => { scheduled = false; render(); })); };
  const onMenuContribution = (next: EditorPaneMenuContribution | null) => { if (next !== menu) { menu = next; schedule(); } };
  const onFindCommand = (next: EditorFindCommand | null) => { if (next !== find) { find = next; schedule(); } };
  const onActionsPaneChange = (id: string | null) => { actionsOpen = id !== null; schedule(); };
  const onClose = () => onAction('close-file');
  const onOpenExternal = () => onAction('open-external');
  function render() {
    if (disposed) return;
    flushSync(() => root.render(
      <LocalizationProvider {...localization.props}>
        <EditorAppearanceProvider revision={`${dark ? 'dark' : 'light'}:${scale}`}>
          <div className="desktop-editor-split-view" data-pane-count="1">
            <div className="desktop-editor-pane-slot" data-touches-block-end="true"><div className="desktop-editor-pane-host">
              <EditorPaneShell active actionsOpen={actionsOpen} agentPresencePath={null} contentState="document"
                editorLabel={name} fileDrop={fileDrop as never} findCommand={find} menuContribution={menu}
                pane={pane} paneCount={1} paneMove={paneMove as never}
                onActionsPaneChange={onActionsPaneChange}
                onActivate={noop} onClose={onClose}
                onOpenExternal={onOpenExternal} onSplit={noop}>
                <EditorPaneMenuContributionProvider onContributionChange={onMenuContribution}>
                  <EditorFindContributionProvider onCommandChange={onFindCommand}>
                    <EditorFindHost documentId={path}>
                      <DocumentModelProvider owner={owner}>
                        <EditableDocumentSourceProvider source={source}>
                          <div className="editor-document-session-boundary">
                            <PresetViewerRenderer viewer={viewer} context={context(!frozen)}/>
                          </div>
                        </EditableDocumentSourceProvider>
                      </DocumentModelProvider>
                    </EditorFindHost>
                  </EditorFindContributionProvider>
                </EditorPaneMenuContributionProvider>
              </EditorPaneShell>
            </div></div>
          </div>
        </EditorAppearanceProvider>
      </LocalizationProvider>,
    ));
  }
  const typography = () => applyTypographyToElement(document.documentElement,
    resolveTypography(withTypographyScale(DEFAULT_TYPOGRAPHY_PREFERENCES, scale)));
  typography();

  const api = {
    viewerId: viewer.id,
    snapshot: readText,
    dirty,
    saved() { setBaseline(readText()); },
    baseline(text: string) { setBaseline(text); },
    freeze(value: boolean) {
      if (value) port?.prepareDetach?.(); // never retires an active IME composition
      port?.setInputEnabled?.(!value);     // synchronous gate before React commits
      frozen = value; render();
    },
    theme(value: boolean) { dark = value; render(); },
    typography(value: 'small' | 'medium' | 'large') { scale = value; typography(); render(); },
    locale(value: AppLocale) { localization.change(value); },
    mode(live: boolean) { if (!frozen) paneMode(live); },
    history(direction: 'undo' | 'redo') {
      const model = retained();
      if (model instanceof CodeMirrorDocumentModel) return model.moveHistory(direction);
      // Structured viewers own history behind their keyboard command.
      const target = (document.activeElement && parent.contains(document.activeElement) ? document.activeElement : parent.querySelector('[tabindex],input,textarea,[contenteditable=true]')) as HTMLElement | null;
      if (!target) return false;
      const event = new KeyboardEvent('keydown', {key: 'z', code: 'KeyZ', metaKey: true, shiftKey: direction === 'redo', bubbles: true, cancelable: true});
      target.dispatchEvent(event);
      return event.defaultPrevented;
    },
    /** Accepted external storage content: update the model in place. */
    replace(text: string) {
      const next = viewer.normalizeContent?.(text, match.document) ?? text;
      port?.replaceContent(next);
      setBaseline(next);
    },
    interaction(next: Partial<EditorInteractionPreferences>) {
      const merged = {...interaction, ...next};
      if (Object.entries(merged).every(([k, v]) => interaction[k as keyof EditorInteractionPreferences] === v)) return;
      interaction = merged; contexts.clear(); render();
    },
    closeMenu() { if (actionsOpen) { actionsOpen = false; render(); } },
    destroy() { disposed = true; flushSync(() => root.unmount()); owner.dispose(); port = null; },
    edit(value: string) {
      const model = retained();
      if (frozen || !port) throw new Error('Editor input is frozen or unavailable');
      if (model instanceof CodeMirrorDocumentModel) {
        if (!model.applyLocalEdits(model.revision, [{from: 0, to: model.editorState.doc.length, expectedText: readText(), insert: value}], 'native-smoke'))
          throw new Error('Edit rejected');
      } else { port.replaceContent(value); onChange(); }
    },
    state() {
      const live = !document.querySelector('[data-live-preview=false]');
      return {viewer: viewer.id, livePreview: live, previewReady: Boolean(parent.querySelector('[data-preview-state=ready]')),
        frozen, dirty: dirty(), text: port ? readText() : null, menuItems: menu?.viewItems.map(i => i.id) ?? []};
    },
  };
  queueMicrotask(guarded(render));
  return api;
}
