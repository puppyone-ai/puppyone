'use client';

import type { RepositoryTarget } from '@puppyone/cloud-core';
import { buildGitSyncPrompt } from '@/lib/accessPointCliPrompt';
import { CommandBlock, LabeledCommandBlock } from './CommandBlock';
import { Disclosure } from './Disclosure';
import { NumberedStep } from './NumberedStep';
import { PromptBlock } from './PromptBlock';
import { GitCredentialIssuePanel } from './GitCredentialIssuePanel';

export function GitRemoteBody({
  connectorId,
  gitUrl,
  scopeMode,
  scopeName,
  target,
}: {
  readonly connectorId: string;
  readonly gitUrl: string;
  readonly scopeMode: 'r' | 'rw';
  readonly scopeName: string;
  readonly target: RepositoryTarget;
}) {
  const {
    cloneLines,
    existingFolderLines,
    workflowLines,
    prompt,
  } = buildGitSyncPrompt({ gitUrl, scopeName, directoryName: scopeName });

  return (
    <>
      <GitCredentialIssuePanel
        connectorId={connectorId}
        gitUrl={gitUrl}
        scopeMode={scopeMode}
        target={target}
      />
      <PromptBlock prompt={prompt} />
      <Disclosure summary="Show Git commands">
        <NumberedStep number={1} title="Clone to a new folder">
          <CommandBlock lines={cloneLines} />
        </NumberedStep>
        <NumberedStep
          number={2}
          title="Publish an existing folder"
          hint="Use this when the local folder already exists and should become this scope's Git worktree."
        >
          <LabeledCommandBlock label="Existing folder" lines={existingFolderLines} />
        </NumberedStep>
        <NumberedStep number={3} title="Day-to-day workflow">
          <CommandBlock lines={workflowLines} />
        </NumberedStep>
      </Disclosure>
    </>
  );
}
