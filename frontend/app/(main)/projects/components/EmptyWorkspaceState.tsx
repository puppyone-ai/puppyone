import React, {
  useCallback,
  useMemo,
  useRef,
  useState,
  type DragEvent,
} from 'react';
import {
  Check,
  Copy,
  FilePlus,
  LoaderCircle,
  Terminal,
  Upload,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ProjectInfo } from '@/lib/projectsApi';
import { createImportJob, type ImportJob } from '@/lib/importApi';
import { openOAuthPopup } from '@/lib/oauthApi';
import { DialogBody, DialogHeader, DialogRoot, DialogSurface } from '@/components/ui/Dialog';
import { AiHandoffButton } from '@/components/ui/AiHandoffButton';
import {
  resolveDataTransferSnapshot,
  snapshotDataTransfer,
} from '@/lib/dropFiles';
import { pickDirectoryFiles } from '@/lib/directoryPicker';
import { BUTTON_HEIGHT, BUTTON_ICON_SIZE } from '@/components/ui/buttonTokens';

interface EmptyWorkspaceStateProps {
  project: ProjectInfo | null;
  gitRemoteUrl?: string | null;
  onOpenGitSetup?: () => void;
  onImportFiles?: () => void;
  onFilesDrop?: (files: File[]) => void;
  onImportGitHub?: () => void;
  importJob?: ImportJob | null;
  onImportJobCreated?: (job: ImportJob) => void | Promise<void>;
  onOpenEmptyProject?: () => void;
}

type CopyTarget = 'first-agent' | 'git-agent-new' | 'git-agent-existing' | 'new' | 'existing' | null;

const COPY_RESET_MS = 1400;
const EMPTY_WORKSPACE_RAIL_WIDTH = 760;

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
  importJob,
  onImportJobCreated,
  onOpenEmptyProject,
}: EmptyWorkspaceStateProps) {
  const [copied, setCopied] = useState<CopyTarget>(null);
  const [showGitSetupModal, setShowGitSetupModal] = useState(false);
  const [showGithubImportModal, setShowGithubImportModal] = useState(false);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const projectName = project?.name || 'this project';
  const projectId = project?.id ?? null;
  const remote = gitRemoteUrl || '<git-remote-url>';
  const hasRemote = Boolean(gitRemoteUrl);
  const directoryName = slugForDirectory(project?.name || 'puppyone-project');

  const setup = useMemo(() => {
    const quotedDir = shellQuote(directoryName);
    const quotedRemote = shellQuote(remote);
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
      `Initialize a new local repository and push it into the Puppyone project "${projectName}".`,
      '',
      `Puppyone Git remote: ${remote}`,
      '',
      'Run these commands from the folder that should become the project:',
      '```bash',
      newRepository,
      '```',
      '',
      'After pushing, report which files were imported and whether Git returned any errors.',
    ].join('\n');

    const existingRepositoryPrompt = [
      `Push the current Git repository into the Puppyone project "${projectName}".`,
      '',
      `Puppyone Git remote: ${remote}`,
      '',
      'Run these commands from the existing repository:',
      '```bash',
      existingRepository,
      '```',
      '',
      'After pushing, report which branch was pushed and whether Git returned any errors.',
    ].join('\n');

    const firstAgentPrompt = "Research today's Hacker News front page and use `puppyone fs write` to save a short inspiration digest at `Agent Output/first-run.md`.";

    return {
      newRepository,
      existingRepository,
      newRepositoryPrompt,
      existingRepositoryPrompt,
      firstAgentPrompt,
    };
  }, [directoryName, projectName, remote]);

  const copyText = useCallback(async (target: CopyTarget, text: string) => {
    if (!target) return;
    const requiresGitRemote = target !== 'first-agent';
    if (requiresGitRemote && !hasRemote) return;
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
        {importJob ? (
          <ImportJobWorkspaceState
            job={importJob}
            onImportGitHub={projectId ? () => setShowGithubImportModal(true) : onImportGitHub}
            onOpenEmptyProject={onOpenEmptyProject}
          />
        ) : (
          <>
        <div className="mb-6 text-center">
          <h1 className="m-0 text-[22px] font-semibold leading-8 text-[var(--po-text)]">
            How do you want to start this workspace?
          </h1>
          <p className="mx-auto mt-2 max-w-[560px] text-[13px] leading-5 text-[var(--po-text-muted)]">
            Add existing context for your team and agents, or let an AI agent create the first file here.
          </p>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <AddContextCard
            isDraggingFiles={isDraggingFiles}
            onDragStateChange={setIsDraggingFiles}
            onDrop={handleDrop}
            onImportFiles={onImportFiles}
            onFilesSelected={onFilesDrop}
          />

          <StartWithAgentCard
            copied={copied === 'first-agent'}
            onCopyPrompt={() => copyText('first-agent', setup.firstAgentPrompt)}
          />
        </div>

        <OtherWaysRow
          onImportGitHub={projectId ? () => setShowGithubImportModal(true) : onImportGitHub}
          onStartWithGit={() => setShowGitSetupModal(true)}
          onOpenEmptyProject={onOpenEmptyProject}
        />
          </>
        )}

        {showGithubImportModal && projectId ? (
          <GithubImportDialog
            projectId={projectId}
            onClose={() => setShowGithubImportModal(false)}
            onImportJobCreated={onImportJobCreated}
          />
        ) : null}

        {showGitSetupModal ? (
          <GitSetupDialog
            hasRemote={hasRemote}
            copied={copied}
            onClose={() => setShowGitSetupModal(false)}
            onOpenGitSetup={onOpenGitSetup}
            newCommand={setup.newRepository}
            existingCommand={setup.existingRepository}
            onCopyNewCommand={() => copyText('new', setup.newRepository)}
            onCopyExistingCommand={() => copyText('existing', setup.existingRepository)}
            onCopyNewPrompt={() => copyText('git-agent-new', setup.newRepositoryPrompt)}
            onCopyExistingPrompt={() => copyText('git-agent-existing', setup.existingRepositoryPrompt)}
          />
        ) : null}
      </div>
    </div>
  );
}

