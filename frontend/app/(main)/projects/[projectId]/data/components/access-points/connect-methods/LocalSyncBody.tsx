'use client';

import { buildGitSyncPrompt } from '@/lib/accessPointCliPrompt';
import { CommandBlock, LabeledCommandBlock } from './CommandBlock';
import { Disclosure } from './Disclosure';
import { NumberedStep } from './NumberedStep';
import { PromptBlock } from './PromptBlock';

export function LocalSyncBody({
  gitUrl,
  scopeName,
}: {
  readonly gitUrl: string;
  readonly scopeName: string;
}) {
  const {
    cloneLines,
    existingFolderLines,
    workflowLines,
    serverMergeLine,
    prompt,
  } = buildGitSyncPrompt({ gitUrl, scopeName, directoryName: scopeName });

  return (
    <>
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
        <NumberedStep
          number={4}
          title="Server-side merge proposal"
          hint="Only use this when normal Git push says the remote has newer work; PuppyOne still performs the merge decision server-side."
        >
          <CommandBlock lines={[serverMergeLine]} />
        </NumberedStep>
      </Disclosure>
    </>
  );
}
