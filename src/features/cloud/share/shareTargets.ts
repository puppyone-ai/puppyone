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
  | "manus"
  | "claude"
  | "chatgpt"
  | "slack-bot"
  | "grok"
  | "person"
  | "mcp";

export type ShareChannel = "mcp" | "link";

/**
 * What kind of agent a destination is — the only difference that changes how
 * a user decides between them:
 *
 * - `cloud-native`: it has its own machine. It can read and change the
 *   project while this Mac is closed, which is why write access is a real
 *   question for it.
 * - `assistant`: a product the user talks to, which reads the project while
 *   that conversation is happening.
 * - `other`: any client the user configures themselves. Not a candidate among
 *   the named ones; it is where "none of these" leads.
 *
 * Destinations with no kind are not agents. An agent that runs on this Mac is
 * not one either: it already reads the folder, so connecting it through Cloud
 * would hand it an older copy of what it can already see.
 */
export type ShareAgentKind = "cloud-native" | "assistant" | "other";

export type ShareTarget = Readonly<{
  id: ShareTargetId;
  channel: ShareChannel;
  /** Set when the destination is an agent the connect screen can offer. */
  kind: ShareAgentKind | null;
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
    kind: "cloud-native",
    brand: "Viktor",
    handoffSteps: 3,
    docsUrl: "https://viktor.com/blog/how-to-connect-tools-your-ai-employee-doesnt-support-yet",
  },
  {
    id: "manus",
    channel: "mcp",
    kind: "cloud-native",
    brand: "Manus",
    handoffSteps: 2,
    // No public page for adding a remote MCP server is linked here until one
    // is verified; a wrong link costs more than no link.
    docsUrl: null,
  },
  {
    id: "claude",
    channel: "mcp",
    kind: "assistant",
    brand: "Claude",
    handoffSteps: 3,
    docsUrl: "https://support.claude.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp",
  },
  {
    id: "chatgpt",
    channel: "mcp",
    kind: "assistant",
    brand: "ChatGPT",
    handoffSteps: 3,
    docsUrl: "https://platform.openai.com/docs/mcp",
  },
  {
    id: "slack-bot",
    channel: "link",
    kind: null,
    brand: null,
    handoffSteps: 2,
    docsUrl: null,
  },
  {
    id: "grok",
    channel: "link",
    kind: null,
    brand: "Grok",
    handoffSteps: 2,
    docsUrl: null,
  },
  {
    id: "person",
    channel: "link",
    kind: null,
    brand: null,
    handoffSteps: 1,
    docsUrl: null,
  },
  {
    id: "mcp",
    channel: "mcp",
    kind: "other",
    brand: null,
    handoffSteps: 2,
    docsUrl: "https://modelcontextprotocol.io/docs/concepts/transports",
  },
];

/** The named agents of one kind, in the order the catalogue declares them. */
export function shareAgentsOfKind(kind: ShareAgentKind): readonly ShareTarget[] {
  return SHARE_TARGETS.filter((target) => target.kind === kind);
}

/** Message ID for the heading a kind is grouped under. */
export function shareAgentKindKey(kind: ShareAgentKind): string {
  return `cloud.share.reach.connect.kind.${kind}`;
}

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
