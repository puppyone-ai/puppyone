export type Workspace = {
  id: string;
  name: string;
  path: string;
  status: "protected" | "recording" | "paused";
  commitCount?: number;
  cloudState?: "local" | "syncing" | "synced";
};

export type Session = {
  id: string;
  agent: string;
  workspaceId: string;
  startedAt: string;
  endedAt: string;
  state: "complete" | "recording" | "undone" | "needs-review";
  summary: {
    modified: number;
    created: number;
    deleted: number;
    moved: number;
  };
  risk: "low" | "medium" | "high";
};

export type Change = {
  id: string;
  path: string;
  kind: "modified" | "created" | "deleted" | "moved";
  risk: "low" | "medium" | "high";
  detail: string;
  before?: string;
  after?: string;
};

export type FileKind =
  | "folder"
  | "markdown"
  | "json"
  | "code"
  | "image"
  | "pdf"
  | "sheet"
  | "file";

const oldVsNewWorldUrl = new URL("../../public/old-vs-new-world.png", import.meta.url).href;

export type FileNode = {
  id: string;
  name: string;
  path: string;
  type: FileKind;
  size?: string;
  modified?: string;
  status?: "clean" | "modified" | "created" | "deleted" | "moved";
  preview?: string;
  content?: string;
  assetUrl?: string;
  children?: FileNode[];
};

export type MonitorEvent = {
  id: string;
  time: string;
  source: string;
  message: string;
  severity: "info" | "warning" | "danger";
};

export const workspaces: Workspace[] = [
  {
    id: "client-files",
    name: "Client files",
    path: "~/Documents/Client-A",
    status: "protected",
    commitCount: 32,
    cloudState: "local",
  },
  {
    id: "finance",
    name: "Finance",
    path: "~/Documents/Finance",
    status: "protected",
    commitCount: 18,
    cloudState: "synced",
  },
  {
    id: "repo",
    name: "puppyone repo",
    path: "~/Desktop/project/puppyone",
    status: "protected",
    commitCount: 74,
    cloudState: "syncing",
  },
];

export const sessions: Session[] = [
  {
    id: "s-1",
    agent: "Claude Code",
    workspaceId: "client-files",
    startedAt: "18:42",
    endedAt: "18:58",
    state: "needs-review",
    summary: { modified: 12, created: 3, deleted: 1, moved: 2 },
    risk: "high",
  },
  {
    id: "s-2",
    agent: "Codex CLI",
    workspaceId: "repo",
    startedAt: "16:10",
    endedAt: "16:31",
    state: "complete",
    summary: { modified: 8, created: 2, deleted: 0, moved: 0 },
    risk: "medium",
  },
  {
    id: "s-3",
    agent: "Cowork",
    workspaceId: "finance",
    startedAt: "Yesterday",
    endedAt: "23:04",
    state: "complete",
    summary: { modified: 4, created: 1, deleted: 0, moved: 0 },
    risk: "low",
  },
];

export const changes: Change[] = [
  {
    id: "c-1",
    path: "contracts/final_contract.docx",
    kind: "deleted",
    risk: "high",
    detail: "Deleted after baseline snapshot. Backup is available.",
    before: "Signed contract package\nAmount: $48,000\nOwner: Client A\nStatus: ready for counter-signature",
    after: "File deleted by session.\nLocal snapshot preserved.\nRestore is available.",
  },
  {
    id: "c-2",
    path: "finance/2026_budget.xlsx",
    kind: "modified",
    risk: "high",
    detail: "Binary file changed. Restore requires confirmation.",
    before: "Q1 Budget  120,000\nQ2 Budget  132,000\nTravel      18,000\nConsulting  42,000",
    after: "Q1 Budget  120,000\nQ2 Budget  132,000\nTravel      41,000\nConsulting  19,000",
  },
  {
    id: "c-3",
    path: "notes/client_summary.md",
    kind: "modified",
    risk: "medium",
    detail: "Text diff available.",
    before: "# Client summary\n\n- Renewal: likely\n- Risk: procurement timing\n- Next step: send proposal",
    after: "# Client summary\n\n- Renewal: likely\n- Risk: legal redline\n- Next step: send final contract",
  },
  {
    id: "c-4",
    path: "drafts/proposal_v4.md",
    kind: "created",
    risk: "low",
    detail: "New file created by session.",
    before: "",
    after: "# Proposal v4\n\nUpdated scope, pricing, and rollout plan for Client A.",
  },
  {
    id: "c-5",
    path: "archive/old_scope.txt -> archive/scope_notes.txt",
    kind: "moved",
    risk: "low",
    detail: "Rename detected by matching content hash.",
    before: "archive/old_scope.txt",
    after: "archive/scope_notes.txt",
  },
];

