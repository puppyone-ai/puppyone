import React from 'react';
import type { ProjectInfo } from '@/lib/projectsApi';
import { GithubIcon, NotionIcon, LinearIcon } from '@/lib/nodeTypeConfig';

interface EmptyWorkspaceStateProps {
  project: ProjectInfo | null;
  onConnectClick: () => void;
  onOpenGuide: () => void;
  onCreateClick: (e: React.MouseEvent) => void;
}

export function EmptyWorkspaceState({
  project,
  onConnectClick,
  onOpenGuide,
  onCreateClick,
}: EmptyWorkspaceStateProps) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-[#0a0a0a]">
      <div className="text-[#52525b] text-[14px] font-medium tracking-wide mb-8">
        PuppyOne: a context base built for agents.
      </div>

      {/* Action Links */}
      <div className="flex flex-col items-center gap-2">
        <button 
          onClick={onConnectClick}
          className="group flex items-center justify-between w-[520px] px-3 py-2.5 rounded-md bg-[#0a0a0a] border border-transparent hover:border-[#27272a] hover:bg-[#141416] transition-all text-left"
        >
          <div className="flex flex-col gap-1.5">
            <div className="text-[13px] font-medium text-[#d4d4d8] group-hover:text-white transition-colors">
              Connect & transform contexts for Agents
            </div>
            <div className="flex items-center gap-1 text-[#52525b] group-hover:text-[#a1a1aa] transition-colors">
              <div className="flex items-center gap-2 mr-1">
                <GithubIcon size={12} />
                <NotionIcon size={12} />
                <LinearIcon size={12} />
              </div>
              <span className="text-[11px] font-medium text-[#71717a] group-hover:text-[#a1a1aa] transition-colors">100+ Apps</span>
              <span className="text-[11px] opacity-30 mx-0.5">|</span>
              <span className="text-[11px]">Transform Software Data into files for Agents</span>
            </div>
          </div>
        </button>

        <button 
          onClick={onConnectClick}
          className="group flex items-center justify-between w-[520px] px-3 py-2.5 rounded-md bg-[#0a0a0a] border border-transparent hover:border-[#27272a] hover:bg-[#141416] transition-all text-left mt-1"
        >
          <div className="flex flex-col gap-1.5">
            <div className="text-[13px] font-medium text-[#d4d4d8] group-hover:text-white transition-colors">
              Govern & version-control contexts for Agents
            </div>
            <div className="flex items-center gap-1.5 text-[#52525b] group-hover:text-[#a1a1aa] transition-colors">
              <span className="text-[12px]">🦞</span>
              <span className="text-[11px] font-medium text-[#71717a] group-hover:text-[#a1a1aa] transition-colors">OpenClaw</span>
              <span className="text-[11px] opacity-30 mx-0.5">|</span>
              <span className="text-[11px]">Add auth, version control, and audit logs to your context</span>
            </div>
          </div>
        </button>

        <div className="w-[520px] h-[1px] bg-[#1f1f23] my-1"></div>

        <button 
          onClick={onCreateClick}
          className="group flex items-center gap-3 w-[520px] px-3 py-2 rounded-md bg-[#0a0a0a] border border-transparent hover:border-[#27272a] hover:bg-[#141416] transition-all text-left"
        >
          <div className="text-[#a1a1aa] group-hover:text-[#e4e4e7] transition-colors">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </div>
          <span className="text-[13px] font-medium text-[#d4d4d8] group-hover:text-white transition-colors">Create Empty File</span>
        </button>

        <button 
          onClick={onOpenGuide}
          className="group flex items-center gap-3 w-[520px] px-3 py-2 rounded-md bg-[#0a0a0a] border border-transparent hover:border-[#27272a] hover:bg-[#141416] transition-all text-left"
        >
          <div className="text-[#a1a1aa] group-hover:text-[#e4e4e7] transition-colors">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
              <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
            </svg>
          </div>
          <span className="text-[13px] font-medium text-[#d4d4d8] group-hover:text-white transition-colors">Read Quick Start</span>
        </button>
      </div>
    </div>
  );
}
