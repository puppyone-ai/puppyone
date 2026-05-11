export interface TerminalCliPromptInput {
  readonly apiBase: string;
  readonly accessKey: string;
  readonly profileName: string;
  readonly scopeName: string;
  readonly accessPointName?: string;
}

export interface TerminalCliPrompt {
  readonly installLine: string;
  readonly loginLine: string;
  readonly exploreLines: readonly string[];
  readonly fileLines: readonly string[];
  readonly prompt: string;
}

export function accessPointProfileSlug(name: string): string {
  return (
    name
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, '-')
      .replaceAll(/^-+|-+$/g, '') || 'folder'
  );
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function buildTerminalCliPrompt({
  apiBase,
  accessKey,
  profileName,
  scopeName,
  accessPointName,
}: TerminalCliPromptInput): TerminalCliPrompt {
  const installLine = 'npm install -g puppyone@latest';
  const loginLine = [
    `printf '%s' ${shellQuote(accessKey || '<access-key>')}`,
    '|',
    'puppyone ap login',
    shellQuote(profileName || 'folder'),
    '--api-url',
    shellQuote(apiBase || '<api-url>'),
    '--access-key-stdin',
  ].join(' ');
  const exploreLines = [
    'puppyone fs semantics',
    'puppyone fs ls -la',
    'puppyone fs tree -L 2',
    'puppyone fs find --limit 200 . -maxdepth 2 -type f',
  ];
  const fileLines = [
    'puppyone fs cat <file.md>',
    'puppyone fs head -n 40 <file.md>',
    "printf 'hello\\n' | puppyone fs write notes/hello.md --type markdown",
  ];

  const prompt = [
    'Use this PuppyOne Access Point from terminal or an AI coding agent.',
    '',
    accessPointName ? `Access Point: ${accessPointName}` : null,
    `Scope: ${scopeName}`,
    '',
    'Recommended path: direct remote filesystem commands through the PuppyOne CLI. No local clone is needed.',
    'Install or update the CLI, then authenticate this scoped Access Point:',
    '```bash',
    installLine,
    loginLine,
    '```',
    '',
    'Use Unix-like scoped filesystem commands:',
    '```bash',
    ...exploreLines,
    ...fileLines,
    '```',
    '',
    'Agent rules:',
    '- `puppyone fs` is scoped to this Access Point; do not create another Access Point unless I ask for one.',
    '- `puppyone fs cat` prints raw file content by default. Use `--json` only when structured metadata is needed.',
    '- Mutating commands (`write`, `mkdir`, `touch`, `cp`, `mv`, `rm`, `rmdir`, `upload`) are recorded in PuppyOne version history and audit logs.',
    '- Prefer explicit paths. For recursive scans use `tree -L <n>`, `find ... -maxdepth <n>`, or `--limit`.',
    '- Default stdout is Unix-like; warnings and truncation diagnostics may appear on stderr.',
  ].filter((line): line is string => line != null).join('\n');

  return {
    installLine,
    loginLine,
    exploreLines,
    fileLines,
    prompt,
  };
}
