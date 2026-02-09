'use client';

import React from 'react';
import type { ProjectInfo } from '@/lib/projectsApi';

/** 固定卡片尺寸 */
export const PROJECT_CARD_WIDTH = 260;
export const PROJECT_CARD_HEIGHT = 140;

export interface ProjectCardProps {
  project: ProjectInfo;
  onClick: () => void;
  onMenuClick?: (e: React.MouseEvent) => void;
}

export function ProjectCard({ project, onClick, onMenuClick }: ProjectCardProps) {
  return (
    <div
      onClick={onClick}
      className='group relative w-full h-full flex flex-col p-4 rounded bg-[#1C1C1C] border border-[#333] hover:border-[#555] hover:bg-[#222] cursor-pointer transition-all duration-200'
      style={{
        maxWidth: PROJECT_CARD_WIDTH,
        minHeight: PROJECT_CARD_HEIGHT,
      }}
    >
      {/* 顶部布局：图标 + 名称 + 菜单 */}
      <div className='flex items-start justify-between w-full'>
        <div className='flex items-start gap-3 min-w-0 pr-1'>
          {/* 文件夹图标 */}
          <div className='flex-shrink-0 mt-0.5 text-[#888] group-hover:text-[#CCC] transition-colors'>
             <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
               <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
             </svg>
          </div>
          
          <div className='flex flex-col min-w-0'>
            {/* 项目名称：与图标同行对齐 */}
            <h3 className='text-sm font-medium text-[#eee] truncate leading-tight group-hover:text-white transition-colors'>
              {project.name}
            </h3>
            {/* ID：放在名字下方 */}
            <span className='text-[11px] text-[#555] font-mono mt-1 truncate'>
              {project.id}
            </span>
          </div>
        </div>

        {/* 菜单按钮 */}
        <button
          className='flex-shrink-0 text-[#555] hover:text-[#eee] p-1 -mr-1 -mt-1 rounded transition-colors'
          onClick={(e) => {
            e.stopPropagation();
            onMenuClick?.(e);
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="1" />
            <circle cx="12" cy="5" r="1" />
            <circle cx="12" cy="19" r="1" />
          </svg>
        </button>
      </div>

      {/* 下方留白或将来扩展内容 */}
    </div>
  );
}
