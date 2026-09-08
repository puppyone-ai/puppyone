import type { AgentViewportGeometry } from "../domain/agent-ui-state";
import type { AgentPromptReferenceMention } from "../domain/agent-contract";

export type SessionUiState = {
  draft: string;
  draftMentions: AgentPromptReferenceMention[];
  scrollTop: number;
  measurements: Record<string, number>;
  pinned: boolean;
  geometry?: AgentViewportGeometry;
};

const EMPTY_SESSION_UI: Readonly<SessionUiState> = Object.freeze({
  draft: "",
  draftMentions: [],
  scrollTop: 0,
  measurements: Object.freeze({}),
  pinned: true,
});

const DEFAULT_MAX_ENTRIES = 100;
const DEFAULT_MAX_MEASUREMENTS_PER_SESSION = 1_000;

/** Renderer-only ephemeral state keyed by application session id. */
export class SessionUiStateStore {
  private readonly entries = new Map<string, SessionUiState>();
  // Unsent input is user state, never an evictable measurement cache.
  private readonly drafts = new Map<string, Pick<SessionUiState, "draft" | "draftMentions">>();

  constructor(
    private readonly maxEntries = DEFAULT_MAX_ENTRIES,
    private readonly maxMeasurementsPerSession = DEFAULT_MAX_MEASUREMENTS_PER_SESSION,
  ) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1) throw new Error("Session UI cache size must be a positive integer.");
    if (!Number.isInteger(maxMeasurementsPerSession) || maxMeasurementsPerSession < 1) {
      throw new Error("Session UI measurement limit must be a positive integer.");
    }
  }

  read(key: string): SessionUiState {
    const stored = this.entries.get(key);
    if (stored) {
      // Map insertion order doubles as an inexpensive LRU list.
      this.entries.delete(key);
      this.entries.set(key, stored);
    }
    const value = { ...(stored ?? EMPTY_SESSION_UI), ...this.drafts.get(key) };
    return {
      ...value,
      draftMentions: value.draftMentions.map((mention) => ({ ...mention })),
      measurements: { ...value.measurements },
      ...(value.geometry ? { geometry: cloneGeometry(value.geometry) } : {}),
    };
  }

  patch(key: string, value: Partial<SessionUiState>) {
    const current = this.read(key);
    const measurements = value.measurements
      ? Object.fromEntries(Object.entries(value.measurements).slice(-this.maxMeasurementsPerSession))
      : current.measurements;
    this.entries.delete(key);
    this.entries.set(key, {
      ...current,
      ...value,
      draftMentions: value.draftMentions
        ? value.draftMentions.map((mention) => ({ ...mention }))
        : current.draftMentions,
      measurements,
      ...(value.geometry ? { geometry: cloneGeometry(value.geometry) } : {}),
    });
    const updated = this.entries.get(key)!;
    if (updated.draft || updated.draftMentions.length) this.drafts.set(key, { draft: updated.draft, draftMentions: updated.draftMentions.map((mention) => ({ ...mention })) });
    else this.drafts.delete(key);
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (typeof oldest !== "string") break;
      this.entries.delete(oldest);
    }
  }

  delete(key: string) {
    this.entries.delete(key);
    this.drafts.delete(key);
  }

  clear() {
    this.entries.clear();
    this.drafts.clear();
  }
}

export const agentSessionUiStateLimits = Object.freeze({
  maxEntries: DEFAULT_MAX_ENTRIES,
  maxMeasurementsPerSession: DEFAULT_MAX_MEASUREMENTS_PER_SESSION,
});

function cloneGeometry(value: AgentViewportGeometry): AgentViewportGeometry {
  return { layoutSignature: value.layoutSignature, anchor: value.anchor ? { ...value.anchor } : null };
}
