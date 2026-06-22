# Desktop Feature Architecture

This document records durable product and frontend architecture decisions for
PuppyOne Desktop. It is intentionally written as implementation guidance, not as
release notes.

## Smooth Preview Transitions

### Problem

The desktop file preview used to flash a blank or white frame during file
switches. The visible sequence was:

1. The sidebar selection changed immediately.
2. The previous editor was unmounted.
3. The next file content was loaded asynchronously through the Electron bridge.
4. A new editor host was committed before the editor instance was ready.
5. CodeMirror or the viewer mounted on a later effect pass.

This made page switching feel unstable, especially for Markdown documents where
CodeMirror owns a large DOM subtree.

The root cause was not route-level lazy loading. It was a lifecycle boundary
problem: selection state, content loading state, and editor instance state were
coupled too tightly.

### Design Goal

File switching must feel continuous. The main preview area should never expose an
empty editor host simply because a new selection is pending. The UI may show a
loading state, but it must be deliberate, background-matched, and tied to a
document lifecycle.

### Final Architecture

The desktop preview path uses three separate concepts:

- Selection intent: the file currently selected in the sidebar.
- Loaded content: the latest content known for a path.
- Committed preview document: the document currently safe to render in the main
  editor surface.

When a user selects a new file, the sidebar selection may update immediately, but
the main editor only switches to that file when the file has enough data to
render. If the selected file is still pending and a previous document is already
committed, the main editor keeps rendering the previous committed document.

This avoids the unstable state where React switches to a new document path before
the document content and editor instance are ready.

### Implementation Rules

1. Do not let selection state directly unmount the editor.

   `activePath` is an input signal, not proof that the editor can render the
   selected document. The render path must go through a committed preview state.

2. Keep a content cache by file path.

   Once a file has been read, switching back to it should use cached content
   immediately while the system refreshes in the background.

3. Do not use `key={document.path}` to reset text editors.

   Forced remounts create blank-frame windows and discard editor state too
   aggressively. Text editors receive an explicit `documentId` and reset their
   local draft/save state in layout phase.

4. Initialize DOM-owned editors before paint.

   CodeMirror setup and content reconfiguration must run in `useLayoutEffect`
   so the browser does not paint an empty host before the editor DOM is attached.

5. Bind saving to the rendered document, not the selected document.

   During a pending selection, the main area may still render the previous
   committed document. Save callbacks must write to the document currently being
   rendered, not whichever file is currently highlighted in the sidebar.

6. Scope errors by document path.

   A read error from one path must not leak into another path during rapid file
   switching.

### Current Code Boundaries

- `frontend/shared-ui/src/data/DataWorkspace.tsx`
  - owns selected file resolution
  - owns file content cache
  - owns committed preview document state
  - binds save callbacks to the rendered document

- `frontend/shared-ui/src/data/FilePreview.tsx`
  - renders the current preview shell
  - avoids fallback preview content while full content is pending

- `frontend/shared-ui/src/editor/viewers/TextEditorFrame.tsx`
  - owns text editor draft, persisted content, save state, and mode state
  - resets by `documentId` without forcing a React remount

- `frontend/shared-ui/src/editor/markdown/MarkdownCodeMirrorEditor.tsx`
  - owns the CodeMirror `EditorView`
  - mounts and reconfigures in layout phase
  - updates content through CodeMirror transactions

The desktop app consumes these shared UI files through
`desktop/vendor/shared-ui`. After changing shared UI, run:

```bash
node scripts/sync-desktop-shared-ui.mjs
```

### Verification

For this feature, the minimum verification is:

```bash
cd desktop
npm run check:shared-ui
npm run build
```

Manual verification should cover:

- rapidly switching between Markdown files
- switching between files already visited and files not yet cached
- switching while a file is autosaving
- switching to a file that fails to read
- switching between Markdown, plain text, JSON, CSV, image, PDF, and HTML

### Invariants

These invariants should remain true after future changes:

- A selected sidebar row does not guarantee that the main editor has switched.
- The main editor always renders a committed document or a deliberate empty state.
- No viewer should show an unstyled browser-white fallback during normal
  transitions.
- Text editors reset by document identity, not by React subtree destruction.
- Autosave must never write old document content to a newly selected path.

