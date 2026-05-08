'use client';

import { useEffect, useRef, useState } from 'react';
import {
  resolveDataTransferSnapshot,
  snapshotDataTransfer,
} from '@/lib/dropFiles';

/**
 * Page-wide safety net for external file drops.
 *
 * The problem this exists to solve:
 *   When the user drags a file from their desktop and releases over a
 *   region of the page that DOESN'T have a `dragover` handler with
 *   `preventDefault()`, the browser's default behaviour kicks in:
 *   it navigates the current tab to the dropped file (= "the file
 *   disappears, the page is gone"). Our explorer sidebar handles
 *   drops, but the rest of the data page (content area, right panel,
 *   header strip, gaps between zones, etc.) doesn't — so a slightly-
 *   off drop costs the user their session and the file vanishes.
 *
 * What this hook does:
 *   - Installs `dragenter` / `dragover` / `dragleave` / `drop`
 *     listeners on `window` so EVERY drop on the page is intercepted.
 *   - On `dragover`: `preventDefault()` so the browser stops refusing
 *     the drop (otherwise the browser-default open-as-tab kicks in).
 *   - On `drop`: if the event was NOT already `preventDefault()`'d by
 *     a more specific inner zone (e.g. the sidebar's per-folder drop
 *     handler), we treat it as "the user wanted to upload but didn't
 *     hit a specific target" and route to the supplied callback.
 *   - Tracks an `isDraggingFiles` flag callers can use to render a
 *     full-page overlay so the target is always visible during a drag.
 *
 * Inner zones still take precedence:
 *   The sidebar / row-level drop handlers all call
 *   `event.preventDefault()` + `event.stopPropagation()`. By the time
 *   the bubble reaches `window`, `defaultPrevented` is `true`, so we
 *   skip our fallback and let their handler win. This keeps the
 *   "drop on a specific folder" UX intact while preventing the
 *   "drop on a gap = file disappears" failure mode.
 *
 * Why window-level instead of wrapping the page:
 *   - Headers, modals, tooltips, portals, anywhere that sits visually
 *     "on the page" but isn't a child of our root element still gets
 *     covered. A wrapper div would miss portals.
 *   - Cheaper than a giant invisible overlay div.
 *   - One installation point, lives outside React's reconciliation —
 *     no risk of children inadvertently breaking the contract.
 */
export interface ExternalFileDropCatcherOptions {
  /** Called when the user drops external files anywhere not claimed
   *  by a more specific dropzone. */
  onDrop: (files: File[]) => void;
  /** Disable the catcher temporarily — e.g. when a modal is open and
   *  drops should be the modal's responsibility. Defaults to enabled. */
  enabled?: boolean;
}

export interface ExternalFileDropCatcherResult {
  /** True while at least one external file is being dragged over the
   *  window. Use this to render a full-page "Drop to upload" overlay. */
  isDraggingFiles: boolean;
}

/**
 * Returns true iff the dataTransfer carries external files (as
 * opposed to internal drags like our `application/x-puppyone-node`).
 *
 * `dataTransfer.types` is the only attribute readable during
 * `dragover` — the actual `files` list is empty until `drop`. So we
 * key on the `Files` type marker which is what browsers add when the
 * user is dragging from the OS file picker.
 */
function eventHasExternalFiles(event: DragEvent): boolean {
  const types = event.dataTransfer?.types;
  if (!types) return false;
  for (let i = 0; i < types.length; i++) {
    if (types[i] === 'Files') return true;
  }
  return false;
}

export function useExternalFileDropCatcher(
  options: ExternalFileDropCatcherOptions,
): ExternalFileDropCatcherResult {
  const { enabled = true } = options;
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);

  // Counter pattern (same trick `react-dropzone` uses): `dragenter`
  // and `dragleave` fire EVERY time the cursor crosses a child
  // element boundary, not just the outer window edge. A naive
  // `setIsDraggingFiles(true/false)` would flicker like crazy as the
  // cursor moves over child nodes. Counting enters - leaves and
  // checking for zero gives a stable "actually left the window"
  // signal.
  const dragCounter = useRef(0);

  // Keep the latest onDrop in a ref so the window listeners we
  // install in useEffect don't capture a stale callback. (Re-
  // installing listeners on every onDrop change would also work
  // but is more expensive and visibly flaky if the consumer's
  // onDrop changes on every render.)
  const onDropRef = useRef(options.onDrop);
  useEffect(() => {
    onDropRef.current = options.onDrop;
  }, [options.onDrop]);

  useEffect(() => {
    if (!enabled) {
      dragCounter.current = 0;
      setIsDraggingFiles(false);
      return;
    }

    const handleDragEnter = (event: DragEvent) => {
      if (!eventHasExternalFiles(event)) return;
      // Don't preventDefault here — inner zones use dragenter for
      // their own "is the file over me" highlighting, and stealing
      // the event would break that. We just track the counter so
      // we know when to show the overlay.
      dragCounter.current++;
      if (dragCounter.current === 1) {
        setIsDraggingFiles(true);
      }
    };

    const handleDragOver = (event: DragEvent) => {
      if (!eventHasExternalFiles(event)) return;
      // Crucial: every dragover must preventDefault, otherwise the
      // browser refuses the drop and falls back to its default
      // (open the file in the current tab). The cost of doing this
      // even on inner zones is zero — they also preventDefault, so
      // we're idempotent.
      event.preventDefault();
      // Use 'copy' so the OS cursor shows the standard upload
      // affordance instead of the (default) "no" symbol.
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'copy';
      }
    };

    const handleDragLeave = (event: DragEvent) => {
      if (!eventHasExternalFiles(event)) return;
      dragCounter.current--;
      if (dragCounter.current <= 0) {
        dragCounter.current = 0;
        setIsDraggingFiles(false);
      }
    };

    const handleDrop = (event: DragEvent) => {
      if (!eventHasExternalFiles(event)) return;

      // Always reset the overlay — drop is terminal regardless of
      // who handles the files.
      dragCounter.current = 0;
      setIsDraggingFiles(false);

      // If a more specific inner zone has already claimed this drop
      // (every well-behaved zone calls `preventDefault()` on `drop`),
      // we MUST stay out of the way — running the fallback would
      // double-handle the files and trigger duplicate uploads.
      if (event.defaultPrevented) return;

      // The browser would open the file in this tab if we didn't.
      // Even though no inner zone claimed it, we DO need to keep
      // the file inside the app — that's the whole point of this
      // safety net.
      event.preventDefault();

      // CRITICAL: snapshot the DataTransfer SYNCHRONOUSLY here.
      // ``DataTransfer.items`` is invalidated as soon as the drop
      // event drains, so any ``await`` between the event firing and
      // calling ``webkitGetAsEntry()`` would give us null entries
      // and the folder walk would silently produce zero files.
      const snapshot = snapshotDataTransfer(event);
      void resolveDataTransferSnapshot(snapshot).then((files) => {
        if (files.length > 0) {
          onDropRef.current(files);
        }
      });
    };

    // Use bubble phase (third arg = false) so inner zones see the
    // event first. Their `stopPropagation()` doesn't actually stop
    // the bubble from reaching window in all browsers, but their
    // `preventDefault()` does set `defaultPrevented`, which we key
    // on inside `handleDrop` above.
    window.addEventListener('dragenter', handleDragEnter);
    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('drop', handleDrop);

    return () => {
      window.removeEventListener('dragenter', handleDragEnter);
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('drop', handleDrop);
      dragCounter.current = 0;
      setIsDraggingFiles(false);
    };
  }, [enabled]);

  return { isDraggingFiles };
}

