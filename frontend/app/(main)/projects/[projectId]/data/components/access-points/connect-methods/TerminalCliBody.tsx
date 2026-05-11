'use client';

import { buildTerminalCliPrompt } from '@/lib/accessPointCliPrompt';
import { CommandBlock } from './CommandBlock';
import { Disclosure } from './Disclosure';
import { NumberedStep } from './NumberedStep';
import { PromptBlock } from './PromptBlock';

export function TerminalCliBody({
  apiBase,
  accessKey,
  profileName,
  scopeName,
}: {
  readonly apiBase: string;
  readonly accessKey: string;
  readonly profileName: string;
  readonly scopeName: string;
}) {
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
}
