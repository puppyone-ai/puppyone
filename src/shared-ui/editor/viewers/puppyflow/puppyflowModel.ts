export type PuppyFlowAgentId = "codex" | "claude-code" | "cursor-cli" | "opencode";

export type PuppyFlowAgentOption = {
  id: PuppyFlowAgentId;
  label: string;
  provider: string;
  tone: "green" | "orange" | "slate" | "blue";
};

export type PuppyFlowDocumentDefaults = Readonly<{
  title: string;
  prompts: readonly [string, string];
}>;

export type PuppyFlowStep = {
  id: string;
  agent: PuppyFlowAgentId;
  prompt: string;
  enabled: boolean;
};

export type PuppyFlowDocument = {
  kind: "puppyflow";
  version: 1;
  title: string;
  description: string;
  steps: PuppyFlowStep[];
};

export type PuppyFlowParseResult =
  | { ok: true; document: PuppyFlowDocument }
  | { ok: false; error: string; document: PuppyFlowDocument };

export const PUPPYFLOW_AGENT_OPTIONS: PuppyFlowAgentOption[] = [
  { id: "codex", label: "Codex", provider: "OpenAI", tone: "green" },
  { id: "claude-code", label: "Claude Code", provider: "Anthropic", tone: "orange" },
  { id: "cursor-cli", label: "Cursor CLI", provider: "Cursor", tone: "slate" },
  { id: "opencode", label: "OpenCode", provider: "OpenCode", tone: "blue" },
];

const agentIds = new Set(PUPPYFLOW_AGENT_OPTIONS.map((agent) => agent.id));

export function isPuppyFlowFile(name: string, type?: string | null): boolean {
  const lowerName = name.toLowerCase();
  return type === "workflow" || lowerName.endsWith(".puppyflow") || lowerName.endsWith(".puppyflow.json");
}

export function createDefaultPuppyFlowDocument(defaults: PuppyFlowDocumentDefaults): PuppyFlowDocument {
  return {
    kind: "puppyflow",
    version: 1,
    title: defaults.title,
    description: "",
    steps: [
      {
        id: createStepId(),
        agent: "codex",
        enabled: true,
        prompt: defaults.prompts[0],
      },
      {
        id: createStepId(),
        agent: "codex",
        enabled: true,
        prompt: defaults.prompts[1],
      },
    ],
  };
}

export function parsePuppyFlowDocument(
  content: string | null | undefined,
  defaults: PuppyFlowDocumentDefaults,
): PuppyFlowParseResult {
  if (!content?.trim()) {
    return {
      ok: true,
      document: createDefaultPuppyFlowDocument(defaults),
    };
  }

  try {
    const raw = JSON.parse(content) as unknown;
    return {
      ok: true,
      document: normalizePuppyFlowDocument(raw, defaults),
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      document: createDefaultPuppyFlowDocument(defaults),
    };
  }
}

export function serializePuppyFlowDocument(document: PuppyFlowDocument): string {
  return `${JSON.stringify(normalizePuppyFlowDocument(document, {
    title: document.title,
    prompts: ["", ""],
  }), null, 2)}\n`;
}

export function getPuppyFlowAgent(agentId: PuppyFlowAgentId): PuppyFlowAgentOption {
  return PUPPYFLOW_AGENT_OPTIONS.find((agent) => agent.id === agentId) ?? PUPPYFLOW_AGENT_OPTIONS[0];
}

export function createPuppyFlowStep(agent: PuppyFlowAgentId = "codex"): PuppyFlowStep {
  return {
    id: createStepId(),
    agent,
    enabled: true,
    prompt: "",
  };
}

export function extractPuppyFlowMentions(prompt: string): string[] {
  const mentions = new Set<string>();
  const pattern = /(^|[\s([{,])(@[A-Za-z0-9_.\/-]+)/g;

  while (true) {
    const match = pattern.exec(prompt);
    if (!match) break;
    mentions.add(match[2]);
  }

  return [...mentions];
}

export function compilePuppyFlowRun(document: PuppyFlowDocument): { enabledSteps: number; promptBundle: string } {
  const enabledSteps = document.steps.filter((step) => step.enabled && step.prompt.trim());
  const promptBundle = [
    `# ${document.title}`,
    document.description ? `\n${document.description}` : "",
    "",
    ...enabledSteps.map((step, index) => {
      const agent = getPuppyFlowAgent(step.agent);
      return [
        `## Step ${index + 1}: ${agent.label}`,
        step.prompt.trim(),
      ].join("\n");
    }),
  ].join("\n\n").trim();

  return {
    enabledSteps: enabledSteps.length,
    promptBundle,
  };
}

function normalizePuppyFlowDocument(
  raw: unknown,
  defaults: PuppyFlowDocumentDefaults,
): PuppyFlowDocument {
  if (!isRecord(raw)) return createDefaultPuppyFlowDocument(defaults);

  const title = normalizeText(raw.title, defaults.title);
  const description = typeof raw.description === "string" ? raw.description : "";
  const rawSteps = Array.isArray(raw.steps) ? raw.steps : Array.isArray(raw.blocks) ? raw.blocks : [];
  const steps = rawSteps
    .map(normalizePuppyFlowStep)
    .filter((step): step is PuppyFlowStep => step !== null);

  return {
    kind: "puppyflow",
    version: 1,
    title,
    description,
    steps: steps.length > 0
      ? steps
      : createDefaultPuppyFlowDocument({ ...defaults, title }).steps,
  };
}

function normalizePuppyFlowStep(raw: unknown): PuppyFlowStep | null {
  if (!isRecord(raw)) return null;

  const prompt = normalizeText(raw.prompt ?? raw.content, "");
  const agent = normalizeAgent(raw.agent);

  return {
    id: normalizeText(raw.id, createStepId()),
    agent,
    prompt,
    enabled: raw.enabled !== false,
  };
}

function normalizeAgent(value: unknown): PuppyFlowAgentId {
  if (typeof value === "string" && agentIds.has(value as PuppyFlowAgentId)) {
    return value as PuppyFlowAgentId;
  }
  return "codex";
}

function normalizeText(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function createStepId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `step_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  }
  return `step_${Math.random().toString(36).slice(2, 14)}`;
}
