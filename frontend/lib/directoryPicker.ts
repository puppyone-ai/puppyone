'use client';

import { pathBlockedSegment } from './uploadPolicy';

type FileSystemFileHandleLike = {
  kind: 'file';
  name: string;
  getFile: () => Promise<File>;
};

type FileSystemDirectoryHandleLike = {
  kind: 'directory';
  name: string;
  entries: () => AsyncIterableIterator<[string, FileSystemHandleLike]>;
};

type FileSystemHandleLike =
  | FileSystemFileHandleLike
  | FileSystemDirectoryHandleLike;

type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: (options?: { mode?: 'read' }) => Promise<FileSystemDirectoryHandleLike>;
};

function withRelativePath(file: File, relativePath: string): File {
  try {
    Object.defineProperty(file, 'webkitRelativePath', {
      value: relativePath,
      writable: false,
      configurable: true,
    });
  } catch {
    // Upload still succeeds without hierarchy metadata; it just lands flat.
  }
  return file;
}

function makeSkippedMarker(relativePath: string): File {
  const name = relativePath.split('/').pop() || '.puppyone-skipped';
  return withRelativePath(new File([], name), relativePath);
}

async function collectDirectoryFiles(
  directory: FileSystemDirectoryHandleLike,
  prefix: string,
  out: File[],
): Promise<void> {
  for await (const [, handle] of directory.entries()) {
    const relativePath = `${prefix}/${handle.name}`;
    if (pathBlockedSegment(relativePath)) {
      out.push(
        makeSkippedMarker(
          handle.kind === 'directory'
            ? `${relativePath}/.puppyone-skipped`
            : relativePath,
        ),
      );
      continue;
    }

    if (handle.kind === 'file') {
      const file = await handle.getFile();
      out.push(withRelativePath(file, relativePath));
    } else {
      await collectDirectoryFiles(handle, relativePath, out);
    }
  }
}

/**
 * Pick a local folder without using ``input[webkitdirectory]`` when the
 * File System Access API is available. Chromium's webkitdirectory path
 * adds an extra browser-owned "upload all files?" confirmation; this API
 * lets our own preflight UI be the confirmation surface.
 *
 * Returns ``null`` when unsupported so callers can fall back to the legacy
 * input. Returns ``[]`` when the user cancels.
 */
export async function pickDirectoryFiles(): Promise<File[] | null> {
  if (typeof window === 'undefined') return null;
  const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
  if (!picker) return null;

  try {
    const directory = await picker.call(window, { mode: 'read' });
    const files: File[] = [];
    await collectDirectoryFiles(directory, directory.name, files);
    return files;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return [];
    }
    throw error;
  }
}
