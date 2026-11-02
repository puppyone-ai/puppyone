/**
 * The contract between the website and the demo.
 *
 * The website says *what happens*: a folder of files, what the visitor asks,
 * what the agent does step by step and which files it writes. The demo decides
 * *how it looks*: the real app renders the folder, and the run plays in the
 * Agent pane's chat as that agent's session (Claude Code, Codex, …).
 */
export type DemoAgent = "claude" | "codex" | "cursor" | "opencode";

export type DemoStep = {
  /** e.g. "Read" / "读取" */
  action: string;
  /** e.g. "data/deals.csv" */
  target: string;
  /** One-line outcome, e.g. "10 open deals" */
  result: string;
  /** Files the agent writes when this step finishes (new paths are created). */
  writes?: Array<{ path: string; content: string }>;
};

export type DemoScenario = {
  /** Project folder name, shown in the title bar. */
  folder: string;
  branch?: string;
  /** Relative path -> file content before the agent starts. */
  files: Record<string, string>;
  /** File open in the editor; the visitor watches it change. */
  open?: string;
  agent: DemoAgent;
  /** What the visitor asks the agent. */
  prompt: string;
  steps: DemoStep[];
  /** The agent's closing message. */
  reply: string;
};

const isText = (value: unknown, max = 4000): value is string => typeof value === "string" && value.length <= max;

const isRelativePath = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length < 400 && !value.startsWith("/") && !value.split("/").includes("..");

const isWrite = (value: unknown) => {
  const write = value as { path?: unknown; content?: unknown } | null;
  return isRelativePath(write?.path) && isText(write?.content, 200_000);
};

function isFiles(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const entries = Object.entries(value);
  return entries.length > 0 && entries.length <= 200 && entries.every(([path, content]) => isRelativePath(path) && isText(content, 200_000));
}

function isStep(value: unknown) {
  const step = value as Partial<DemoStep> | null;
  if (!isText(step?.action, 200) || !isText(step?.target, 400) || !isText(step?.result, 400)) return false;
  return step.writes === undefined || (Array.isArray(step.writes) && step.writes.every(isWrite));
}

const AGENTS: readonly DemoAgent[] = ["claude", "codex", "cursor", "opencode"];

/** Accept only well-formed scenarios from the embedding page. */
export function parseDemoScenario(value: unknown): DemoScenario | null {
  const s = value as Partial<DemoScenario> | null;
  if (!s || !isText(s.folder, 200) || !isText(s.prompt) || !isText(s.reply)) return null;
  if (!AGENTS.includes(s.agent as DemoAgent) || !isFiles(s.files)) return null;
  if (s.open !== undefined && !isRelativePath(s.open)) return null;
  if (!Array.isArray(s.steps) || s.steps.length > 20 || !s.steps.every(isStep)) return null;
  return s as DemoScenario;
}

// ---- standalone preview (no embedding page): the hiring scenario ------------

export const DEFAULT_SCENARIO: DemoScenario = {
  folder: "招聘管理",
  agent: "codex",
  open: "控制台/今日筛选.md",
  prompt: "按筛选标准，过一下这三位新的设计师候选人。",
  reply: "林晓最匹配。我没有推进任何人，这一步由你决定。",
  files: {
    "职位/筛选标准.md": "# 产品设计师 · 筛选标准\n\n1. 3 年以上 B 端产品设计经验\n2. 有完整的设计系统搭建经历\n3. 作品集里至少一个上线过的移动端项目\n4. 能独立和工程师对齐交付细节\n5. base 上海或可远程\n",
    "候选人/林晓.md": "# 林晓 · 简历\n\n- 5 年 B 端设计，主导过两套设计系统\n- 上线移动端产品 2 款\n",
    "候选人/周墨.md": "# 周墨 · 简历\n\n- 4 年 B 端设计\n- 移动端作品暂无上线\n",
    "候选人/陈一.md": "# 陈一 · 简历\n\n- 2 年 C 端视觉设计\n",
    "控制台/今日筛选.md": "# 今日筛选\n",
  },
  steps: [
    { action: "读取", target: "职位/筛选标准.md", result: "5 条硬性要求" },
    { action: "读取", target: "候选人/", result: "3 份简历" },
    {
      action: "更新",
      target: "控制台/今日筛选.md",
      result: "今日筛选",
      writes: [{
        path: "控制台/今日筛选.md",
        content: "# 产品设计师 · 3 位新候选人\n\n| 候选人 | 满足 | 建议 |\n| --- | --- | --- |\n| 林晓 | 5/5 | 安排面试 |\n| 周墨 | 4/5 | 先要作品 |\n| 陈一 | 2/5 | 由你决定 |\n",
      }],
    },
  ],
};
