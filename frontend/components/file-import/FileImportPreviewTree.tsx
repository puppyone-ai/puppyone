'use client';

import { TreeDisclosureMarker } from '@/components/ui/TreeDisclosureMarker';
import { formatBytes } from './format';
import type { FileImportStats, PreviewTreeResult, PreviewTreeKind } from './types';

interface FileImportPreviewTreeProps {
  acceptedCount: number;
  totalAcceptedBytes: number;
  fileStats: FileImportStats;
  previewTree: PreviewTreeResult;
}

const TREE_INDENT = 18;
const TREE_LINE_X = 8;
const TREE_BRANCH_WIDTH = 14;

export function FileImportPreviewTree({
  acceptedCount,
  totalAcceptedBytes,
  fileStats,
  previewTree,
}: FileImportPreviewTreeProps) {
  return (
    <div>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        padding: '10px 12px',
        borderBottom: '1px solid var(--po-border-subtle)',
      }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--po-text)' }}>
            Files to upload
          </div>
          <div style={{ marginTop: 2, fontSize: 11, color: 'var(--po-text-subtle)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {acceptedCount} file{acceptedCount === 1 ? '' : 's'} · {formatBytes(totalAcceptedBytes)}
          </div>
        </div>
        {acceptedCount > 0 && (
          <div style={{ flex: '0 1 auto', minWidth: 0, fontSize: 11, color: 'var(--po-text-subtle)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {fileStats.textCount} text · {fileStats.binaryCount} docs/images
            {fileStats.extensions.length > 0 && (
              <> · {fileStats.extensions.slice(0, 4).map((ext) => `.${ext}`).join(' ')}</>
            )}
          </div>
        )}
      </div>

      {acceptedCount === 0 ? (
        <div style={{ padding: 18, fontSize: 12, color: 'var(--po-text-subtle)' }}>
          No files will be uploaded with the current settings.
        </div>
      ) : (
        <div style={{ maxHeight: 300, overflow: 'auto', padding: '6px 0' }}>
          {previewTree.rows.map((row, index) => (
            <div
              key={`${row.kind}:${row.path}:${row.depth}:${index}`}
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(0, 1fr) auto',
                alignItems: 'center',
                columnGap: 12,
                minHeight: 30,
                padding: '0 12px',
                color: row.kind === 'folder' ? 'var(--po-text)' : 'var(--po-text-muted)',
                fontSize: 13,
                        }}
                      >
                        <div style={{
                          position: 'relative',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          minWidth: 0,
                          paddingLeft: row.depth > 0
                            ? row.depth * TREE_INDENT + TREE_BRANCH_WIDTH
                            : 0,
                        }}>
                          <TreeBranches depth={row.depth} />
                          <PreviewIcon kind={row.kind} />
                          <span style={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  fontWeight: row.kind === 'folder' ? 500 : 400,
                }}>
                  {row.name}
                </span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--po-text-subtle)', whiteSpace: 'nowrap' }}>
                {row.kind === 'folder'
                  ? `${row.fileCount} file${row.fileCount === 1 ? '' : 's'}`
                  : formatBytes(row.sizeBytes)}
              </div>
            </div>
          ))}
          {previewTree.totalRows > previewTree.rows.length && (
            <div style={{ padding: '7px 12px 8px', fontSize: 12, color: 'var(--po-text-subtle)' }}>
              + {previewTree.totalRows - previewTree.rows.length} more paths
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TreeBranches({ depth }: { depth: number }) {
  if (depth <= 0) return null;

  return (
    <>
      {Array.from({ length: depth }).map((_, index) => (
        <span
          key={index}
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: index * TREE_INDENT + TREE_LINE_X,
            top: -3,
            bottom: -3,
            width: 1,
            background: 'var(--po-filetree-rail)',
            opacity: 0.55,
          }}
        />
      ))}
      <span
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: (depth - 1) * TREE_INDENT + TREE_LINE_X,
          top: '50%',
          width: TREE_BRANCH_WIDTH,
          height: 1,
          background: 'var(--po-filetree-rail)',
          opacity: 0.62,
        }}
      />
    </>
  );
}

function PreviewIcon({ kind }: { kind: PreviewTreeKind }) {
  if (kind === 'folder') {
    return <TreeDisclosureMarker expanded />;
  }

  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path d="M6 3.5h7.25L18 8.25V20.5H6V3.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" opacity="0.7" />
      <path d="M13 3.5V8.5H18" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" opacity="0.7" />
    </svg>
  );
}