function ImportJobWorkspaceState({
  job,
  onImportGitHub,
  onOpenEmptyProject,
}: {
  job: ImportJob;
  onImportGitHub?: () => void;
  onOpenEmptyProject?: () => void;
}) {
  const isActive = job.status === 'queued' || job.status === 'running';
  const isFailed = job.status === 'failed';
  const progress = Math.max(0, Math.min(100, job.progress || (isActive ? 8 : 100)));
  const sourceLabel = getSourceLabel(job.source_url);

  return (
    <section className="mx-auto flex w-full max-w-[560px] flex-col items-center text-center">
      <div className="mb-5 inline-flex h-11 w-11 items-center justify-center rounded-lg border border-[var(--po-border-subtle)] bg-[color-mix(in_srgb,var(--po-panel)_52%,transparent)] text-[var(--po-text)]">
        {isActive ? (
          <LoaderCircle className="h-5 w-5 animate-spin" strokeWidth={1.8} />
        ) : isFailed ? (
          <span className="text-[18px] leading-none">!</span>
        ) : (
          <Check className="h-5 w-5" strokeWidth={1.9} />
        )}
      </div>
      <h1 className="m-0 text-[22px] font-semibold leading-8 text-[var(--po-text)]">
        {isActive ? 'Importing from GitHub' : isFailed ? 'GitHub import failed' : 'GitHub import finished'}
      </h1>
      <p className="mt-2 max-w-[460px] text-[13px] leading-5 text-[var(--po-text-muted)]">
        {isActive
          ? 'This import is running in the background. You can leave this page and come back later.'
          : isFailed
            ? job.error_message || 'The repository could not be imported.'
            : 'The workspace will refresh with the imported files.'}
      </p>

      <div className="mt-6 w-full rounded-lg border border-[var(--po-border-subtle)] bg-[color-mix(in_srgb,var(--po-panel)_36%,transparent)] p-4 text-left">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-[13px] font-medium leading-5 text-[var(--po-text)]" title={job.source_url}>
              {job.name || sourceLabel}
            </div>
            <div className="mt-0.5 text-[12px] leading-5 text-[var(--po-text-muted)]">
              {job.message || phaseLabel(job.phase)}
            </div>
          </div>
          <div className="shrink-0 text-[12px] font-medium tabular-nums text-[var(--po-text-muted)]">
            {progress}%
          </div>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--po-border-subtle)]">
          <div
            className="h-full rounded-full bg-[var(--po-accent)] transition-[width] duration-200"
            style={{ width: `${Math.max(4, progress)}%` }}
          />
        </div>
      </div>

      {isFailed ? (
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <button
            type="button"
            onClick={onImportGitHub}
            disabled={!onImportGitHub}
            className="inline-flex items-center rounded-md border border-[var(--po-text)] bg-[var(--po-text)] px-3.5 text-[12px] font-medium text-[var(--po-canvas)] transition-colors hover:bg-[var(--po-text-muted)] disabled:cursor-not-allowed disabled:opacity-45"
            style={{ height: BUTTON_HEIGHT }}
          >
            Try another repository
          </button>
          <button
            type="button"
            onClick={onOpenEmptyProject}
            disabled={!onOpenEmptyProject}
            className="inline-flex items-center rounded-md border border-[var(--po-border-subtle)] bg-transparent px-3 text-[12px] font-medium text-[var(--po-text-muted)] transition-colors hover:border-[var(--po-border)] hover:bg-[var(--po-hover)] hover:text-[var(--po-text)] disabled:cursor-not-allowed disabled:opacity-45"
            style={{ height: BUTTON_HEIGHT }}
          >
            Start blank
          </button>
        </div>
      ) : null}
    </section>
  );
}

