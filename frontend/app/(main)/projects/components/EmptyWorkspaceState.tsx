import React, {
  useCallback,
  useMemo,
  useRef,
  useState,
  type DragEvent,
} from 'react';
import {
  ArrowUpRight,
  Check,
  Copy,
  Upload,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ProjectInfo } from '@/lib/projectsApi';
import {
  resolveDataTransferSnapshot,
  snapshotDataTransfer,
} from '@/lib/dropFiles';
import { BUTTON_HEIGHT, BUTTON_ICON_SIZE } from '@/components/ui/buttonTokens';

interface EmptyWorkspaceStateProps {
  project: ProjectInfo | null;
  gitRemoteUrl?: string | null;
  onOpenGitSetup?: () => void;
  onImportFiles?: () => void;
  onFilesDrop?: (files: File[]) => void;
  onImportGitHub?: () => void;
  onOpenEmptyProject?: () => void;
}

type CopyTarget = 'agent' | 'new' | 'existing' | null;
type GitCommandTarget = 'new' | 'existing';

const COPY_RESET_MS = 1400;
const EMPTY_WORKSPACE_RAIL_WIDTH = 620;

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function slugForDirectory(value: string): string {
  return (
    value
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, '-')
      .replaceAll(/^-+|-+$/g, '') || 'puppyone-project'
  );
}

function hasExternalFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer.types).includes('Files');
}

export function EmptyWorkspaceState({
  project,
  gitRemoteUrl,
  onOpenGitSetup,
  onImportFiles,
  onFilesDrop,
  onImportGitHub,
  onOpenEmptyProject,
}: EmptyWorkspaceStateProps) {
  const [copied, setCopied] = useState<CopyTarget>(null);
  const [activeCommand, setActiveCommand] = useState<GitCommandTarget>('new');
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const projectName = project?.name || 'this project';
  const remote = gitRemoteUrl || '<git-remote-url>';
  const hasRemote = Boolean(gitRemoteUrl);
  const directoryName = slugForDirectory(project?.name || 'puppyone-project');

  const setup = useMemo(() => {
    const quotedRemote = shellQuote(remote);
    const quotedDir = shellQuote(directoryName);
    const newRepository = [
      '# Initialize a new local repository with Git',
      `mkdir ${quotedDir}`,
      `cd ${quotedDir}`,
      'git init',
      'git branch -M main',
      `git remote add origin ${quotedRemote}`,
      'git add .',
      'git commit -m "Initial context"',
      'git push -u origin main',
    ].join('\n');

    const existingRepository = [
      '# Push an existing Git repository into this project',
      `git remote add puppyone ${quotedRemote}`,
      'git push -u puppyone HEAD:main',
    ].join('\n');

    const newRepositoryPrompt = [
      `Initialize a new local repository and push it into the PuppyOne project "${projectName}".`,
      '',
      `PuppyOne Git remote: ${remote}`,
      '',
      'Run these commands from the folder that should become the project:',
      '```bash',
      newRepository,
      '```',
      '',
      'After pushing, report which files were imported and whether Git returned any errors.',
    ].join('\n');

    const existingRepositoryPrompt = [
      `Push the current Git repository into the PuppyOne project "${projectName}".`,
      '',
      `PuppyOne Git remote: ${remote}`,
      '',
      'Run these commands from the existing repository:',
      '```bash',
      existingRepository,
      '```',
      '',
      'After pushing, report which branch was pushed and whether Git returned any errors.',
    ].join('\n');

    return { newRepository, existingRepository, newRepositoryPrompt, existingRepositoryPrompt };
  }, [directoryName, projectName, remote]);

  const copyText = useCallback(async (target: CopyTarget, text: string) => {
    if (!target || !hasRemote) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(target);
      window.setTimeout(() => setCopied(null), COPY_RESET_MS);
    } catch {
      setCopied(null);
    }
  }, [hasRemote]);

  const handleDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!hasExternalFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    setIsDraggingFiles(false);
    const snapshot = snapshotDataTransfer(event.nativeEvent);
    void resolveDataTransferSnapshot(snapshot).then((files) => {
      if (files.length > 0) onFilesDrop?.(files);
    });
  }, [onFilesDrop]);

  return (
    <div className="flex-1 bg-[var(--po-canvas)] overflow-auto min-w-0">
      <div
        className="mx-auto flex min-h-full w-full flex-col justify-center px-8 py-14"
        style={{ maxWidth: EMPTY_WORKSPACE_RAIL_WIDTH }}
      >
        <ChoiceLabel title="Choice 1: Initialize with uploaded files" isFirst />
        <UploadPrimaryPanel
          isDraggingFiles={isDraggingFiles}
          onDragStateChange={setIsDraggingFiles}
          onDrop={handleDrop}
          onImportFiles={onImportFiles}
          onFilesSelected={onFilesDrop}
        />

        <ChoiceLabel title="Choice 2: Initialize with Git" />

        <GitFramedRow
          hasRemote={hasRemote}
          copied={copied}
          onOpenGitSetup={onOpenGitSetup}
          onCopyAgentPrompt={() => copyText(
            'agent',
            activeCommand === 'new' ? setup.newRepositoryPrompt : setup.existingRepositoryPrompt,
          )}
          activeCommand={activeCommand}
          activeCommandText={activeCommand === 'new' ? setup.newRepository : setup.existingRepository}
          onActiveCommandChange={setActiveCommand}
          onCopyCommand={() => copyText(activeCommand, activeCommand === 'new' ? setup.newRepository : setup.existingRepository)}
        />

        <ChoiceLabel title="Choice 3: Import from GitHub" />

        <div className="flex flex-wrap items-center gap-3">
          <SourceActionButton
            icon={GitHubMark}
            label="Import from GitHub"
            onActivate={onImportGitHub}
            opensExternal
          />
        </div>

        <div className="mt-4">
          <button
            type="button"
            onClick={onOpenEmptyProject}
            disabled={!onOpenEmptyProject}
            className="inline-flex items-center rounded-md px-2 text-[12px] font-medium text-[var(--po-text-muted)] transition-colors hover:bg-[var(--po-hover)] hover:text-[var(--po-text)] disabled:cursor-not-allowed disabled:opacity-45"
            style={{ height: BUTTON_HEIGHT }}
          >
            Open empty project
          </button>
        </div>
      </div>
    </div>
  );
}

