'use client';

import React from 'react';
import useSWR from 'swr';
import { useTranslations, useFormatter } from 'next-intl';
import { Dots, SkeletonBlock } from '@/components/loading';
import { StatusDot } from '@/components/ui/StatusDot';
import type { ProjectInfo } from '@/lib/projectsApi';
import { listDir, sortNodes, type NodeInfo } from '@/lib/contentTreeApi';
import { FilePreviewIcon } from '@/lib/fileIcons';

export const PROJECT_CARD_MIN_WIDTH = 210;
export const PROJECT_CARD_MAX_SIZE = 260;
export const PROJECT_CARD_GAP = 60;

export interface ProjectCardProps {
  project: ProjectInfo;
  onClick: () => void;
}

const PROJECT_PREVIEW_LIMIT = 8;
const PROJECT_PREVIEW_TIMEOUT_MS = 8_000;

function useProjectCardPreview(projectId: string, enabled: boolean) {
  return useSWR<NodeInfo[]>(
    enabled ? ['project-card-preview', projectId] : null,
    () => listDir(projectId, '', { timeoutMs: PROJECT_PREVIEW_TIMEOUT_MS })
      .then((r) => sortNodes(r.nodes).slice(0, PROJECT_PREVIEW_LIMIT)),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
      dedupingInterval: 60_000,
      keepPreviousData: true,
      errorRetryCount: 3,
      errorRetryInterval: 1_500,
      shouldRetryOnError: true,
    },
  );
}

function ProjectPreviewSkeleton() {
  return (
    <div
      aria-hidden
      className="grid w-full grid-cols-4 content-start gap-x-2 gap-y-3"
    >
      {Array.from({ length: 6 }).map((_, index) => (
        <div
          key={index}
          className="relative z-10 flex min-w-0 flex-col items-center gap-1.5"
        >
          <div className="relative h-8 w-8">
            <SkeletonBlock
              width={16}
              height={7}
              radius={3}
              style={{ position: 'absolute', left: 3, top: 4 }}
            />
            <SkeletonBlock
              width={30}
              height={21}
              radius={4}
              style={{ position: 'absolute', left: 1, top: 9 }}
            />
          </div>
          <SkeletonBlock
            width={['72%', '58%', '66%', '48%'][index % 4]}
            height={8}
            radius={3}
          />
        </div>
      ))}
    </div>
  );
}

export function ProjectCardSkeleton() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading project"
      className="relative flex aspect-square w-full flex-col"
      style={{ maxWidth: PROJECT_CARD_MAX_SIZE, maxHeight: PROJECT_CARD_MAX_SIZE }}
    >
      <div
        className="relative z-10 flex h-8 items-center self-start rounded-t-md border-2 border-b-0 border-[var(--po-border)] px-3.5"
        style={{
          width: '64%',
          background: 'var(--po-project-card-tab)',
        }}
      >
        <SkeletonBlock width="82%" height={12} radius={3} />
      </div>

      <div className="relative -mt-[2px] flex flex-1 flex-col overflow-hidden rounded-tr-lg rounded-b-lg border-2 border-[var(--po-border)] bg-[var(--po-project-card-bg)]">
        <div className="absolute inset-0 p-3 pb-7">
          <ProjectPreviewSkeleton />
        </div>

        <div className="absolute right-0 bottom-0 left-0 z-10 flex h-[30px] items-center border-t border-[var(--po-divider)] px-3 py-1.5">
          <div className="flex w-full items-center gap-2">
            <SkeletonBlock width={6} height={6} radius={999} />
            <SkeletonBlock width="42%" height={9} radius={3} />
          </div>
        </div>
      </div>
    </div>
  );
}

