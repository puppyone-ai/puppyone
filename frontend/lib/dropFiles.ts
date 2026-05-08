/**
 * Drop-file resolution.
 *
 * Why this file exists:
 *   The native ``DataTransfer.files`` list has a long-standing,
 *   underdocumented gotcha: when the user drags a FOLDER from the OS,
 *   the entry shows up as a single ``File`` with ``size === 0``,
 *   ``type === ''``, and ``name`` set to the folder name.
 *
 *   Concretely: drop a folder ``general/`` containing 5 files →
 *   ``event.dataTransfer.files`` reports ``length === 1`` with one
 *   bogus 0-byte "general" entry. Uploading that pushes a 0-byte
 *   placeholder and quietly loses every real file inside.
 *
 *   This is exactly the bug that produced "1 file selected — general
 *   — 0 KB" in the Import dialog when the user dragged a folder in.
 *
 * The fix: walk the entry tree.
 *   ``DataTransfer.items[i].webkitGetAsEntry()`` returns a
 *   ``FileSystemEntry`` we can recurse into. Files come back with
 *   the real ``File`` object via ``entry.file()``; directories
 *   stream their children via ``entry.createReader().readEntries()``
 *   and we recurse down each branch in parallel.
 *
 * Compatibility notes:
 *   - ``webkitGetAsEntry`` is non-standard but ships in Chromium,
 *     Firefox, Safari, and every browser we target. The W3C
 *     File and Directory Entries spec is the de-facto contract.
 *   - ``DataTransferItemList`` is only valid during the drop event.
 *     We snapshot the entries synchronously inside the handler
 *     before any ``await``s — accessing them post-event yields
 *     ``null`` in some browsers.
 *   - We DO NOT block on the entry walk in the drop handler; the
 *     handler returns synchronously, the async walk happens
 *     after. Otherwise dragend would race with our callback.
 */

/**
 * Snapshot the dropped DataTransfer's items into ``FileSystemEntry``
 * handles synchronously. Must be called from inside the drop event;
 * after the event drains, ``items[i].webkitGetAsEntry()`` returns
 * ``null`` in Safari and Firefox.
 *
 * Returns ``null`` if the browser doesn't support the entry API at
 * all (very old engines), so callers can fall back to the bare
 * ``DataTransfer.files`` list.
 */
function snapshotEntries(
  items: DataTransferItemList,
): FileSystemEntry[] | null {
  const entries: FileSystemEntry[] = [];
  let sawAny = false;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.kind !== 'file') continue;
    // ``webkitGetAsEntry`` is the canonical name; some old
    // implementations expose ``getAsEntry`` instead.
    const get =
      (item as DataTransferItem & {
        webkitGetAsEntry?: () => FileSystemEntry | null;
        getAsEntry?: () => FileSystemEntry | null;
      }).webkitGetAsEntry ??
      (item as DataTransferItem & {
        webkitGetAsEntry?: () => FileSystemEntry | null;
        getAsEntry?: () => FileSystemEntry | null;
      }).getAsEntry;
    if (!get) {
      // Browser doesn't support the entry API. Bail to fallback.
      return null;
    }
    sawAny = true;
    const entry = get.call(item);
    if (entry) entries.push(entry);
  }
  return sawAny ? entries : null;
}

/**
 * Recursively materialize a ``FileSystemEntry`` into a flat list of
 * ``File`` objects with ``webkitRelativePath`` reflecting the
 * original folder layout.
 *
 * The relative-path bookkeeping matters because the upload pipeline
 * uses ``webkitRelativePath`` (or its absence) to decide whether to
 * preserve a folder hierarchy in the destination tree. Without it
 * every dropped file would land flat at the drop target.
 */
