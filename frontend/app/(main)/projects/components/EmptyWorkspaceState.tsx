import React from 'react';
import type { ProjectInfo } from '@/lib/projectsApi';

interface EmptyWorkspaceStateProps {
  project: ProjectInfo | null;
  onCreateClick: (e: React.MouseEvent) => void;
}

const DOCS_URL = 'https://github.com/puppyone-ai/puppyone#readme';

export function EmptyWorkspaceState({
  project,
  onCreateClick,
}: EmptyWorkspaceStateProps) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center bg-[#0e0e0e] overflow-hidden min-w-0">
      <div className="flex flex-col items-start">
        <div className="text-[#71717a] text-[13px] font-medium tracking-wide mb-4 px-3">
          PuppyOne: a context base built for agents.
        </div>

        <div className="flex flex-col items-start gap-1 w-full">
          <button 
            onClick={onCreateClick}
            className="group flex items-center gap-3 w-full px-3 py-2.5 rounded-md bg-transparent hover:bg-[rgba(255,255,255,0.04)] transition-colors text-left"
          >
            <svg className="text-[#a1a1aa] group-hover:text-white transition-colors shrink-0" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <span className="text-[13px] text-[#d4d4d8] group-hover:text-white transition-colors font-medium">Create Empty File</span>
          </button>

          <a
            href={DOCS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-center gap-3 w-full px-3 py-2.5 rounded-md bg-transparent hover:bg-[rgba(255,255,255,0.04)] transition-colors no-underline text-left"
          >
            <svg className="text-[#a1a1aa] group-hover:text-white transition-colors shrink-0" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
              <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
            </svg>
            <span className="text-[13px] text-[#d4d4d8] group-hover:text-white transition-colors font-medium">Explore Open Source Docs</span>
          </a>
        </div>
      </div>
    </div>
  );
}
