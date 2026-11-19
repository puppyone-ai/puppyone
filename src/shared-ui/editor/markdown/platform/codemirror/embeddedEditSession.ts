import type { SourceRange } from "../../core/plans/markdownPlanTypes";

export type EmbeddedEditSession = {
  elementId: string;
  featureId: string;
  mappedRange: SourceRange;
  baseSource: string;
  baseRevision: string;
  draft: unknown;
  mode: "preview" | "editing" | "source";
  focusTarget?: unknown;
  lifecycle?: "mounted" | "detached" | "conflicted";
};

export type EmbeddedEditSessionAcquireInput = Omit<EmbeddedEditSession, "elementId"> & {
  elementId?: string;
};

export type EmbeddedEditSessionRecoveryKey = Pick<
  EmbeddedEditSession,
  "featureId" | "mappedRange" | "baseSource"
>;

/**
 * Per-view recoverable embed edit sessions. DOM sessions may mirror this state
 * but must not be the only owner of an uncommitted draft.
 */
export function createEmbeddedEditSessionStore() {
  const sessions = new Map<string, EmbeddedEditSession>();
  let sequence = 0;

  const findRecoverable = ({
    featureId,
    mappedRange,
    baseSource,
  }: EmbeddedEditSessionRecoveryKey): EmbeddedEditSession | undefined => {
    for (const session of sessions.values()) {
      if (
        session.featureId === featureId &&
        session.baseSource === baseSource &&
        session.mappedRange.from === mappedRange.from &&
        session.mappedRange.to === mappedRange.to
      ) {
        return session;
      }
    }
    return undefined;
  };

  return {
    get(elementId: string): EmbeddedEditSession | undefined {
      return sessions.get(elementId);
    },
    findRecoverable,
    acquire(input: EmbeddedEditSessionAcquireInput): EmbeddedEditSession {
      const existing = input.elementId
        ? sessions.get(input.elementId)
        : findRecoverable(input);
      if (existing) {
        const next: EmbeddedEditSession = {
          ...existing,
          mappedRange: { ...input.mappedRange },
          mode: input.mode,
          focusTarget: input.focusTarget ?? existing.focusTarget,
          lifecycle: "mounted",
        };
        sessions.set(next.elementId, next);
        return next;
      }

      let elementId = input.elementId;
      while (!elementId) {
        const candidate = `${input.featureId}:${++sequence}`;
        if (!sessions.has(candidate)) elementId = candidate;
      }
      const session: EmbeddedEditSession = {
        ...input,
        elementId,
        mappedRange: { ...input.mappedRange },
        lifecycle: "mounted",
      };
      sessions.set(elementId, session);
      return session;
    },
    set(session: EmbeddedEditSession) {
      sessions.set(session.elementId, {
        ...session,
        mappedRange: { ...session.mappedRange },
        lifecycle: session.lifecycle ?? "mounted",
      });
    },
    update(elementId: string, patch: Partial<EmbeddedEditSession>) {
      const current = sessions.get(elementId);
      if (!current) return null;
      const next = { ...current, ...patch };
      sessions.set(elementId, next);
      return next;
    },
    delete(elementId: string) {
      sessions.delete(elementId);
    },
    detach(elementId: string) {
      const current = sessions.get(elementId);
      if (!current) return;
      sessions.set(elementId, { ...current, lifecycle: "detached" });
    },
    markConflicted(elementId: string) {
      const current = sessions.get(elementId);
      if (!current) return;
      sessions.set(elementId, { ...current, lifecycle: "conflicted" });
    },
    complete(elementId: string) {
      sessions.delete(elementId);
    },
    cancel(elementId: string) {
      sessions.delete(elementId);
    },
    mapRanges(mapPos: (pos: number, assoc?: number) => number) {
      for (const [id, session] of sessions) {
        const mappedFrom = mapPos(session.mappedRange.from, 1);
        const mappedTo = mapPos(session.mappedRange.to, -1);
        sessions.set(id, {
          ...session,
          mappedRange: {
            from: Math.min(mappedFrom, mappedTo),
            to: Math.max(mappedFrom, mappedTo),
          },
        });
      }
    },
    mapRangesWithRelocation(
      relocation: {
        oldRange: SourceRange;
        newRange: SourceRange;
        mapContainedPosition?: (position: number, assoc?: number) => number;
      },
      mapPos: (pos: number, assoc?: number) => number,
    ) {
      const { oldRange, newRange } = relocation;
      for (const [id, session] of sessions) {
        const range = session.mappedRange;
        const fullyContained = range.from >= oldRange.from && range.to <= oldRange.to;
        const disjoint = range.to <= oldRange.from || range.from >= oldRange.to;

        if (fullyContained) {
          const mappedFrom = range.from === oldRange.from
            ? newRange.from
            : relocation.mapContainedPosition
              ? relocation.mapContainedPosition(range.from, 1)
            : newRange.from + range.from - oldRange.from;
          const mappedTo = range.to === oldRange.to
            ? newRange.to
            : relocation.mapContainedPosition
              ? relocation.mapContainedPosition(range.to, -1)
            : newRange.from + range.to - oldRange.from;
          sessions.set(id, {
            ...session,
            mappedRange: {
              from: Math.min(mappedFrom, mappedTo),
              to: Math.max(mappedFrom, mappedTo),
            },
          });
          continue;
        }

        const mappedFrom = mapPos(range.from, 1);
        const mappedTo = mapPos(range.to, -1);
        sessions.set(id, {
          ...session,
          mappedRange: {
            from: Math.min(mappedFrom, mappedTo),
            to: Math.max(mappedFrom, mappedTo),
          },
          lifecycle: disjoint ? session.lifecycle : "conflicted",
        });
      }
    },
    clear() {
      sessions.clear();
    },
    values() {
      return Array.from(sessions.values());
    },
  };
}

export type EmbeddedEditSessionStore = ReturnType<typeof createEmbeddedEditSessionStore>;
