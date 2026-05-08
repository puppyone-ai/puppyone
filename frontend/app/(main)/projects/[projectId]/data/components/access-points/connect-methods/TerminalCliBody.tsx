'use client';

import { CommandBlock } from './CommandBlock';
import { Disclosure } from './Disclosure';
import { NumberedStep } from './NumberedStep';
import { PromptBlock } from './PromptBlock';

export function TerminalCliBody({
  apiBase,
  accessKey,
  profileName,
  scopeName,
  cloneUrl,
}: {
  readonly apiBase: string;
  readonly accessKey: string;
  readonly profileName: string;
  readonly scopeName: string;
  readonly cloneUrl: string;
}) {
  const installLine = 'npm install -g puppyone';
  const loginLine = `printf '%s' '${accessKey || '<access-key>'}' | puppyone ap login ${profileName} --api-url ${apiBase} --access-key-stdin`;
  const useLines = [
    'puppyone fs ls',
    'puppyone fs cat README.md',
    'echo "hello" | puppyone fs write notes/hello.md --type markdown',
  ];
  const prompt = [
    `Use this PuppyOne folder Access Point from terminal.`,
    ``,
    `Scope: ${scopeName}`,
    ``,
    `Recommended: direct remote filesystem commands through the PuppyOne CLI. No local clone is needed.`,
    `\`\`\`bash`,
    installLine,
    loginLine,
    ...useLines,
    `\`\`\``,
    ``,
    `Only use MUT if the user asks for a local folder copy or ongoing two-way sync.`,
    `MUT endpoint: ${cloneUrl}`,
    ``,
    `Do not create a new access point unless I ask for one.`,
  ].join('\n');

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
        <NumberedStep number={3} title="Read & write files">
          <CommandBlock lines={useLines} />
        </NumberedStep>
      </Disclosure>
    </>
  );
}
