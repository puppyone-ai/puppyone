'use client';

import React, { useState } from 'react';
import { ProjectCard, NewProjectCard, PROJECT_CARD_WIDTH, getFileIcon } from './ProjectCard';
import type { ProjectInfo } from '@/lib/projectsApi';
import Image from 'next/image';

/* ── Template definitions ── */

interface PreviewLine {
  name: string;
  type: 'folder' | 'markdown' | 'json';
  depth: number;
}

interface TemplateItem {
  id: string;
  name: string;
  description: string;
  preview: PreviewLine[];
}

const TEMPLATES: TemplateItem[] = [
  {
    id: 'get-started',
    name: 'Get Started',
    description: 'A guided walkthrough — connect data sources, set up agents, and learn how PuppyOne works.',
    preview: [
      { name: 'Getting Started.md', type: 'markdown', depth: 0 },
      { name: 'Guides/', type: 'folder', depth: 0 },
      { name: 'About PuppyOne.md', type: 'markdown', depth: 1 },
      { name: 'Connecting Data.md', type: 'markdown', depth: 1 },
    ]
  },
  {
    id: 'invoice-processing',
    name: 'Check-in & Invoices',
    description: 'Pre-structured schema, expense policies, and inbox folder for an accounting agent.',
    preview: [
      { name: 'Policies/', type: 'folder', depth: 0 },
      { name: 'Expense Policy.md', type: 'markdown', depth: 1 },
      { name: 'Templates/', type: 'folder', depth: 0 },
      { name: 'schema.json', type: 'json', depth: 1 },
    ]
  },
  {
    id: 'seo-management',
    name: 'SEO Management',
    description: 'Brand guidelines, keyword lists, and a content pipeline ready for an SEO agent.',
    preview: [
      { name: 'Brand Guidelines/', type: 'folder', depth: 0 },
      { name: 'Tone of Voice.md', type: 'markdown', depth: 1 },
      { name: 'Keywords/', type: 'folder', depth: 0 },
      { name: 'Target Keywords.md', type: 'markdown', depth: 1 },
    ]
  },
];

function TemplateCard({
  template,
  onClick,
  loading,
}: {
  template: TemplateItem;
  onClick: () => void;
  loading?: boolean;
}) {
  return (
    <div className="relative group w-full">
      {/* ── Floating Folder Preview (Visible on Hover) ── */}
      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-3 opacity-0 group-hover:opacity-100 group-hover:-translate-y-1 transition-all duration-200 pointer-events-none z-50 flex flex-col items-center">
        <div className="w-[210px] h-[210px] flex flex-col drop-shadow-[0_15px_30px_rgba(0,0,0,0.9)]">
          {/* Mini Tab */}
          <div className="h-7 px-3 flex items-center rounded-t-md border-2 border-b-0 border-[#333] self-start bg-[#1c1c1c] relative z-10" style={{ maxWidth: '75%' }}>
            <span className="text-[13px] font-medium text-[#777] truncate">
              {template.name}
            </span>
          </div>
          {/* Mini Body */}
          <div className="bg-[#0a0a0a] border-2 border-[#333] rounded-tr-md rounded-b-md relative overflow-hidden flex flex-col flex-1 -mt-[2px] w-full p-3 pb-7">
            <div className="absolute top-0 left-0 right-0 h-px bg-[linear-gradient(to_right,transparent_0%,rgba(255,255,255,0.05)_10%,rgba(255,255,255,0.05)_90%,transparent_100%)] pointer-events-none z-20" />
            <div className="grid grid-cols-4 gap-x-2 gap-y-3 w-full content-start mt-2">
              {template.preview.map((line, i) => {
                return (
                  <div key={i} className="flex flex-col items-center gap-1.5 relative z-10">
                    <div className="flex items-center justify-center w-8 h-8">
                      <Image
                        src={getFileIcon(line.type)}
                        alt={line.type}
                        width={28}
                        height={28}
                        className="opacity-60"
                      />
                    </div>
                    <span className="text-[9px] text-center truncate w-full text-[#555] leading-tight">
                      {line.name.replace('/', '')}
                    </span>
                  </div>
                );
              })}
            </div>
            
            {/* Mini Commit Bar */}
            <div className="absolute bottom-0 left-0 right-0 border-t-2 border-[#333] bg-[#050505] px-3 py-1.5 h-[26px] flex items-center z-10">
              <div className="flex items-center gap-2 text-[10px] w-full">
                <span className="text-[#555]">preview template</span>
              </div>
            </div>
          </div>
        </div>
        {/* Down Arrow */}
        <div className="w-0 h-0 border-l-[8px] border-l-transparent border-r-[8px] border-r-transparent border-t-[8px] border-t-[#333] -mt-[2px]" />
      </div>

      {/* ── Blueprint Flat Card ── */}
      <button
        onClick={onClick}
        disabled={loading}
        className="w-full h-[90px] rounded-lg border border-dashed border-[#333] group-hover:border-[#555] bg-transparent group-hover:bg-[rgba(255,255,255,0.015)] transition-all duration-150 p-3.5 flex flex-col items-start text-left cursor-pointer disabled:opacity-50"
      >
        <div className="flex items-center gap-2 mb-1.5 w-full">
          <div className="w-1.5 h-1.5 rounded-full bg-[#333] group-hover:bg-[#555] transition-colors shrink-0" />
          <span className="text-[13px] font-medium text-[#555] group-hover:text-[#777] transition-colors truncate">
            {loading ? 'Creating...' : template.name}
          </span>
        </div>
        <p className="text-[11px] text-[#444] group-hover:text-[#555] leading-relaxed line-clamp-2 w-full pr-2 transition-colors">
          {template.description}
        </p>
      </button>
    </div>
  );
}

