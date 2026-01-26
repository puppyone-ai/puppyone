'use client';

import React from 'react';
import type { ProjectInfo } from '@/lib/projectsApi';

export interface ProjectCardProps {
  project: ProjectInfo;
  onClick: () => void;
}

export function ProjectCard({ project, onClick }: ProjectCardProps) {
  // 随机生成一个微妙的渐变色，避免所有卡片一模一样
  // 仅作为极其微弱的背景光晕
  const gradients = [
    'from-blue-500/5 to-transparent',
    'from-purple-500/5 to-transparent',
    'from-emerald-500/5 to-transparent',
    'from-amber-500/5 to-transparent',
  ];
  const randomGradient = gradients[project.name.length % gradients.length];

  return (
    <div
      onClick={onClick}
      className={`group relative flex flex-col justify-end p-5 rounded-xl bg-[#0e0e0e] border border-[#222] cursor-pointer hover:border-[#444] transition-all duration-200 overflow-hidden`}
      style={{ aspectRatio: '1.2/1' }}
    >
      {/* Subtle Background Gradient on Hover */}
      <div className={`absolute inset-0 bg-gradient-to-br ${randomGradient} opacity-0 group-hover:opacity-100 transition-opacity duration-500`} />

      {/* Decorative large icon (watermark style) - optional, removing per request if needed, keeping it very subtle for now */}
      <div className="absolute top-4 right-4 text-[#1a1a1a] group-hover:text-[#222] transition-colors">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
        </svg>
      </div>

      {/* Content: Just the Name */}
      <div className="relative z-10">
        <h3 className="text-lg font-medium text-[#ccc] group-hover:text-white transition-colors truncate tracking-tight">
          {project.name}
        </h3>
        {/* Optional: very subtle description if needed, otherwise hidden */}
        {project.description && (
          <p className="text-[11px] text-[#444] group-hover:text-[#666] transition-colors mt-1 line-clamp-1">
            {project.description}
          </p>
        )}
      </div>
    </div>
  );
}
