/**
 * Share targets are the "who" of the Share onboarding. The user picks a
 * destination first; every later step (scope copy, publish explanation,
 * handoff payload, connection receipt) is phrased around that destination.
 *
 * `channel` decides the handoff shape:
 * - `mcp`: the destination can add a custom remote MCP server. We hand over
 *   the hosted MCP URL plus its key.
 * - `link`: the destination can only follow a link (chat bots, people). We
 *   hand over the Cloud project link.
 */
export type ShareTargetId =
  | "viktor"
  | "claude"
  | "chatgpt"
  | "slack-bot"
  | "grok"
  | "person"
  | "mcp";

export type ShareChannel = "mcp" | "link";

export type ShareTarget = Readonly<{
  id: ShareTargetId;
  channel: ShareChannel;
  /** Brand names are proper nouns and stay untranslated. */
  brand: string | null;
  /** Number of `cloud.share.handoff.<id>.step<n>` messages to render. */
  handoffSteps: number;
  /** Where the destination documents its custom MCP / link setup, if public. */
  docsUrl: string | null;
}>;

export const SHARE_TARGETS: readonly ShareTarget[] = [
  {
    id: "viktor",
    channel: "mcp",
    brand: "Viktor",
    handoffSteps: 3,
    docsUrl: "https://viktor.com/blog/how-to-connect-tools-your-ai-employee-doesnt-support-yet",
  },
  {
    id: "claude",
    channel: "mcp",
    brand: "Claude",
    handoffSteps: 3,
    docsUrl: "https://support.claude.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp",
  },
  {
    id: "chatgpt",
    channel: "mcp",
    brand: "ChatGPT",
    handoffSteps: 3,
    docsUrl: "https://platform.openai.com/docs/mcp",
  },
  {
    id: "slack-bot",
    channel: "link",
    brand: null,
    handoffSteps: 2,
    docsUrl: null,
  },
  {
    id: "grok",
    channel: "link",
    brand: "Grok",
    handoffSteps: 2,
    docsUrl: null,
  },
  {
    id: "person",
    channel: "link",
    brand: null,
    handoffSteps: 1,
    docsUrl: null,
  },
  {
    id: "mcp",
    channel: "mcp",
    brand: null,
    handoffSteps: 2,
    docsUrl: "https://modelcontextprotocol.io/docs/concepts/transports",
  },
];

export function getShareTarget(id: ShareTargetId): ShareTarget {
  const target = SHARE_TARGETS.find((candidate) => candidate.id === id);
  if (!target) throw new Error(`Unknown share target: ${id}`);
  return target;
}

export function isShareTargetId(value: unknown): value is ShareTargetId {
  return typeof value === "string" && SHARE_TARGETS.some((target) => target.id === value);
}

/** Message ID for the destination's display name. */
export function shareTargetLabelKey(id: ShareTargetId): string {
  return `cloud.share.target.${id}.label`;
}

/** Message ID for the one-line preview of what the destination will receive. */
export function shareTargetPreviewKey(id: ShareTargetId): string {
  return `cloud.share.target.${id}.preview`;
}

export function shareTargetHandoffStepKey(id: ShareTargetId, step: number): string {
  return `cloud.share.handoff.${id}.step${step}`;
}