function UploadPrimaryPanel({
  isDraggingFiles,
  onDragStateChange,
  onDrop,
  onImportFiles,
  onFilesSelected,
}: {
  isDraggingFiles: boolean;
  onDragStateChange: (value: boolean) => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  onImportFiles?: () => void;
  onFilesSelected?: (files: File[]) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const canPickDirectly = Boolean(onFilesSelected);

  const handleInputChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = event.target.files ? Array.from(event.target.files) : [];
    event.target.value = '';
    if (selectedFiles.length > 0) {
      onFilesSelected?.(selectedFiles);
    }
  }, [onFilesSelected]);

  return (
    <section
      onDragEnter={(event) => {
        if (!hasExternalFiles(event)) return;
        event.preventDefault();
        onDragStateChange(true);
      }}
      onDragOver={(event) => {
        if (!hasExternalFiles(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
        onDragStateChange(true);
      }}
      onDragLeave={(event) => {
        const current = event.currentTarget;
        const next = event.relatedTarget;
        if (next instanceof Node && current.contains(next)) return;
        onDragStateChange(false);
      }}
      onDrop={onDrop}
      className={`flex min-h-[152px] flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-5 py-7 text-center transition-[background-color,border-color] duration-150 ease-out motion-reduce:transition-none ${
        isDraggingFiles
          ? 'border-[var(--po-focus-ring)] bg-[var(--po-selected)]'
          : 'border-[var(--po-border-strong)] bg-transparent'
      }`}
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        onChange={handleInputChange}
        style={{ display: 'none' }}
      />
      <input
        ref={folderInputRef}
        type="file"
        multiple
        {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
        onChange={handleInputChange}
        style={{ display: 'none' }}
      />
      <Upload
        size={22}
        strokeWidth={1.5}
        className={isDraggingFiles ? 'text-[var(--po-accent)]' : 'text-[var(--po-text-subtle)]'}
      />
      <div className="text-[13px] leading-5 text-[var(--po-text-muted)]">
        Drag and drop files or folders here
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <button
          type="button"
          onClick={() => {
            if (canPickDirectly) {
              fileInputRef.current?.click();
            } else {
              onImportFiles?.();
            }
          }}
          disabled={!canPickDirectly && !onImportFiles}
          className="inline-flex items-center rounded-md border border-[var(--po-border-strong)] bg-transparent px-3.5 text-[13px] font-medium text-[var(--po-text)] transition-[background-color,border-color] duration-150 hover:border-[var(--po-border-strong)] hover:bg-[var(--po-border-subtle)] disabled:cursor-not-allowed disabled:opacity-45"
          style={{ height: BUTTON_HEIGHT }}
        >
          Upload Files
        </button>
        <button
          type="button"
          onClick={() => folderInputRef.current?.click()}
          disabled={!canPickDirectly}
          className="inline-flex items-center rounded-md border border-[var(--po-border-strong)] bg-transparent px-3.5 text-[13px] font-medium text-[var(--po-text)] transition-[background-color,border-color] duration-150 hover:border-[var(--po-border-strong)] hover:bg-[var(--po-border-subtle)] disabled:cursor-not-allowed disabled:opacity-45"
          style={{ height: BUTTON_HEIGHT }}
        >
          Upload Folder
        </button>
      </div>
    </section>
  );
}

function ChoiceLabel({
  title,
  isFirst = false,
}: {
  title: string;
  isFirst?: boolean;
}) {
  return (
    <div className={`mb-3 ${isFirst ? 'mt-0' : 'mt-10'}`}>
      <span className="text-[17px] font-semibold leading-6 text-[var(--po-text)]">
        {title}
      </span>
    </div>
  );
}

function GitFramedRow({
  hasRemote,
  copied,
  onOpenGitSetup,
  onCopyAgentPrompt,
  activeCommand,
  activeCommandText,
  onActiveCommandChange,
  onCopyCommand,
}: {
  hasRemote: boolean;
  copied: CopyTarget;
  onOpenGitSetup?: () => void;
  onCopyAgentPrompt: () => void;
  activeCommand: GitCommandTarget;
  activeCommandText: string;
  onActiveCommandChange: (value: GitCommandTarget) => void;
  onCopyCommand: () => void;
}) {
  return (
    <div className="space-y-2">
      {!hasRemote && onOpenGitSetup ? (
        <button
          type="button"
          onClick={onOpenGitSetup}
          className="inline-flex items-center rounded-md border border-[var(--po-border)] bg-[color-mix(in_srgb,var(--po-panel)_58%,transparent)] px-3 text-[12px] font-medium text-[var(--po-text)] transition-colors hover:border-[var(--po-border-strong)] hover:bg-[color-mix(in_srgb,var(--po-panel)_72%,transparent)]"
          style={{ height: BUTTON_HEIGHT }}
        >
          Create Git remote
        </button>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div
          role="tablist"
          aria-label="Git initialization command type"
          className="inline-flex items-end gap-4 border-b border-[var(--po-border-subtle)]"
          style={{ height: BUTTON_HEIGHT }}
        >
          <CommandTab
            active={activeCommand === 'new'}
            label="New repository"
            onClick={() => onActiveCommandChange('new')}
          />
          <CommandTab
            active={activeCommand === 'existing'}
            label="Existing repository"
            onClick={() => onActiveCommandChange('existing')}
          />
        </div>
        <AgentPromptButton
          copied={copied === 'agent'}
          disabled={!hasRemote}
          onClick={onCopyAgentPrompt}
        />
      </div>

      <div className="relative">
        <button
          type="button"
          disabled={!hasRemote}
          onClick={onCopyCommand}
          aria-label={copied === activeCommand ? 'Copied command lines' : 'Copy command lines'}
          title={copied === activeCommand ? 'Copied' : 'Copy'}
          className="absolute right-2 top-2 z-10 inline-flex shrink-0 items-center justify-center rounded-md border border-[var(--po-border-subtle)] bg-[color-mix(in_srgb,var(--po-panel)_72%,transparent)] text-[var(--po-text-muted)] transition-colors hover:border-[var(--po-border)] hover:bg-[var(--po-hover)] hover:text-[var(--po-text)] disabled:cursor-not-allowed disabled:opacity-45"
          style={{ width: BUTTON_ICON_SIZE, height: BUTTON_ICON_SIZE }}
        >
          {copied === activeCommand ? <Check size={13} strokeWidth={1.9} /> : <Copy size={13} strokeWidth={1.75} />}
        </button>
        <pre className="m-0 max-h-[156px] overflow-auto rounded-md border border-[var(--po-border-subtle)] bg-[color-mix(in_srgb,var(--po-canvas)_58%,transparent)] p-3 pr-12 text-[11px] leading-[18px] text-[var(--po-text-muted)]">
          <code>{activeCommandText}</code>
        </pre>
      </div>
    </div>
  );
}

function CommandTab({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`relative rounded-none border-0 bg-transparent px-0 text-[12px] font-medium transition-colors ${
        active
          ? 'text-[var(--po-text)] after:absolute after:inset-x-0 after:bottom-[-1px] after:h-px after:bg-[var(--po-text)]'
          : 'text-[var(--po-text-subtle)] hover:text-[var(--po-text-muted)]'
      }`}
      style={{ height: BUTTON_HEIGHT }}
    >
      {label}
    </button>
  );
}

function AgentPromptButton({
  copied,
  disabled,
  onClick,
}: {
  copied: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-label="Copy setup prompt for Claude Code, Codex, and Cursor"
      className="inline-flex w-fit shrink-0 items-center gap-2 rounded-full border border-[var(--po-border)] bg-[var(--po-text)] px-3 text-[12px] font-medium text-[var(--po-canvas)] transition-colors hover:bg-[var(--po-text-muted)] disabled:cursor-not-allowed disabled:opacity-45"
      style={{ height: BUTTON_HEIGHT }}
    >
      <span className="inline-flex min-w-0 items-center gap-2">
        {copied ? <Check size={14} strokeWidth={1.9} /> : <Copy size={14} strokeWidth={1.75} />}
        <span className="truncate">{copied ? 'Copied' : 'Copy setup prompt'}</span>
      </span>
    </button>
  );
}

function GitHubMark({
  className,
}: {
  className?: string;
}) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className={className}
      fill="currentColor"
    >
      <path d="M8 0C3.58 0 0 3.67 0 8.2c0 3.63 2.29 6.7 5.47 7.79.4.08.55-.18.55-.4 0-.2-.01-.86-.01-1.56-2.01.38-2.53-.5-2.69-.96-.09-.24-.48-.96-.82-1.15-.28-.15-.68-.52-.01-.53.63-.01 1.08.59 1.23.83.72 1.24 1.87.89 2.33.68.07-.53.28-.89.51-1.1-1.78-.21-3.64-.91-3.64-4.04 0-.89.31-1.62.82-2.2-.08-.21-.36-1.04.08-2.17 0 0 .67-.22 2.2.84A7.4 7.4 0 0 1 8 3.96a7.4 7.4 0 0 1 2 .27c1.52-1.06 2.19-.84 2.19-.84.44 1.13.16 1.96.08 2.17.51.58.82 1.31.82 2.2 0 3.14-1.87 3.83-3.65 4.04.29.26.54.75.54 1.52 0 1.1-.01 1.98-.01 2.25 0 .22.15.48.55.4A8.13 8.13 0 0 0 16 8.2C16 3.67 12.42 0 8 0Z" />
    </svg>
  );
}

function SourceActionButton({
  icon: Icon,
  label,
  onActivate,
  onClick,
  opensExternal = false,
}: {
  icon: LucideIcon | React.ComponentType<{ className?: string }>;
  label: string;
  onActivate?: () => void;
  onClick?: (event: React.MouseEvent) => void;
  opensExternal?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={!onActivate && !onClick}
      onClick={onClick || (() => onActivate?.())}
      className="group inline-flex w-fit min-w-0 items-center gap-2 rounded-md border border-[var(--po-border-subtle)] bg-[color-mix(in_srgb,var(--po-panel)_58%,transparent)] px-3 text-left text-[var(--po-text)] transition-colors hover:border-[var(--po-border)] hover:bg-[color-mix(in_srgb,var(--po-panel)_72%,transparent)] disabled:cursor-not-allowed disabled:opacity-45"
      style={{ height: BUTTON_HEIGHT }}
    >
      <Icon
        className="h-4 w-4 shrink-0 text-current"
        size={15}
        strokeWidth={1.75}
      />
      <span className="min-w-0 truncate text-[12px] font-medium leading-5">
        {label}
      </span>
      {opensExternal ? (
        <ArrowUpRight
          className="shrink-0 text-[var(--po-text-muted)] transition-colors group-hover:text-[var(--po-text)]"
          size={13}
          strokeWidth={1.8}
        />
      ) : null}
    </button>
  );
}
