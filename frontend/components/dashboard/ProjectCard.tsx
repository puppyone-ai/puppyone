'use client';

import React, { useState } from 'react';
import type { ProjectInfo } from '@/lib/projectsApi';

/** 固定卡片尺寸 */
export const PROJECT_CARD_WIDTH = 260;
export const PROJECT_CARD_HEIGHT = 140;

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

  return (
    <div
      onClick={onClick}
      className='group relative w-full h-full flex flex-col p-4 rounded bg-[#1C1C1C] border border-[#333] hover:border-[#555] hover:bg-[#222] cursor-pointer transition-all duration-200'
      style={{
        maxWidth: PROJECT_CARD_WIDTH,
        minHeight: PROJECT_CARD_HEIGHT,
      }}
    >
      {/* 顶部布局：图标 + 名称 + 复制按钮 */}
      <div className='flex items-start justify-between w-full'>
        <div className='flex items-start gap-3 min-w-0 pr-1'>
          {/* 文件夹图标 */}
          <div className='flex-shrink-0 mt-0.5 text-[#888] group-hover:text-[#CCC] transition-colors'>
             <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
               <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
             </svg>
          </div>
          
          <div className='flex flex-col min-w-0'>
            <h3 className='text-sm font-medium text-[#eee] truncate leading-tight group-hover:text-white transition-colors'>
              {project.name}
            </h3>
            <span className='text-[11px] text-[#555] font-mono mt-1 truncate'>
              {project.id}
            </span>
          </div>
        </div>

        {/* Copy Button */}
        <button
          className='flex-shrink-0 text-[#555] hover:text-[#eee] p-1.5 -mr-1.5 -mt-1.5 rounded transition-colors opacity-0 group-hover:opacity-100'
          onClick={handleCopyId}
          title="Copy Project ID"
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
    </div>
  );
}