/* ── DashboardView ── */

export interface DashboardViewProps {
  projects: ProjectInfo[];
  loading?: boolean;
  onProjectClick: (projectId: string) => void;
  onCreateClick: () => void;
  onTemplateClick?: (templateId: string, templateName: string, templateDescription: string) => Promise<void>;
}

export function DashboardView({
  projects,
  loading,
  onProjectClick,
  onCreateClick,
  onTemplateClick,
}: DashboardViewProps) {
  const [creatingTemplate, setCreatingTemplate] = useState<string | null>(null);

  const handleTemplateClick = async (t: TemplateItem) => {
    if (!onTemplateClick || creatingTemplate) return;
    setCreatingTemplate(t.id);
    try {
      await onTemplateClick(t.id, t.name, t.description);
    } finally {
      setCreatingTemplate(null);
    }
  };

  if (loading) {
    return (
      <div className='flex-1 flex flex-col items-center justify-center gap-4 p-8'>
        <div
          className='w-10 h-10 rounded-full animate-spin'
          style={{
            border: '3px solid rgba(255, 255, 255, 0.1)',
            borderTopColor: '#fff',
          }}
        />
        <span className='text-sm text-[rgba(255,255,255,0.5)]'>Loading...</span>
      </div>
    );
  }

  return (
    <div className='flex-1 p-8 overflow-y-auto flex flex-col'>
      <div className='w-full max-w-5xl mx-auto'>
        {/* Header */}
        <div className='mb-10'>
          <h1 className='text-2xl font-semibold text-[#eee] tracking-tight'>
            Projects
          </h1>
          <p className='text-sm text-[#555] mt-1.5'>
            {projects.length} project{projects.length !== 1 ? 's' : ''} in your workspace
          </p>
        </div>

        {/* Projects Grid */}
        <div
          className='grid gap-14'
          style={{
            gridTemplateColumns: `repeat(auto-fill, minmax(${PROJECT_CARD_WIDTH}px, 1fr))`,
          }}
        >
          {projects.map(project => (
            <ProjectCard
              key={project.id}
              project={project}
              onClick={() => onProjectClick(project.id)}
            />
          ))}
          <NewProjectCard onClick={onCreateClick} />
        </div>
      </div>

      {/* Spacer pushes templates to the very bottom */}
      <div className='flex-1' />

      {/* Templates — pinned to page bottom */}
      <div className='w-full max-w-5xl mx-auto pb-4 pt-12'>
        <div className="mb-6 flex items-center justify-between">
          <p className="text-[13px] text-[#555]">
            Start with a template
          </p>
        </div>

        <div
          className='grid gap-14 items-start'
          style={{
            gridTemplateColumns: `repeat(auto-fill, minmax(${PROJECT_CARD_WIDTH}px, 1fr))`,
          }}
        >
          {TEMPLATES.map(t => (
            <TemplateCard
              key={t.id}
              template={t}
              onClick={() => handleTemplateClick(t)}
              loading={creatingTemplate === t.id}
            />
          ))}

          {/* Explore More Button (Blueprint Style) */}
          <button className="w-full h-[90px] rounded-lg border border-dashed border-[#333] hover:border-[#555] bg-transparent hover:bg-[rgba(255,255,255,0.015)] transition-all duration-150 p-3.5 flex flex-col items-center justify-center text-center cursor-pointer group">
            <div className="flex items-center gap-1.5 mb-1.5">
              <span className="text-[14px] text-[#444] group-hover:text-[#666] transition-colors leading-none mt-[1px]">→</span>
              <span className="text-[13px] font-medium text-[#555] group-hover:text-[#777] transition-colors">
                Explore More
              </span>
            </div>
            <p className="text-[11px] text-[#444] group-hover:text-[#555] leading-relaxed transition-colors">
              Browse community marketplace
            </p>
          </button>
        </div>
      </div>
    </div>
  );
}