export const fileTrees: Record<string, FileNode[]> = {
  "client-files": [
    {
      id: "contracts",
      name: "contracts",
      path: "contracts",
      type: "folder",
      modified: "18:57",
      children: [
        {
          id: "contracts/final_contract.docx",
          name: "final_contract.docx",
          path: "contracts/final_contract.docx",
          type: "file",
          size: "224 KB",
          modified: "18:58",
          status: "deleted",
          preview: "Signed contract package for Client A.",
          content: "Deleted by Claude Code. Snapshot copy remains available.",
        },
        {
          id: "contracts/redlines.pdf",
          name: "redlines.pdf",
          path: "contracts/redlines.pdf",
          type: "pdf",
          size: "1.8 MB",
          modified: "Yesterday",
          status: "clean",
          preview: "PDF contract redlines.",
          assetUrl: "data:application/pdf;base64,JVBERi0xLjQKJcTl8uXrp/Og0MTGCjEgMCBvYmoKPDwvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFI+PgplbmRvYmoKMiAwIG9iago8PC9UeXBlIC9QYWdlcyAvQ291bnQgMSAvS2lkcyBbMyAwIFJdPj4KZW5kb2JqCjMgMCBvYmoKPDwvVHlwZSAvUGFnZSAvUGFyZW50IDIgMCBSIC9NZWRpYUJveCBbMCAwIDYxMiA3OTJdIC9Db250ZW50cyA0IDAgUiAvUmVzb3VyY2VzIDw8L0ZvbnQgPDwvRjEgNSAwIFI+Pj4+Pgo+CmVuZG9iago0IDAgb2JqCjw8L0xlbmd0aCA3ND4+CnN0cmVhbQpCVAovRjEgMTggVGYKMTAwIDcwMCBUZAooUHVwcHlPbmUgRGVza3RvcCBQREYgUHJldmlldykgVGoKMTAwIDY3MiBUZAooVGhpcyBpcyBhIGxvY2FsIGFwcCBwcmV2aWV3IGZyYW1lLikgVGoKRVQKZW5kc3RyZWFtCmVuZG9iago1IDAgb2JqCjw8L1R5cGUgL0ZvbnQgL1N1YnR5cGUgL1R5cGUxIC9CYXNlRm9udCAvSGVsdmV0aWNhPj4KZW5kb2JqCnhyZWYKMCA2CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAxNSAwMDAwMCBuIAowMDAwMDAwMDY0IDAwMDAwIG4gCjAwMDAwMDAxMjEgMDAwMDAgbiAKMDAwMDAwMDI3MSAwMDAwMCBuIAowMDAwMDAwMzk2IDAwMDAwIG4gCnRyYWlsZXIKPDwvUm9vdCAxIDAgUiAvU2l6ZSA2Pj4Kc3RhcnR4cmVmCjQ2NgolJUVPRgo=",
        },
      ],
    },
    {
      id: "notes",
      name: "notes",
      path: "notes",
      type: "folder",
      modified: "18:54",
      children: [
        {
          id: "notes/client_summary.md",
          name: "client_summary.md",
          path: "notes/client_summary.md",
          type: "markdown",
          size: "5 KB",
          modified: "18:54",
          status: "modified",
          preview: "Renewal notes, current risk, next step.",
          content:
            "# Client summary\n\n- Renewal: likely\n- Risk: legal redline\n- Next step: send final contract\n\n## Account context\nClient A wants an implementation window before the end of quarter.",
        },
        {
          id: "notes/meeting-log.md",
          name: "meeting-log.md",
          path: "notes/meeting-log.md",
          type: "markdown",
          size: "8 KB",
          modified: "Mon",
          status: "clean",
          preview: "Running meeting notes.",
          content:
            "# Meeting log\n\n## Monday\nProcurement asked for security language.\n\n## Tuesday\nLegal approved the rollback clause.",
        },
      ],
    },
    {
      id: "drafts",
      name: "drafts",
      path: "drafts",
      type: "folder",
      modified: "18:52",
      children: [
        {
          id: "drafts/proposal_v4.md",
          name: "proposal_v4.md",
          path: "drafts/proposal_v4.md",
          type: "markdown",
          size: "12 KB",
          modified: "18:52",
          status: "created",
          preview: "Updated scope, pricing, and rollout plan.",
          content:
            "# Proposal v4\n\n## Scope\n- Import historical contracts\n- Prepare audit-ready workspace\n- Add review queue for agent edits\n\n## Rollout\nPilot with Client A operations team.",
        },
      ],
    },
    {
      id: "assets/contract-map.png",
      name: "contract-map.png",
      path: "assets/contract-map.png",
      type: "image",
      size: "640 KB",
      modified: "Fri",
      status: "clean",
      preview: "Relationship map for contract entities.",
      assetUrl: oldVsNewWorldUrl,
    },
  ],
  finance: [
    {
      id: "finance",
      name: "finance",
      path: "finance",
      type: "folder",
      modified: "23:04",
      children: [
        {
          id: "finance/2026_budget.xlsx",
          name: "2026_budget.xlsx",
          path: "finance/2026_budget.xlsx",
          type: "sheet",
          size: "96 KB",
          modified: "23:04",
          status: "modified",
          preview: "Budget workbook touched by Cowork.",
        },
        {
          id: "finance/vendor-cleanup.json",
          name: "vendor-cleanup.json",
          path: "finance/vendor-cleanup.json",
          type: "json",
          size: "22 KB",
          modified: "Yesterday",
          status: "created",
          preview: "Normalized vendor records.",
          content:
            '{\n  "vendors": 48,\n  "duplicates_removed": 7,\n  "requires_review": ["Acme CN", "Acme US"]\n}',
        },
      ],
    },
  ],
  repo: [
    {
      id: "desktop",
      name: "desktop",
      path: "desktop",
      type: "folder",
      modified: "Now",
      status: "modified",
      children: [
        {
          id: "desktop/src/App.tsx",
          name: "App.tsx",
          path: "desktop/src/App.tsx",
          type: "code",
          size: "9 KB",
          modified: "Now",
          status: "modified",
          preview: "Desktop shell and local recorder console.",
          content:
            "export function App() {\n  return <LocalWorkspaceShell />;\n}\n\n// Tauri shell, local tree, session timeline, undo preview.",
        },
        {
          id: "desktop/src/styles.css",
          name: "styles.css",
          path: "desktop/src/styles.css",
          type: "code",
          size: "14 KB",
          modified: "Now",
          status: "modified",
          preview: "Cloud-compatible design tokens.",
          content:
            ":root {\n  --po-canvas: #f1eadf;\n  --po-sidebar: #e8dfd2;\n  --po-panel: #fbf6ed;\n}\n\n.app-shell { height: 100vh; }",
        },
      ],
    },
    {
      id: "frontend",
      name: "frontend",
      path: "frontend",
      type: "folder",
      modified: "Today",
      children: [
        {
          id: "frontend/app/globals.css",
          name: "globals.css",
          path: "frontend/app/globals.css",
          type: "code",
          size: "18 KB",
          modified: "Today",
          status: "clean",
          preview: "PuppyOne Cloud theme tokens.",
          content: "--po-canvas: #f1eadf;\n--po-sidebar: #e8dfd2;\n--po-panel: #fbf6ed;",
        },
      ],
    },
    {
      id: "README.md",
      name: "README.md",
      path: "README.md",
      type: "markdown",
      size: "3 KB",
      modified: "Today",
      status: "clean",
      preview: "PuppyOne repo overview.",
      content: "# PuppyOne\n\nCloud workspace plus a local desktop recorder for agent safety.",
    },
  ],
};

