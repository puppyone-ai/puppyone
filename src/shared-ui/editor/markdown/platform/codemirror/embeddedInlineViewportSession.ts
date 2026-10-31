import { invertedEffects } from "@codemirror/commands";
import { StateEffect, type Extension } from "@codemirror/state";
import type { SourceRange } from "../../core/plans/markdownPlanTypes";

const DEFAULT_DETACHED_TTL_MS = 120_000;
const DEFAULT_MAX_DETACHED_SESSIONS = 64;

export type EmbeddedInlineViewportPosition =
  | Readonly<{ kind: "start" }>
  | Readonly<{
      kind: "anchored";
      itemIndex: number;
      offsetWithinItemPx: number;
      fallbackLogicalOffsetPx: number;
    }>;

export type EmbeddedInlineViewportSequenceChange =
  | Readonly<{ kind: "preserve" }>
  | Readonly<{ kind: "insert"; index: number; count: number }>
  | Readonly<{ kind: "delete"; index: number; count: number }>
  | Readonly<{ kind: "move"; fromIndex: number; toIndex: number }>;

export type EmbeddedInlineViewportContinuity = Readonly<{
  featureId: string;
  oldRange: SourceRange;
  newRange: SourceRange;
  sequenceChange: EmbeddedInlineViewportSequenceChange;
}>;

export const markdownInlineViewportContinuityEffect = StateEffect.define<EmbeddedInlineViewportContinuity>();

export const markdownInlineViewportHistoryExtension: Extension = invertedEffects.of((transaction) => (
  transaction.effects
    .filter((effect) => effect.is(markdownInlineViewportContinuityEffect))
    .map((effect) => markdownInlineViewportContinuityEffect.of({
      featureId: effect.value.featureId,
      oldRange: { ...effect.value.newRange },
      newRange: { ...effect.value.oldRange },
      sequenceChange: invertEmbeddedInlineViewportSequenceChange(effect.value.sequenceChange),
    }))
));

export type EmbeddedInlineViewportSession = Readonly<{
  sessionId: string;
  featureId: string;
  mappedRange: SourceRange;
  sourceIdentity: string;
  position: EmbeddedInlineViewportPosition;
  lifecycle: "mounted" | "detached";
  mountToken: number;
}>;

type StoredInlineViewportSession = EmbeddedInlineViewportSession & {
  acceptsNextSourceIdentity: boolean;
  detachedAt: number | null;
  lastTouchedAt: number;
};

export type EmbeddedInlineViewportSessionAcquireInput = Readonly<{
  featureId: string;
  mappedRange: SourceRange;
  sourceIdentity: string;
}>;

export type EmbeddedInlineViewportStoreOptions = Readonly<{
  detachedTtlMs?: number;
  maxDetachedSessions?: number;
  now?: () => number;
}>;

export type EmbeddedInlineViewportTransactionMapping = Readonly<{
  continuities: readonly EmbeddedInlineViewportContinuity[];
  mapPos: (position: number, assoc?: number) => number;
  touchesRange: (range: SourceRange) => boolean;
}>;

export type EmbeddedInlineViewportRelocation = Readonly<{
  oldRange: SourceRange;
  newRange: SourceRange;
  mapContainedPosition?: (position: number, assoc?: number) => number;
}>;

/**
 * Per-EditorView recoverable inline viewport state.
 *
 * DOM scroll offsets are never document state. A semantic item anchor survives
 * a continuous Widget replacement, while an overlapping replacement without
 * an explicit continuity effect invalidates the old session.
 */
