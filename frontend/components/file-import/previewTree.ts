import type { PreviewTreeNode, PreviewTreeResult } from './types';

export const TREE_PREVIEW_MAX_ROWS = 140;

function relativeParts(file: File): string[] {
  const rel = ((file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name)
    .trim()
    .replace(/^\.?\/+/, '');
  return rel.split('/').filter(Boolean);
}

function sortPreviewChildren(children: PreviewTreeNode[]): PreviewTreeNode[] {
  return [...children].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  });
}

export function buildPreviewRows(files: readonly File[]): PreviewTreeResult {
  const root: PreviewTreeNode = {
    kind: 'folder',
    name: '',
    path: '',
    children: [],
    fileCount: 0,
    sizeBytes: 0,
    folderIndex: new Map(),
  };

  files.forEach((file, index) => {
    const parts = relativeParts(file);
    if (parts.length === 0) return;

    let current = root;
    current.fileCount += 1;
    current.sizeBytes += file.size;

    parts.slice(0, -1).forEach((part) => {
      let next = current.folderIndex?.get(part);
      if (!next) {
        const path = current.path ? `${current.path}/${part}` : part;
        next = {
          kind: 'folder',
          name: part,
          path,
          children: [],
          fileCount: 0,
          sizeBytes: 0,
          folderIndex: new Map(),
        };
        current.folderIndex?.set(part, next);
        current.children.push(next);
      }
      next.fileCount += 1;
      next.sizeBytes += file.size;
      current = next;
    });

    const fileName = parts.at(-1) || file.name || `File ${index + 1}`;
    const filePath = current.path ? `${current.path}/${fileName}` : fileName;
    current.children.push({
      kind: 'file',
      name: fileName,
      path: filePath,
      children: [],
      fileCount: 1,
      sizeBytes: file.size,
    });
  });

  const rows: PreviewTreeResult['rows'] = [];
  let totalRows = 0;

  const visit = (node: PreviewTreeNode, depth: number) => {
    sortPreviewChildren(node.children).forEach((child) => {
      totalRows += 1;
      if (rows.length < TREE_PREVIEW_MAX_ROWS) {
        rows.push({
          kind: child.kind,
          name: child.name,
          path: child.path,
          depth,
          fileCount: child.fileCount,
          sizeBytes: child.sizeBytes,
        });
      }
      if (child.kind === 'folder') visit(child, depth + 1);
    });
  };

  visit(root, 0);
  return { rows, totalRows };
}
