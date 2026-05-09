'use client';

import React, { useState } from 'react';
import Image from 'next/image';
import { useTranslations, useFormatter } from 'next-intl';
import type { ProjectInfo } from '@/lib/projectsApi';

export const PROJECT_CARD_MIN_WIDTH = 210;
export const PROJECT_CARD_MAX_SIZE = 260;
export const PROJECT_CARD_GAP = 60;

const ACCENT = '#329955';

const FILE_ICON_MAP: Record<string, string> = {
  folder: '/icons/folder.svg',
  json: '/icons/json-doc.svg',
  markdown: '/icons/markdown-doc.svg',
  file: '/icons/markdown-doc.svg',
};

export function getFileIcon(type: string): string {
  return FILE_ICON_MAP[type] || FILE_ICON_MAP.file;
}

export interface ProjectCardProps {
  project: ProjectInfo;
  onClick: () => void;
}

export function ProjectCard({ project, onClick }: Readonly<ProjectCardProps>) {
  const [copied, setCopied] = useState(false);
  const t = useTranslations('home');
  const tc = useTranslations('common');
  const format = useFormatter();

  const handleCopyId = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(project.id).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const lastUpdated = project.updated_at
    ? format.relativeTime(new Date(project.updated_at), new Date())
    : '—';
  const connectionCount = project.access_point_count ?? 0;
  const nodes = project.nodes ?? [];
  const displayNodes = nodes.slice(0, 8);

  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events
    <div
      onClick={onClick}
      className="group relative w-full flex flex-col cursor-pointer aspect-square"
      style={{ maxWidth: PROJECT_CARD_MAX_SIZE, maxHeight: PROJECT_CARD_MAX_SIZE }}
    >
      {/* Tab */}
      <div className="h-7 px-3 flex items-center rounded-t-md border-2 border-b-0 border-[#2a2a2a] group-hover:border-[#329955] self-start relative z-10 bg-[#1c1c1c] group-hover:bg-[#252525] transition-colors duration-150" style={{ maxWidth: '75%' }}>
        <span className="text-[13px] font-medium truncate text-[#888] group-hover:text-[#329955] transition-colors">
          {project.name}
        </span>
        <button
          className="ml-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity p-0.5"
          onClick={handleCopyId}
          title={copied ? tc('copied') : t('copyId')}
        >
          {copied ? (
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke={ACCENT} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : (
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          )}
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 bg-[#0a0a0a] border-2 border-[#2a2a2a] group-hover:border-[#329955] rounded-tr-lg rounded-b-lg -mt-[2px] relative overflow-hidden flex flex-col group-hover:bg-[#111111] transition-colors duration-150">
        <div className="absolute top-0 left-0 right-0 h-px bg-[linear-gradient(to_right,transparent_0%,rgba(255,255,255,0.05)_10%,rgba(255,255,255,0.05)_90%,transparent_100%)] pointer-events-none z-20" />
        <div className="absolute inset-0 p-3 pb-7">
          {displayNodes.length > 0 ? (
            <div className="grid grid-cols-4 gap-x-2 gap-y-3 w-full content-start">
              {displayNodes.map((node, i) => (
                <div key={node.id || i} className="flex flex-col items-center gap-1.5 relative z-10">
                  <div className="flex items-center justify-center w-8 h-8">
                    <Image
                      src={getFileIcon(node.type)}
                      alt={node.type}
                      width={28}
                      height={28}
                      className="opacity-60 group-hover:opacity-90 transition-opacity"
                    />
                  </div>
                  <span className="text-[10px] text-center truncate w-full text-[#555] group-hover:text-[#888] transition-colors leading-tight">
                    {node.name}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col justify-center h-full relative z-10">
              {project.description ? (
                <p className="text-[12px] text-[#555] leading-relaxed line-clamp-3">
                  {project.description}
                </p>
              ) : (
                <p className="text-[12px] text-[#444] italic">
                  {t('emptyProject')}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Commit bar */}
        <div className="absolute bottom-0 left-0 right-0 border-t border-[#2a2a2a] bg-transparent px-3 py-1.5 h-[26px] flex items-center z-10 transition-colors duration-150">
          <div className="flex items-center gap-2 text-[10px] w-full">
            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: connectionCount > 0 ? '#4ECDC4' : '#333' }} />
            <span className="text-[#555]">{lastUpdated}</span>
            {connectionCount > 0 && (
              <>
                <span className="text-[#333]">·</span>
                <span className="text-[#4ECDC4]">{connectionCount}</span>
                <span className="text-[#444]">conn</span>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function NewProjectCard({ onClick }: Readonly<{ onClick: () => void }>) {
  const t = useTranslations('home');
  return (
    <button
      onClick={onClick}
      className="group relative w-full flex flex-col cursor-pointer aspect-square"
      style={{ maxWidth: PROJECT_CARD_MAX_SIZE, maxHeight: PROJECT_CARD_MAX_SIZE }}
    >
      <div
        className="h-7 w-16 rounded-t-md border-2 border-b-0 border-dashed border-[#333] group-hover:border-[#555] self-start bg-transparent group-hover:bg-[rgba(255,255,255,0.02)] transition-colors relative z-10"
        aria-hidden
      />
      <div className="flex-1 border-2 border-dashed border-[#333] group-hover:border-[#555] rounded-tr-lg rounded-b-lg -mt-[2px] relative overflow-hidden flex flex-col items-center justify-center bg-transparent group-hover:bg-[rgba(255,255,255,0.02)] transition-colors duration-150">
        <div className="w-10 h-10 rounded-full flex items-center justify-center bg-[#111] group-hover:bg-[#1a1a1a] transition-colors">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-[#555] group-hover:text-[#eee] transition-colors">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </div>
        <span className="text-[13px] text-[#555] group-hover:text-[#ccc] font-medium transition-colors mt-2.5">
          {t('newProject')}
        </span>
      </div>
    </button>
  );
}
