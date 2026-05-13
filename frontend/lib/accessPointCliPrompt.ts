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

export interface GitSyncPromptInput {
  readonly gitUrl: string;
  readonly scopeName: string;
  readonly directoryName?: string;
  readonly accessPointName?: string;
}

export interface GitSyncPrompt {
  readonly cloneLines: readonly string[];
  readonly existingFolderLines: readonly string[];
  readonly workflowLines: readonly string[];
  readonly serverMergeLine: string;
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

export function buildGitSyncPrompt({
  gitUrl,
  scopeName,
  directoryName,
  accessPointName,
}: GitSyncPromptInput): GitSyncPrompt {
  const remote = gitUrl || '<git-url>';
  const dir = accessPointProfileSlug(directoryName || scopeName || 'workspace');
  const quotedRemote = shellQuote(remote);
  const quotedDir = shellQuote(dir);
  const cloneLines = [
    `git clone ${quotedRemote} ${quotedDir}`,
    `cd ${quotedDir}`,
  ];
  const existingFolderLines = [
    'cd /path/to/your/existing/folder',
    'git init',
    'git branch -M main',
    `git remote add origin ${quotedRemote}`,
    'git add .',
    'git commit -m "Initial sync"',
    'git push -u origin main',
  ];
  const workflowLines = [
    'git pull --ff-only origin main',
    '# ... edit files ...',
    'git add .',
    'git commit -m "describe changes"',
    'git push origin main',
  ];
  const serverMergeLine = 'git push --force-with-lease origin main';
  const prompt = [
    'Use this PuppyOne Access Point as a Git remote.',
    '',
    accessPointName ? `Access Point: ${accessPointName}` : null,
    `Scope: ${scopeName}`,
    `Remote: ${remote}`,
    '',
    'Clone to a new local folder:',
    '```bash',
    ...cloneLines,
    '```',
    '',
    'Or publish an existing local folder:',
    '```bash',
    ...existingFolderLines,
    '```',
    '',
    'Day-to-day workflow:',
    '```bash',
    ...workflowLines,
    '```',
    '',
    'Collaboration rules:',
    '- PuppyOne is the source of truth for this scope.',
    '- Do not create local merge commits to resolve conflicts; PuppyOne handles merge decisions on the server.',
    `- If a normal push says the remote has newer work, submit your commit as a server-side merge proposal with \`${serverMergeLine}\`.`,
    '- If PuppyOne says manual review is required, stop and resolve it from PuppyOne.',
    '- This remote is scope-bound; commits that touch paths outside the scope are rejected.',
  ].filter((line): line is string => line != null).join('\n');

  return {
    cloneLines,
    existingFolderLines,
    workflowLines,
    serverMergeLine,
    prompt,
  };
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
