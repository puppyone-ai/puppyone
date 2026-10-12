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

/**
 * Whether the destination is there without being asked.
 *
 * This is a fact about the destination, stated so the user can predict when
 * their folder gets read — not a ranking and not a reason to choose one. A
 * client the user configures themselves decides for itself, and the product
 * does not know.
 */
export type ShareResidency = "always-on" | "on-demand" | "client-decides";

export type ShareTarget = Readonly<{
  id: ShareTargetId;
  channel: ShareChannel;
  /** Brand names are proper nouns and stay untranslated. */
  brand: string | null;
  /** Number of `cloud.share.handoff.<id>.step<n>` messages to render. */
  handoffSteps: number;
  /** Where the destination documents its custom MCP / link setup, if public. */
  docsUrl: string | null;
  residency: ShareResidency;
}>;

export const SHARE_TARGETS: readonly ShareTarget[] = [
  {
    id: "viktor",
    channel: "mcp",
    brand: "Viktor",
    handoffSteps: 3,
    docsUrl: "https://viktor.com/blog/how-to-connect-tools-your-ai-employee-doesnt-support-yet",
    residency: "always-on",
  },
  {
    id: "claude",
    channel: "mcp",
    brand: "Claude",
    handoffSteps: 3,
    docsUrl: "https://support.claude.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp",
    residency: "on-demand",
  },
  {
    id: "chatgpt",
    channel: "mcp",
    brand: "ChatGPT",
    handoffSteps: 3,
    docsUrl: "https://platform.openai.com/docs/mcp",
    residency: "on-demand",
  },
  {
    id: "slack-bot",
    channel: "link",
    brand: null,
    handoffSteps: 2,
    docsUrl: null,
    residency: "always-on",
  },
  {
    id: "grok",
    channel: "link",
    brand: "Grok",
    handoffSteps: 2,
    docsUrl: null,
    residency: "on-demand",
  },
  {
    id: "person",
    channel: "link",
    brand: null,
    handoffSteps: 1,
    docsUrl: null,
    residency: "on-demand",
  },
  {
    id: "mcp",
    channel: "mcp",
    brand: null,
    handoffSteps: 2,
    docsUrl: "https://modelcontextprotocol.io/docs/concepts/transports",
    residency: "client-decides",
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

/** Message ID for the destination's residency, stated as a fact. */
export function shareResidencyKey(residency: ShareResidency): string {
  return `cloud.share.reach.residency.${residency}`;
}
