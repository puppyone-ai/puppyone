'use client';

import type { ComponentProps, CSSProperties, ReactNode } from 'react';
import { ActivityIconButton } from '@/components/ActivityIconButton';
import { ProjectsHeader } from '@/components/ProjectsHeader';
import { PageLoading } from '@/components/loading';
import { EmptyWorkspaceState } from '../../../components/EmptyWorkspaceState';
import { BulkDeleteDialog } from './BulkDeleteDialog';
import { DataPageDialogs } from './DataPageDialogs';
import { DataPageOverlays } from './DataPageOverlays';
import { EditorArea } from './EditorArea';
import { DataNoFileSelectedState } from './DataNoFileSelectedState';
import { SelectionActionBar } from './SelectionActionBar';
import { DataExplorerPane } from './explorer';
import { DataPageRightPanel } from './right-panel';
import { GridView } from './views';

type AccessHeaderProps = {
  isOpen: boolean;
  width: number;
  title: string;
  subtitle?: string;
  showBack: boolean;
  listView: 'overview' | 'detail' | 'settings';
  scopeCount: number;
  scope: { id: string } | null;
  onBack: () => void;
  onOpenSettings: () => void;
  onClose: () => void;
};

type DataWorkspaceSurfaceProps = {
  dialogsProps: ComponentProps<typeof DataPageDialogs>;
  overlaysProps: ComponentProps<typeof DataPageOverlays>;
  bulkDeleteProps: ComponentProps<typeof BulkDeleteDialog>;
  selectionProps: ComponentProps<typeof SelectionActionBar>;
  header: {
    pathSegments: ComponentProps<typeof ProjectsHeader>['pathSegments'];
    projectId: string | null;
    accessPointCount: number;
    actionSlot: ReactNode;
  };
  accessHeader: AccessHeaderProps;
  explorer: {
    hidden: boolean;
    props: ComponentProps<typeof DataExplorerPane>;
  };
  content: {
    isResolvingPath: boolean;
    isEditorView: boolean;
    isProjectIdentityLoading: boolean;
    editorAreaProps: ComponentProps<typeof EditorArea> | null;
    isFolderView: boolean;
    isRootEmptyDecisionLoading: boolean;
    isLoading: boolean;
    showEmptyWorkspace: boolean;
    suppressExplorerSidebar: boolean;
    emptyWorkspaceProps: ComponentProps<typeof EmptyWorkspaceState>;
    noFileSelectedProps: ComponentProps<typeof DataNoFileSelectedState>;
    gridViewProps: ComponentProps<typeof GridView>;
  };
  rightPanelProps: ComponentProps<typeof DataPageRightPanel>;
  accessModalSlot?: ReactNode;
};

export function DataWorkspaceSurface({
  dialogsProps,
  overlaysProps,
  bulkDeleteProps,
  selectionProps,
  header,
  accessHeader,
  explorer,
  content,
  rightPanelProps,
  accessModalSlot,
}: DataWorkspaceSurfaceProps) {
  return (
    <>
      <DataPageDialogs {...dialogsProps} />
      <DataPageOverlays {...overlaysProps} />
      <BulkDeleteDialog {...bulkDeleteProps} />
      <SelectionActionBar {...selectionProps} />

      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          position: 'relative',
          overflow: 'hidden',
        } as CSSProperties}
      >
        <div
          style={{
            flexShrink: 0,
            position: 'relative',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'stretch',
            height: 46,
            overflow: 'visible',
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <ProjectsHeader
              pathSegments={header.pathSegments}
              projectId={header.projectId}
              onProjectsRefresh={() => {}}
              accessPointCount={header.accessPointCount}
              actionSlot={header.actionSlot}
            />
          </div>
          {accessHeader.isOpen ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                paddingLeft: 12,
                paddingRight: 12,
                borderBottom: '1px solid var(--po-divider)',
                borderLeft: '1px solid var(--po-divider)',
                background: 'var(--po-canvas)',
                height: '100%',
                width: accessHeader.width,
                flexShrink: 0,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  width: '100%',
                  minWidth: 0,
                }}
              >
                {accessHeader.showBack && (
                  <ActivityIconButton
                    kind="back"
                    title="Back"
                    onClick={accessHeader.onBack}
                  />
                )}
                <div
                  style={{
                    flex: 1,
                    minWidth: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center',
                    gap: 1,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'baseline',
                      gap: 8,
                      minWidth: 0,
                      fontSize: 13,
                      fontWeight: 600,
                      color: 'var(--po-text)',
                      lineHeight: '18px',
                    }}
                    title={accessHeader.title}
                  >
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {accessHeader.title}
                    </span>
                    {accessHeader.listView === 'overview' && (
                      <span
                        style={{
                          fontSize: 13,
                          fontWeight: 400,
                          color: 'var(--po-text-subtle)',
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        {accessHeader.scopeCount}
                      </span>
                    )}
                  </div>
                  {accessHeader.subtitle && (
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 400,
                        color: 'var(--po-text-subtle)',
                        lineHeight: '14px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={accessHeader.subtitle}
                    >
                      {accessHeader.subtitle}
                    </div>
                  )}
                </div>
                {accessHeader.scope && accessHeader.listView === 'detail' && (
                  <ActivityIconButton
                    kind="settings"
                    title="Settings"
                    onClick={accessHeader.onOpenSettings}
                  />
                )}
                <ActivityIconButton
                  kind="close"
                  title="Close panel"
                  onClick={accessHeader.onClose}
                />
              </div>
            </div>
          ) : null}
        </div>

        <div
          style={{
            flex: 1,
            display: 'flex',
            minHeight: 0,
            position: 'relative',
            zIndex: 70,
          }}
        >
          {!explorer.hidden && <DataExplorerPane {...explorer.props} />}

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              {content.isResolvingPath && (
                <div style={{ flex: 1, background: 'var(--po-canvas)' }}>
                  <PageLoading variant="fill" />
                </div>
              )}

              {content.isEditorView &&
                !content.isResolvingPath &&
                !content.editorAreaProps &&
                content.isProjectIdentityLoading && (
                  <div style={{ flex: 1, background: 'var(--po-canvas)' }}>
                    <PageLoading variant="fill" />
                  </div>
                )}

              {content.isEditorView &&
                !content.isResolvingPath &&
                content.editorAreaProps && (
                  <div style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0 }}>
                    <EditorArea {...content.editorAreaProps} />
                  </div>
                )}

              {content.isFolderView && !content.isResolvingPath && (
                <div style={{ flex: 1, overflow: 'auto', padding: content.suppressExplorerSidebar ? 0 : 24, display: 'flex', flexDirection: 'column' }}>
                  {content.isRootEmptyDecisionLoading ? (
                    <div style={{ flex: 1, minHeight: 200, background: 'var(--po-canvas)' }}>
                      <PageLoading variant="fill" />
                    </div>
                  ) : content.isLoading ? (
                    <div style={{ height: '100%', minHeight: 200 }}>
                      <PageLoading variant="fill" />
                    </div>
                  ) : content.showEmptyWorkspace ? (
                    <EmptyWorkspaceState {...content.emptyWorkspaceProps} />
                  ) : (
                    <DataNoFileSelectedState {...content.noFileSelectedProps} />
                  )}
                </div>
              )}
            </div>
          </div>

          <DataPageRightPanel {...rightPanelProps} />
          {accessModalSlot}
        </div>
      </div>
    </>
  );
}
