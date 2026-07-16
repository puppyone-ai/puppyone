'use client';

import { buildTerminalCliPrompt } from '@/lib/accessPointCliPrompt';
import { CommandBlock } from './CommandBlock';
import { CliCredentialIssuePanel } from './CliCredentialIssuePanel';
import { Disclosure } from './Disclosure';
import { NumberedStep } from './NumberedStep';
import { PromptBlock } from './PromptBlock';
import type { RepositoryTarget } from '@puppyone/cloud-core';

export function TerminalCliBody({
  apiBase,
  connectorId,
  target,
  profileName,
  scopeName,
}: {
  readonly apiBase: string;
  readonly connectorId: string;
  readonly target: RepositoryTarget;
  readonly profileName: string;
  readonly scopeName: string;
}) {
  return (
    <CliCredentialIssuePanel
      connectorId={connectorId}
      target={target}
    >
      {(accessKey) => {
        const { installLine, loginLine, exploreLines, fileLines, prompt } = buildTerminalCliPrompt({
          apiBase,
          accessKey,
          profileName,
          scopeName,
        });
        return (
          <>
            <PromptBlock prompt={prompt} />
            <Disclosure summary="Show install steps">
              <NumberedStep number={1} title="Install once">
                <CommandBlock lines={[installLine]} />
              </NumberedStep>
              <NumberedStep number={2} title="Sign in to this scope">
                <CommandBlock lines={[loginLine]} />
              </NumberedStep>
              <NumberedStep number={3} title="Explore safely">
                <CommandBlock lines={exploreLines} />
              </NumberedStep>
              <NumberedStep number={4} title="Read & write files">
                <CommandBlock lines={fileLines} />
              </NumberedStep>
            </Disclosure>
          </>
        );
      }}
    </CliCredentialIssuePanel>
  );
}