export function createEmbeddedInlineViewportSessionStore(
  options: EmbeddedInlineViewportStoreOptions = {},
) {
  const detachedTtlMs = options.detachedTtlMs ?? DEFAULT_DETACHED_TTL_MS;
  const maxDetachedSessions = options.maxDetachedSessions ?? DEFAULT_MAX_DETACHED_SESSIONS;
  const now = options.now ?? Date.now;
  const sessions = new Map<string, StoredInlineViewportSession>();
  let sessionSequence = 0;
  let mountSequence = 0;

  const prune = () => {
    const timestamp = now();
    for (const [sessionId, session] of sessions) {
      if (
        session.lifecycle === "detached"
        && session.detachedAt !== null
        && timestamp - session.detachedAt >= detachedTtlMs
      ) {
        sessions.delete(sessionId);
      }
    }

    const detached = Array.from(sessions.values())
      .filter((session) => session.lifecycle === "detached")
      .sort((left, right) => left.lastTouchedAt - right.lastTouchedAt);
    const overflow = detached.length - maxDetachedSessions;
    for (let index = 0; index < overflow; index += 1) {
      sessions.delete(detached[index].sessionId);
    }
  };

  const snapshot = (session: StoredInlineViewportSession): EmbeddedInlineViewportSession => ({
    sessionId: session.sessionId,
    featureId: session.featureId,
    mappedRange: { ...session.mappedRange },
    sourceIdentity: session.sourceIdentity,
    position: cloneEmbeddedInlineViewportPosition(session.position),
    lifecycle: session.lifecycle,
    mountToken: session.mountToken,
  });

  return {
    acquire(input: EmbeddedInlineViewportSessionAcquireInput): EmbeddedInlineViewportSession {
      prune();
      const timestamp = now();
      const existing = Array.from(sessions.values()).find((session) => (
        session.featureId === input.featureId
        && session.mappedRange.from === input.mappedRange.from
        && session.mappedRange.to === input.mappedRange.to
        && (
          session.sourceIdentity === input.sourceIdentity
          || session.acceptsNextSourceIdentity
        )
      ));
      const mountToken = ++mountSequence;

      if (existing) {
        const next: StoredInlineViewportSession = {
          ...existing,
          mappedRange: { ...input.mappedRange },
          sourceIdentity: input.sourceIdentity,
          lifecycle: "mounted",
          mountToken,
          acceptsNextSourceIdentity: false,
          detachedAt: null,
          lastTouchedAt: timestamp,
        };
        sessions.set(next.sessionId, next);
        return snapshot(next);
      }

      const session: StoredInlineViewportSession = {
        sessionId: `${input.featureId}:inline-viewport:${++sessionSequence}`,
        featureId: input.featureId,
        mappedRange: { ...input.mappedRange },
        sourceIdentity: input.sourceIdentity,
        position: { kind: "start" },
        lifecycle: "mounted",
        mountToken,
        acceptsNextSourceIdentity: false,
        detachedAt: null,
        lastTouchedAt: timestamp,
      };
      sessions.set(session.sessionId, session);
      return snapshot(session);
    },

    get(sessionId: string): EmbeddedInlineViewportSession | undefined {
      prune();
      const session = sessions.get(sessionId);
      return session ? snapshot(session) : undefined;
    },

    capture(
      sessionId: string,
      mountToken: number,
      position: EmbeddedInlineViewportPosition,
    ): EmbeddedInlineViewportSession | null {
      const current = sessions.get(sessionId);
      if (!current || current.mountToken !== mountToken || current.lifecycle !== "mounted") return null;
      const next: StoredInlineViewportSession = {
        ...current,
        position: cloneEmbeddedInlineViewportPosition(position),
        lastTouchedAt: now(),
      };
      sessions.set(sessionId, next);
      return snapshot(next);
    },

    detach(sessionId: string, mountToken: number) {
      const current = sessions.get(sessionId);
      // A stale Widget may be destroyed after its replacement mounted. Its
      // token must not detach the replacement's live session.
      if (!current || current.mountToken !== mountToken) return;
      const timestamp = now();
      sessions.set(sessionId, {
        ...current,
        lifecycle: "detached",
        detachedAt: timestamp,
        lastTouchedAt: timestamp,
      });
      prune();
    },

    mapTransaction(mapping: EmbeddedInlineViewportTransactionMapping) {
      prune();
      for (const [sessionId, session] of sessions) {
        const continuity = mapping.continuities.find((candidate) => (
          candidate.featureId === session.featureId
          && candidate.oldRange.from === session.mappedRange.from
          && candidate.oldRange.to === session.mappedRange.to
        ));
        if (continuity) {
          sessions.set(sessionId, {
            ...session,
            mappedRange: { ...continuity.newRange },
            position: mapEmbeddedInlineViewportPosition(
              session.position,
              continuity.sequenceChange,
            ),
            acceptsNextSourceIdentity: true,
            lastTouchedAt: now(),
          });
          continue;
        }

        if (mapping.touchesRange(session.mappedRange)) {
          sessions.delete(sessionId);
          continue;
        }

        sessions.set(sessionId, {
          ...session,
          mappedRange: mapSourceRange(session.mappedRange, mapping.mapPos),
        });
      }
    },

    mapRangesWithRelocation(
      relocation: EmbeddedInlineViewportRelocation,
      mapPos: (position: number, assoc?: number) => number,
    ) {
      prune();
      for (const [sessionId, session] of sessions) {
        const range = session.mappedRange;
        const fullyContained = range.from >= relocation.oldRange.from
          && range.to <= relocation.oldRange.to;
        const disjoint = range.to <= relocation.oldRange.from
          || range.from >= relocation.oldRange.to;

        if (fullyContained) {
          const mappedFrom = range.from === relocation.oldRange.from
            ? relocation.newRange.from
            : relocation.mapContainedPosition
              ? relocation.mapContainedPosition(range.from, 1)
              : relocation.newRange.from + range.from - relocation.oldRange.from;
          const mappedTo = range.to === relocation.oldRange.to
            ? relocation.newRange.to
            : relocation.mapContainedPosition
              ? relocation.mapContainedPosition(range.to, -1)
              : relocation.newRange.from + range.to - relocation.oldRange.from;
          sessions.set(sessionId, {
            ...session,
            mappedRange: {
              from: Math.min(mappedFrom, mappedTo),
              to: Math.max(mappedFrom, mappedTo),
            },
            lastTouchedAt: now(),
          });
          continue;
        }

        if (!disjoint) {
          sessions.delete(sessionId);
          continue;
        }

        sessions.set(sessionId, {
          ...session,
          mappedRange: mapSourceRange(range, mapPos),
        });
      }
    },

    clear() {
      sessions.clear();
    },

    values(): EmbeddedInlineViewportSession[] {
      prune();
      return Array.from(sessions.values(), snapshot);
    },
  };
}