export const monitorEvents: MonitorEvent[] = [
  {
    id: "m-1",
    time: "18:58",
    source: "Claude Code",
    message: "Deleted contracts/final_contract.docx",
    severity: "danger",
  },
  {
    id: "m-2",
    time: "18:54",
    source: "Claude Code",
    message: "Modified notes/client_summary.md",
    severity: "warning",
  },
  {
    id: "m-3",
    time: "18:52",
    source: "Claude Code",
    message: "Created drafts/proposal_v4.md",
    severity: "info",
  },
];

export function getWorkspaceTree(workspaceId: string): FileNode[] {
  return fileTrees[workspaceId] ?? fileTrees["client-files"];
}

export function flattenNodes(nodes: FileNode[]): FileNode[] {
  return nodes.flatMap((node) => [node, ...(node.children ? flattenNodes(node.children) : [])]);
}

export function findFileNode(nodes: FileNode[], path: string | null): FileNode | null {
  if (!path) return null;
  for (const node of nodes) {
    if (node.path === path) return node;
    if (node.children) {
      const found = findFileNode(node.children, path);
      if (found) return found;
    }
  }
  return null;
}

export function listFolderChildren(nodes: FileNode[], folderPath: string | null): FileNode[] {
  if (!folderPath) return nodes;
  const folder = findFileNode(nodes, folderPath);
  return folder?.children ?? [];
}
