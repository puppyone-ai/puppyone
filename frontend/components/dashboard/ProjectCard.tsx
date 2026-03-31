'use client';

import React, { useState } from 'react';
import type { ProjectInfo } from '@/lib/projectsApi';

export const PROJECT_CARD_WIDTH = 280;
export const PROJECT_CARD_HEIGHT = 140;

const ConnectorIcon = ({ size = 12 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22v-5" />
    <path d="M9 8V2" />
    <path d="M15 8V2" />
    <path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z" />
  </svg>
);

export interface ProjectCardProps {
  project: ProjectInfo;
  onClick: () => void;
}

export function ProjectCard({ project, onClick }: ProjectCardProps) {
  const [copied, setCopied] = useState(false);

  const handleCopyId = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(project.id).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const lastUpdated = project.updated_at
    ? formatRelativeTime(project.updated_at)
    : '—';
  const connectionCount = project.connection_count ?? 0;

  return (
    <div
      onClick={onClick}
      className="group relative w-full h-full flex flex-col rounded-lg bg-[#111] border border-[#222] hover:border-[#3a3a3a] hover:bg-[#161616] cursor-pointer transition-colors duration-150 overflow-hidden"
      style={{ minHeight: PROJECT_CARD_HEIGHT }}
    >
      {/* Main content */}
      <div className="flex-1 p-4 pb-3">
        <div className="flex items-start justify-between w-full">
          <h3 className="text-[15px] font-medium text-[#eee] truncate leading-tight group-hover:text-white transition-colors">
            {project.name}
          </h3>

          {/* Copy ID */}
          <button
            className="flex-shrink-0 text-[#555] hover:text-[#eee] p-1 -mr-1 -mt-0.5 rounded transition-colors opacity-0 group-hover:opacity-100"
            onClick={handleCopyId}
            title={copied ? 'Copied!' : 'Copy Project ID'}
          >
            {copied ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            )}
          </button>
        </div>

        {project.description && (
          <p className="text-xs text-[#555] mt-1.5 line-clamp-2 leading-relaxed">
            {project.description}
          </p>
        )}
      </div>

      {/* Footer band — visually separate strip */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-[#0c0c0c] group-hover:bg-[#131313] transition-colors">
        <span className="text-[11px] text-[#555]">
          {lastUpdated}
        </span>

        <div className="flex items-center gap-1 text-[#555]">
          <ConnectorIcon size={12} />
          <span className="text-[11px] font-mono">{connectionCount}</span>
        </div>
      </div>
    </div>
  );
}

export function NewProjectCard({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="group w-full h-full flex flex-col items-center justify-center gap-2.5 rounded-lg border border-dashed border-[#333] hover:border-[#555] hover:bg-[#111] bg-transparent cursor-pointer transition-colors duration-150"
      style={{ minHeight: PROJECT_CARD_HEIGHT }}
    >
      <div className="w-7 h-7 rounded-full flex items-center justify-center bg-[#1a1a1a] group-hover:bg-[#222] transition-colors">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-[#666] group-hover:text-[#eee] transition-colors">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </div>
      <span className="text-[13px] text-[#666] group-hover:text-[#eee] font-medium transition-colors">
        New Project
      </span>
    </button>
  );
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}
