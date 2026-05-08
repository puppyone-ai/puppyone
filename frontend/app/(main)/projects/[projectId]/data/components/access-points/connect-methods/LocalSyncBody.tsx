'use client';

import { CommandBlock, LabeledCommandBlock } from './CommandBlock';
import { Disclosure } from './Disclosure';
import { NumberedStep } from './NumberedStep';
import { PromptBlock } from './PromptBlock';

export function LocalSyncBody({
  accessKey,
  cloneUrl,
  scopeName,
}: {
  readonly accessKey: string;
  readonly cloneUrl: string;
  readonly scopeName: string;
}) {
  const installLine = 'pip install mutai';
  const cloneLine = `mut clone ${cloneUrl} --credential ${accessKey || '<access-key>'}`;
  const connectLine = `mut connect ${cloneUrl} --credential ${accessKey || '<access-key>'}`;
  const workflowLines = [
    'mut pull                          # get latest from cloud',
    '# ... edit files ...',
    'mut commit -m "describe changes"  # snapshot locally',
    'mut push                          # send to cloud',
  ];
  const prompt = [
    `Sync my local folder with PuppyOne cloud using the \`mut\` CLI.`,
    ``,
    `## Install (one-time)`,
    `\`\`\`bash`,
    installLine,
    `\`\`\``,
    ``,
    `## Setup — choose one path`,
    ``,
    `**A. Clone to a new folder** (no local files yet):`,
    `\`\`\`bash`,
    cloneLine,
    `cd ${scopeName}`,
    `\`\`\``,
    ``,
    `**B. Connect an existing folder** (already have files locally):`,
    `\`\`\`bash`,
    `cd /path/to/your/existing/folder`,
    connectLine,
    `\`\`\``,
    `Three-way merges with whatever is on disk — no overwrite, no data loss.`,
    ``,
    `## Sync workflow`,
    `\`\`\`bash`,
    ...workflowLines,
    `\`\`\``,
    ``,
    `Run \`mut status\` to check for uncommitted changes.`,
    `Run \`mut log\` to view commit history.`,
  ].join('\n');

  return (
    <>
      <PromptBlock prompt={prompt} />
      <Disclosure summary="Show install & sync steps">
        <NumberedStep number={1} title="Install once">
          <CommandBlock lines={[installLine]} />
        </NumberedStep>
        <NumberedStep
          number={2}
          title="Clone or connect"
          hint="Use clone for a brand-new local folder; use connect to attach an existing folder."
        >
          <LabeledCommandBlock label="New folder" lines={[cloneLine]} />
          <LabeledCommandBlock label="Existing folder" lines={[connectLine]} />
        </NumberedStep>
        <NumberedStep number={3} title="Day-to-day workflow">
          <CommandBlock lines={workflowLines} />
        </NumberedStep>
      </Disclosure>
    </>
  );
}