async function materializeEntry(
  entry: FileSystemEntry,
  pathPrefix: string,
  out: File[],
): Promise<void> {
  if (entry.isFile) {
    const fileEntry = entry as FileSystemFileEntry;
    await new Promise<void>((resolve, reject) => {
      fileEntry.file(
        (file) => {
          const path = pathPrefix + file.name;
          // ``File.webkitRelativePath`` is read-only on the
          // standard interface, but Chromium and Firefox allow
          // redefining it via ``Object.defineProperty``. If a
          // hardened browser ever rejects this, we silently drop
          // the path context — uploads still succeed, just flatly.
          try {
            Object.defineProperty(file, 'webkitRelativePath', {
              value: path,
              writable: false,
              configurable: true,
            });
          } catch {
            // keep file as-is
          }
          out.push(file);
          resolve();
        },
        (err) => reject(err),
      );
    });
    return;
  }

  if (entry.isDirectory) {
    const dirEntry = entry as FileSystemDirectoryEntry;
    const reader = dirEntry.createReader();

    // ``readEntries`` is paginated: it returns at most ~100 entries
    // per call, then an empty batch signals end-of-directory. We
    // accumulate every batch before recursing — recursing inside
    // the callback would give us a deep stack on large folders.
    const allChildren: FileSystemEntry[] = [];
    while (true) {
      const batch: FileSystemEntry[] = await new Promise(
        (resolve, reject) => {
          reader.readEntries(
            (entries) => resolve(entries),
            (err) => reject(err),
          );
        },
      );
      if (batch.length === 0) break;
      allChildren.push(...batch);
    }

    // Walk children in parallel. Each child gets its own prefix so
    // the resulting File objects know their full path. We DON'T
    // throttle here — the OS file picker, by contrast, is already
    // gated by the user picking the folder; we trust the input.
    await Promise.all(
      allChildren.map((child) =>
        materializeEntry(child, `${pathPrefix}${entry.name}/`, out),
      ),
    );
  }
}

/**
 * Resolve a ``DataTransfer`` (or just its ``items``) into a flat
 * ``File[]``, recursively expanding any dropped folders.
 *
 * - Single dropped file → 1-element list, ``webkitRelativePath ===
 *   ''`` (matches the native ``input[type=file]`` behaviour for
 *   single-file picks).
 * - Single dropped folder ``foo/`` → N-element list, every file's
 *   ``webkitRelativePath`` starts with ``foo/``.
 * - Mix of files + folders → flat list, each entry tagged with its
 *   path prefix as appropriate.
 * - Browser without the entry API → falls back to
 *   ``dataTransfer.files`` so SOMETHING uploads (folders will still
 *   be wrong here but we'd rather upload-as-files than upload-zero-
 *   files; this fallback should be vanishingly rare in 2026).
 *
 * IMPORTANT: callers MUST capture ``dataTransfer.items`` /
 * ``dataTransfer.files`` synchronously inside the drop handler and
 * pass the captured value here, then ``await`` the result. The
 * DataTransfer object itself becomes invalid the moment the drop
 * event finishes.
 */
export async function collectDroppedFiles(input: {
  items?: FileSystemEntry[] | null;
  fallbackFiles?: FileList | null;
}): Promise<File[]> {
  if (input.items && input.items.length > 0) {
    const out: File[] = [];
    await Promise.all(
      input.items.map((entry) => materializeEntry(entry, '', out)),
    );
    return out;
  }
  if (input.fallbackFiles && input.fallbackFiles.length > 0) {
    return Array.from(input.fallbackFiles);
  }
  return [];
}

/**
 * Convenience wrapper: snapshot from a ``DragEvent`` directly. This
 * MUST be called synchronously inside the event handler so the
 * snapshot captures live entries before the event drains.
 *
 * Pattern:
 *   const handle = snapshotDataTransfer(e);
 *   e.preventDefault();
 *   e.stopPropagation();
 *   const files = await resolveDataTransferSnapshot(handle);
 */
export interface DataTransferSnapshot {
  entries: FileSystemEntry[] | null;
  fallbackFiles: FileList | null;
}

export function snapshotDataTransfer(
  event: { dataTransfer: DataTransfer | null } | DragEvent,
): DataTransferSnapshot {
  const dt = (event as DragEvent).dataTransfer;
  if (!dt) return { entries: null, fallbackFiles: null };
  const entries = dt.items ? snapshotEntries(dt.items) : null;
  const fallbackFiles = dt.files ?? null;
  return { entries, fallbackFiles };
}

export async function resolveDataTransferSnapshot(
  snapshot: DataTransferSnapshot,
): Promise<File[]> {
  return collectDroppedFiles({
    items: snapshot.entries,
    fallbackFiles: snapshot.fallbackFiles,
  });
}