export type EmbeddedInlineViewportSessionStore = ReturnType<
  typeof createEmbeddedInlineViewportSessionStore
>;

export function mapEmbeddedInlineViewportPosition(
  position: EmbeddedInlineViewportPosition,
  change: EmbeddedInlineViewportSequenceChange,
): EmbeddedInlineViewportPosition {
  if (position.kind === "start" || change.kind === "preserve") {
    return cloneEmbeddedInlineViewportPosition(position);
  }

  let itemIndex = position.itemIndex;
  if (change.kind === "insert") {
    if (itemIndex >= change.index) itemIndex += change.count;
  } else if (change.kind === "delete") {
    const deleteEnd = change.index + change.count;
    if (itemIndex >= deleteEnd) itemIndex -= change.count;
    else if (itemIndex >= change.index) itemIndex = change.index;
  } else if (itemIndex === change.fromIndex) {
    itemIndex = change.toIndex;
  } else if (
    change.fromIndex < change.toIndex
    && itemIndex > change.fromIndex
    && itemIndex <= change.toIndex
  ) {
    itemIndex -= 1;
  } else if (
    change.toIndex < change.fromIndex
    && itemIndex >= change.toIndex
    && itemIndex < change.fromIndex
  ) {
    itemIndex += 1;
  }

  return {
    ...position,
    itemIndex: Math.max(0, itemIndex),
  };
}

export function invertEmbeddedInlineViewportSequenceChange(
  change: EmbeddedInlineViewportSequenceChange,
): EmbeddedInlineViewportSequenceChange {
  if (change.kind === "insert") return { kind: "delete", index: change.index, count: change.count };
  if (change.kind === "delete") return { kind: "insert", index: change.index, count: change.count };
  if (change.kind === "move") {
    return { kind: "move", fromIndex: change.toIndex, toIndex: change.fromIndex };
  }
  return change;
}

function cloneEmbeddedInlineViewportPosition(
  position: EmbeddedInlineViewportPosition,
): EmbeddedInlineViewportPosition {
  return position.kind === "start" ? { kind: "start" } : { ...position };
}

function mapSourceRange(
  range: SourceRange,
  mapPos: (position: number, assoc?: number) => number,
): SourceRange {
  const mappedFrom = mapPos(range.from, 1);
  const mappedTo = mapPos(range.to, -1);
  return {
    from: Math.min(mappedFrom, mappedTo),
    to: Math.max(mappedFrom, mappedTo),
  };
}