export function ProjectCard({ project, onClick }: Readonly<ProjectCardProps>) {
  const t = useTranslations('home');
  const format = useFormatter();

  const lastUpdated = project.updated_at
    ? format.relativeTime(new Date(project.updated_at), new Date())
    : '—';
  const connectionCount = project.access_point_count ?? 0;
  const isPending = project.id.startsWith('__pending-project__');
  const {
    data: previewData,
    error: previewError,
    isLoading: previewLoading,
    isValidating: previewValidating,
  } = useProjectCardPreview(project.id, !isPending);
  const previewNodes = previewData ?? [];
  const hasPreview = previewNodes.length > 0;
  const previewSettled = previewData !== undefined && !previewError;
  const showPreviewSkeleton =
    !hasPreview && !isPending && (!previewSettled || previewLoading || previewValidating);

  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events
    <div
      onClick={onClick}
      aria-busy={isPending}
      className={`group relative w-full flex flex-col aspect-square transition-[transform] duration-150 ease-out ${isPending ? 'cursor-default' : 'cursor-pointer hover:-translate-y-1'}`}
      style={{ maxWidth: PROJECT_CARD_MAX_SIZE, maxHeight: PROJECT_CARD_MAX_SIZE }}
    >
      {/* Tab */}
      <div
        className="h-8 px-3.5 flex items-center rounded-t-md border-2 border-b-0 border-[var(--po-border)] group-hover:border-[var(--po-border-strong)] self-start relative z-10 transition-colors duration-150"
        style={{
          maxWidth: '75%',
          background: 'var(--po-project-card-tab)',
        }}
      >
        <span className="text-[12.5px] font-semibold truncate text-[var(--po-text-muted)] group-hover:text-[var(--po-text)] transition-colors">
          {project.name}
        </span>
      </div>

      {/* Body */}
      <div
        className="flex-1 bg-[var(--po-project-card-bg)] border-2 border-[var(--po-border)] group-hover:border-[var(--po-border-strong)] rounded-tr-lg rounded-b-lg -mt-[2px] relative overflow-hidden flex flex-col group-hover:bg-[var(--po-project-card-hover-bg)] transition-[background-color,border-color,box-shadow] duration-150 shadow-none group-hover:shadow-[7px_8px_0_var(--po-shadow)]"
      >
        <div className="absolute inset-0 p-3 pb-7">
          {hasPreview ? (
            <div className="grid grid-cols-4 gap-x-2 gap-y-3 w-full content-start">
              {previewNodes.map((node) => (
                <div key={node.id} className="flex flex-col items-center gap-1.5 relative z-10 min-w-0">
                  <div className="flex items-center justify-center w-8 h-8">
                    <FilePreviewIcon
                      type={node.type}
                      name={node.name}
                      size={28}
                      childrenCount={node.children_count ?? undefined}
                    />
                  </div>
                  <span className="text-[10px] text-center truncate w-full text-[var(--po-text-muted)] group-hover:text-[var(--po-text)] transition-colors leading-tight">
                    {node.name}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className={`flex h-full flex-col relative z-10 ${showPreviewSkeleton ? 'justify-start' : 'justify-center'}`}>
              {isPending ? (
                <p className="text-[12px] text-[var(--po-text-muted)] leading-relaxed">
                  Preparing workspace...
                </p>
              ) : showPreviewSkeleton ? (
                <ProjectPreviewSkeleton />
              ) : project.description ? (
                <p className="text-[12px] text-[var(--po-text-muted)] leading-relaxed line-clamp-3">
                  {project.description}
                </p>
              ) : (
                <p className="text-[12px] text-[var(--po-text-muted)] italic">
                  {t('emptyProject')}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Commit bar */}
        <div className="absolute bottom-0 left-0 right-0 border-t border-[var(--po-divider)] bg-transparent px-3 py-1.5 h-[30px] flex items-center z-10 transition-colors duration-150">
          <div className="flex items-center gap-2 text-[10px] w-full">
            <StatusDot
              status={connectionCount > 0 ? 'connected' : 'inactive'}
              style={{ backgroundColor: connectionCount > 0 ? 'var(--po-accent)' : 'var(--po-border-strong)' }}
            />
            <span className="text-[var(--po-text-subtle)]">{isPending ? 'opening...' : lastUpdated}</span>
            {!isPending && connectionCount > 0 && (
              <>
                <span className="text-[var(--po-border)]">·</span>
                <span className="text-[var(--po-text-muted)]">{connectionCount}</span>
                <span className="text-[var(--po-text-subtle)]">conn</span>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function NewProjectCard({
  onClick,
  disabled,
  loading,
  label,
}: Readonly<{ onClick: () => void; disabled?: boolean; loading?: boolean; label?: string }>) {
  const t = useTranslations('home');
  const resolvedLabel = label ?? (loading ? 'Creating...' : t('newProject'));

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-busy={loading || undefined}
      className="group relative flex aspect-square w-full cursor-pointer flex-col bg-transparent text-[var(--po-text-muted)] transition-[transform,color] duration-150 ease-out hover:-translate-y-1 hover:text-[var(--po-text)] disabled:cursor-default disabled:opacity-60 disabled:hover:translate-y-0"
      style={{ maxWidth: PROJECT_CARD_MAX_SIZE, maxHeight: PROJECT_CARD_MAX_SIZE }}
    >
      <div
        className="h-8 w-16 rounded-t-md border-2 border-b-0 border-dashed border-[var(--po-border)] bg-transparent transition-colors group-hover:border-[var(--po-border-strong)]"
        aria-hidden
      />
      <div className="-mt-[2px] flex flex-1 flex-col items-center justify-center gap-3 rounded-tr-lg rounded-b-lg border-2 border-dashed border-[var(--po-border)] bg-transparent transition-[border-color,box-shadow] duration-150 group-hover:border-[var(--po-border-strong)] group-hover:shadow-[7px_8px_0_var(--po-shadow)]">
        {loading ? (
          <Dots size="sm" tone="neutral" ariaLabel="Creating project" />
        ) : (
          <svg
            width="30"
            height="30"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            aria-hidden
            className="text-[var(--po-text-muted)] transition-colors group-hover:text-[var(--po-text)]"
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        )}
        <span className="text-[13px] font-semibold transition-colors">
          {resolvedLabel}
        </span>
      </div>
    </button>
  );
}