function AddContextCard({
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

  const handleFolderPick = useCallback(async () => {
    if (!canPickDirectly) return;
    const picked = await pickDirectoryFiles();
    if (picked === null) {
      folderInputRef.current?.click();
      return;
    }
    if (picked.length > 0) {
      onFilesSelected?.(picked);
    }
  }, [canPickDirectly, onFilesSelected]);

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
      className={`flex min-h-[188px] flex-col rounded-lg border border-dashed px-5 py-4 text-left transition-[background-color,border-color] duration-150 ease-out motion-reduce:transition-none ${
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
      <div className="flex h-full flex-col">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[var(--po-border-subtle)] bg-[color-mix(in_srgb,var(--po-panel)_58%,transparent)] text-[var(--po-text-muted)]">
            <Upload
              size={16}
              strokeWidth={1.75}
              className={isDraggingFiles ? 'text-[var(--po-accent)]' : 'text-current'}
            />
          </div>
          <div className="min-w-0">
            <h2 className="m-0 text-[15px] font-semibold leading-6 text-[var(--po-text)]">
              Add existing context
            </h2>
            <p className="m-0 mt-1 text-[12px] leading-5 text-[var(--po-text-muted)]">
              Drop files or folders here, or start with an upload.
            </p>
          </div>
        </div>

        <div className="mt-auto">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                void handleFolderPick();
              }}
              disabled={!canPickDirectly}
              className="inline-flex items-center gap-2 rounded-md border border-[var(--po-text)] bg-[var(--po-text)] px-3.5 text-[12px] font-medium text-[var(--po-canvas)] transition-colors hover:bg-[var(--po-text-muted)] disabled:cursor-not-allowed disabled:opacity-45"
              style={{ height: BUTTON_HEIGHT }}
            >
              <Upload size={14} strokeWidth={1.8} />
              Upload folder
            </button>
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
              className="inline-flex items-center rounded-md border border-[var(--po-border-strong)] bg-transparent px-3 text-[12px] font-medium text-[var(--po-text)] transition-[background-color,border-color] duration-150 hover:border-[var(--po-border-strong)] hover:bg-[var(--po-border-subtle)] disabled:cursor-not-allowed disabled:opacity-45"
              style={{ height: BUTTON_HEIGHT }}
            >
              Upload files
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function OtherWaysRow({
  onImportGitHub,
  onStartWithGit,
  onOpenEmptyProject,
}: {
  onImportGitHub?: () => void;
  onStartWithGit: () => void;
  onOpenEmptyProject?: () => void;
}) {
  return (
    <section className="mt-6 flex flex-wrap items-center gap-2">
      <InlineSourceButton
        icon={GitHubMark}
        label="Import from GitHub"
        onClick={onImportGitHub}
        disabled={!onImportGitHub}
      />
      <InlineSourceButton
        icon={Terminal}
        label="Start with Git"
        onClick={onStartWithGit}
      />
      <InlineSourceButton
        icon={FilePlus}
        label="Start blank"
        onClick={onOpenEmptyProject}
        disabled={!onOpenEmptyProject}
      />
    </section>
  );
}

function InlineSourceButton({
  icon: Icon,
  label,
  onClick,
  disabled = false,
}: {
  icon: LucideIcon | React.ComponentType<{ className?: string; size?: number; strokeWidth?: number }>;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || !onClick}
      className="inline-flex items-center gap-1.5 rounded-md border border-[var(--po-border-subtle)] bg-[color-mix(in_srgb,var(--po-panel)_42%,transparent)] px-3 text-[12px] font-medium text-[var(--po-text-muted)] transition-colors hover:border-[var(--po-border)] hover:bg-[var(--po-hover)] hover:text-[var(--po-text)] disabled:cursor-not-allowed disabled:opacity-45"
      style={{ height: BUTTON_HEIGHT }}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" size={14} strokeWidth={1.75} />
      <span>{label}</span>
    </button>
  );
}

function GithubImportDialog({
  projectId,
  onClose,
  onImportJobCreated,
}: {
  projectId: string;
  onClose: () => void;
  onImportJobCreated?: (job: ImportJob) => void | Promise<void>;
}) {
  const [repoUrl, setRepoUrl] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [isAuthorizing, setIsAuthorizing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authorizationNotice, setAuthorizationNotice] = useState<string | null>(null);
  const normalizedUrl = normalizeGithubRepositoryUrl(repoUrl);
  const busy = isImporting || isAuthorizing;

  const handleImport = useCallback(async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!normalizedUrl) {
      setError('Paste a valid GitHub repository URL.');
      return;
    }

    setIsImporting(true);
    setError(null);
    try {
      const job = await createImportJob({
        project_id: projectId,
        source_url: normalizedUrl,
        provider: 'github',
      });
      await onImportJobCreated?.(job);
      setIsImporting(false);
      onClose();
    } catch (err) {
      setError(getImportErrorMessage(err));
      setIsImporting(false);
    }
  }, [normalizedUrl, onClose, onImportJobCreated, projectId]);

  const handleAuthorizeGithub = useCallback(async () => {
    setIsAuthorizing(true);
    setError(null);
    setAuthorizationNotice(null);
    try {
      const completed = await openOAuthPopup('github');
      setIsAuthorizing(false);
      setAuthorizationNotice(
        completed
          ? 'GitHub window closed. Try importing the repository now.'
          : 'GitHub authorization did not finish. Try again.',
      );
    } catch (err) {
      setError(getImportErrorMessage(err));
      setIsAuthorizing(false);
    }
  }, []);

  return (
    <DialogRoot onClose={busy ? undefined : onClose} backdrop="strong" dismissOnBackdrop={!busy}>
      <DialogSurface width={560} maxHeight="min(560px, calc(100vh - 32px))" ariaLabel="Import from GitHub">
        <DialogHeader
          title="Import from GitHub"
          description="Paste a repository URL. Puppyone copies it into this workspace once."
          onClose={busy ? undefined : onClose}
          leading={<GitHubMark className="h-4 w-4 text-[var(--po-text-muted)]" />}
        />
        <DialogBody style={{ padding: '10px 20px 20px' }}>
          <form onSubmit={handleImport} className="space-y-4">
            <label className="block">
              <span className="mb-1 block text-[12px] font-medium leading-5 text-[var(--po-text)]">
                Repository URL
              </span>
              <input
                type="text"
                inputMode="url"
                value={repoUrl}
                onChange={(event) => {
                  setRepoUrl(event.target.value);
                  setError(null);
                  setAuthorizationNotice(null);
                }}
                placeholder="https://github.com/org/repo"
                autoFocus
                className="h-9 w-full rounded-md border border-[var(--po-border)] bg-[var(--po-panel)] px-3 text-[13px] text-[var(--po-text)] outline-none transition-colors placeholder:text-[var(--po-text-subtle)] focus:border-[var(--po-focus-ring)]"
              />
            </label>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="m-0 text-[12px] leading-5 text-[var(--po-text-muted)]">
                Public repositories import by URL. Private repositories require GitHub authorization.
              </p>
              <button
                type="button"
                onClick={handleAuthorizeGithub}
                disabled={busy}
                className="inline-flex items-center rounded-md border border-[var(--po-border-subtle)] bg-transparent px-2.5 text-[12px] font-medium text-[var(--po-text-muted)] transition-colors hover:border-[var(--po-border)] hover:bg-[var(--po-hover)] hover:text-[var(--po-text)] disabled:cursor-not-allowed disabled:opacity-45"
                style={{ height: BUTTON_HEIGHT }}
              >
                {isAuthorizing ? 'Authorizing...' : 'Authorize GitHub'}
              </button>
            </div>

            {isAuthorizing ? (
              <div className="flex items-start gap-2 rounded-md border border-[var(--po-border-subtle)] bg-[color-mix(in_srgb,var(--po-panel)_42%,transparent)] px-3 py-2 text-[12px] leading-5 text-[var(--po-text-muted)]">
                <LoaderCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-[var(--po-text)]" strokeWidth={1.8} />
                <div>
                  <div className="font-medium text-[var(--po-text)]">Authorizing GitHub</div>
                  <div>Finish the GitHub window. This dialog stays open until authorization returns.</div>
                </div>
              </div>
            ) : null}

            {authorizationNotice ? (
              <p className="m-0 rounded-md border border-[var(--po-border-subtle)] bg-[color-mix(in_srgb,var(--po-panel)_42%,transparent)] px-3 py-2 text-[12px] leading-5 text-[var(--po-text-muted)]">
                {authorizationNotice}
              </p>
            ) : null}

            {error ? (
              <p role="alert" className="m-0 rounded-md border border-[color-mix(in_srgb,var(--po-danger)_42%,transparent)] bg-[color-mix(in_srgb,var(--po-danger)_8%,transparent)] px-3 py-2 text-[12px] leading-5 text-[var(--po-danger)]">
                {error}
              </p>
            ) : null}

            {isImporting ? (
              <div className="flex items-start gap-2 rounded-md border border-[var(--po-border-subtle)] bg-[color-mix(in_srgb,var(--po-panel)_42%,transparent)] px-3 py-2 text-[12px] leading-5 text-[var(--po-text-muted)]">
                <LoaderCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-[var(--po-text)]" strokeWidth={1.8} />
                <div>
                  <div className="font-medium text-[var(--po-text)]">Creating import job</div>
                  <div>Puppyone will keep importing in the background after this dialog closes.</div>
                </div>
              </div>
            ) : null}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="inline-flex items-center rounded-md border border-[var(--po-border-subtle)] bg-transparent px-3 text-[12px] font-medium text-[var(--po-text-muted)] transition-colors hover:border-[var(--po-border)] hover:bg-[var(--po-hover)] hover:text-[var(--po-text)] disabled:cursor-not-allowed disabled:opacity-45"
                style={{ height: BUTTON_HEIGHT }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!normalizedUrl || busy}
                className="inline-flex items-center gap-2 rounded-md border border-[var(--po-text)] bg-[var(--po-text)] px-3.5 text-[12px] font-medium text-[var(--po-canvas)] transition-colors hover:bg-[var(--po-text-muted)] disabled:cursor-not-allowed disabled:opacity-45"
                style={{ height: BUTTON_HEIGHT }}
              >
                {isImporting ? (
                  <>
                    <LoaderCircle className="h-3.5 w-3.5 animate-spin" strokeWidth={1.8} />
                    Importing
                  </>
                ) : 'Import repository'}
              </button>
            </div>
          </form>
        </DialogBody>
      </DialogSurface>
    </DialogRoot>
  );
}

function normalizeGithubRepositoryUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const sshMatch = trimmed.match(/^git@github\.com:([^/\s]+)\/(.+?)(?:\.git)?$/i);
  if (sshMatch) {
    const owner = sshMatch[1]?.trim();
    const repo = sshMatch[2]?.replace(/\.git$/i, '').trim();
    if (owner && repo) {
      return `https://github.com/${owner}/${repo}`;
    }
  }

  const candidate = /^(?:https?:\/\/)/i.test(trimmed)
    ? trimmed
    : /^(?:www\.)?github\.com\//i.test(trimmed)
      ? `https://${trimmed}`
      : trimmed;

  try {
    const parsed = new URL(candidate);
    const host = parsed.hostname.toLowerCase();
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    if (host !== 'github.com' && host !== 'www.github.com') return null;
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function getSourceLabel(sourceUrl: string): string {
  try {
    const url = new URL(sourceUrl);
    return `${url.hostname}${url.pathname}`.replace(/\/$/, '');
  } catch {
    return sourceUrl;
  }
}

function phaseLabel(phase: string): string {
  switch (phase) {
    case 'queued':
      return 'Queued';
    case 'validating':
      return 'Preparing import';
    case 'fetching':
      return 'Fetching repository';
    case 'writing':
      return 'Writing files';
    case 'completed':
      return 'Completed';
    case 'failed':
      return 'Failed';
    default:
      return phase;
  }
}

function getImportErrorMessage(error: unknown): string {
  const fallback = 'Import failed. Check the repository URL and try again.';
  const raw = error instanceof Error ? error.message : fallback;
  const detailText = raw.startsWith('Import failed:')
    ? raw.slice('Import failed:'.length).trim()
    : raw;

  try {
    const parsed = JSON.parse(detailText) as { detail?: unknown };
    if (typeof parsed.detail === 'string' && parsed.detail.trim()) {
      return parsed.detail;
    }
  } catch {
    // Keep the server message below.
  }

  return detailText || fallback;
}

function GitSetupDialog({
  hasRemote,
  copied,
  onClose,
  onOpenGitSetup,
  newCommand,
  existingCommand,
  onCopyNewCommand,
  onCopyExistingCommand,
  onCopyNewPrompt,
  onCopyExistingPrompt,
}: {
  hasRemote: boolean;
  copied: CopyTarget;
  onClose: () => void;
  onOpenGitSetup?: () => void;
  newCommand: string;
  existingCommand: string;
  onCopyNewCommand: () => void;
  onCopyExistingCommand: () => void;
  onCopyNewPrompt: () => void;
  onCopyExistingPrompt: () => void;
}) {
  return (
    <DialogRoot onClose={onClose} backdrop="strong">
      <DialogSurface width={720} maxHeight="min(760px, calc(100vh - 32px))" ariaLabel="Start with Git">
        <DialogHeader
          title="Start with Git"
          description="Use this workspace as a Git remote."
          onClose={onClose}
          leading={<Terminal size={17} strokeWidth={1.75} />}
        />
        <DialogBody style={{ padding: '10px 20px 20px' }}>
          {!hasRemote && onOpenGitSetup ? (
            <button
              type="button"
              onClick={onOpenGitSetup}
              className="mb-3 inline-flex items-center rounded-md border border-[var(--po-border)] bg-[color-mix(in_srgb,var(--po-panel)_58%,transparent)] px-3 text-[12px] font-medium text-[var(--po-text)] transition-colors hover:border-[var(--po-border-strong)] hover:bg-[color-mix(in_srgb,var(--po-panel)_72%,transparent)]"
              style={{ height: BUTTON_HEIGHT }}
            >
              Create Git remote
            </button>
          ) : null}

          <div className="space-y-4">
            <GitCommandSection
              title="Create a new repository on the command line"
              description="Initialize a folder, commit files, and push it into this workspace."
              command={newCommand}
              disabled={!hasRemote}
              copiedCommand={copied === 'new'}
              copiedPrompt={copied === 'git-agent-new'}
              onCopyCommand={onCopyNewCommand}
              onCopyPrompt={onCopyNewPrompt}
            />
            <GitCommandSection
              title="Push an existing repository from the command line"
              description="Add Puppyone as a remote and push your current branch."
              command={existingCommand}
              disabled={!hasRemote}
              copiedCommand={copied === 'existing'}
              copiedPrompt={copied === 'git-agent-existing'}
              onCopyCommand={onCopyExistingCommand}
              onCopyPrompt={onCopyExistingPrompt}
            />
          </div>
        </DialogBody>
      </DialogSurface>
    </DialogRoot>
  );
}

function GitCommandSection({
  title,
  description,
  command,
  disabled,
  copiedCommand,
  copiedPrompt,
  onCopyCommand,
  onCopyPrompt,
}: {
  title: string;
  description: string;
  command: string;
  disabled: boolean;
  copiedCommand: boolean;
  copiedPrompt: boolean;
  onCopyCommand: () => void;
  onCopyPrompt: () => void;
}) {
  return (
    <section className="rounded-lg border border-[var(--po-border-subtle)] bg-[color-mix(in_srgb,var(--po-panel)_36%,transparent)] p-3">
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="m-0 text-[13px] font-semibold leading-5 text-[var(--po-text)]">
            {title}
          </h3>
          <p className="m-0 mt-0.5 text-[12px] leading-5 text-[var(--po-text-muted)]">
            {description}
          </p>
        </div>
        <AiHandoffButton
          disabled={disabled}
          onClick={onCopyPrompt}
          copied={copiedPrompt}
          copiedLabel="Prompt copied"
          style={{ flexShrink: 0 }}
        />
      </div>

      <div className="relative">
        <button
          type="button"
          disabled={disabled}
          onClick={onCopyCommand}
          aria-label={copiedCommand ? 'Copied command lines' : 'Copy command lines'}
          title={copiedCommand ? 'Copied' : 'Copy'}
          className="absolute right-2 top-2 z-10 inline-flex shrink-0 items-center justify-center rounded-md border border-[var(--po-border-subtle)] bg-[color-mix(in_srgb,var(--po-panel)_72%,transparent)] text-[var(--po-text-muted)] transition-colors hover:border-[var(--po-border)] hover:bg-[var(--po-hover)] hover:text-[var(--po-text)] disabled:cursor-not-allowed disabled:opacity-45"
          style={{ width: BUTTON_ICON_SIZE, height: BUTTON_ICON_SIZE }}
        >
          {copiedCommand ? <Check size={13} strokeWidth={1.9} /> : <Copy size={13} strokeWidth={1.75} />}
        </button>
        <pre className="m-0 max-h-[142px] overflow-auto rounded-md border border-[var(--po-border-subtle)] bg-[color-mix(in_srgb,var(--po-canvas)_58%,transparent)] p-3 pr-12 text-[11px] leading-[18px] text-[var(--po-text-muted)]">
          <code>{command}</code>
        </pre>
      </div>
    </section>
  );
}

function StartWithAgentCard({
  copied,
  onCopyPrompt,
}: {
  copied: boolean;
  onCopyPrompt: () => void;
}) {
  return (
    <section className="flex min-h-[188px] flex-col rounded-lg border border-[var(--po-border-strong)] bg-[color-mix(in_srgb,var(--po-panel)_48%,transparent)] px-5 py-4 text-left">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[var(--po-border-subtle)] bg-[color-mix(in_srgb,var(--po-canvas)_70%,transparent)] text-[var(--po-text-muted)]">
          <Copy size={16} strokeWidth={1.75} />
        </div>
        <div className="min-w-0">
          <h2 className="m-0 text-[15px] font-semibold leading-6 text-[var(--po-text)]">
            Start with Claude Code / Cursor
          </h2>
          <p className="m-0 mt-1 text-[12px] leading-5 text-[var(--po-text-muted)]">
            Copy one sentence into Claude Code, Codex, Cursor, or another agent. It writes back with <span className="font-medium text-[var(--po-text)]">puppyone fs</span>.
          </p>
        </div>
      </div>

      <div className="mt-auto">
        <AiHandoffButton
          onClick={onCopyPrompt}
          copied={copied}
        />
      </div>
    </section>
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
