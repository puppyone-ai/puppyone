import type { SourceRange } from "../../core/plans/markdownPlanTypes";
import {
  EMBEDDED_TABLE_COLUMN_MIN_WIDTH,
  clampEmbeddedTableColumnWidth,
} from "./embeddedTableColumnGeometry";
import type {
  EmbeddedInlineViewportContinuity,
  EmbeddedInlineViewportSequenceChange,
} from "./embeddedInlineViewportSession";

const DEFAULT_MAX_DETACHED_SESSIONS = 128;
const MARKDOWN_TABLE_LAYOUT_STORAGE_KEY = "puppyone.editor.markdown-table-view-preferences.v1";
const MAX_STORED_LAYOUT_PREFERENCES = 300;

export type EmbeddedTableColumnLayoutSession = Readonly<{
  sessionId: string;
  featureId: string;
  mappedRange: SourceRange;
  sourceIdentity: string;
  widths: readonly number[];
  lifecycle: "mounted" | "detached";
  mountToken: number;
  /** The user set these tracks (resize, auto-fit, fit); they persist and never reflow. */
  explicit: boolean;
  /** Reading-column width the automatic tracks were laid out for; null when explicit. */
  autoLayoutWidth: number | null;
}>;

/** Last measured reading geometry, so a new table's first paint is already fitted. */
export type EmbeddedTableAutoLayoutMetrics = Readonly<{
  availableWidth: number;
  emPx: number;
  cellInset: number;
}>;

type StoredTableColumnLayoutSession = Omit<EmbeddedTableColumnLayoutSession, "widths" | "explicit"> & {
  acceptsNextSourceIdentity: boolean;
  lastTouchedAt: number;
  persistenceActive: boolean;
  persistenceNamespace: string | null;
  persistenceKey: string | null;
  widths: number[];
};

export type EmbeddedTableColumnLayoutAcquireInput = Readonly<{
  featureId: string;
  initialWidths: readonly number[];
  /** Reading-column width `initialWidths` were laid out for. */
  initialLayoutWidth?: number | null;
  mappedRange: SourceRange;
  persistenceNamespace?: string | null;
  sourceIdentity: string;
}>;

export type EmbeddedTableColumnLayoutPersistence = Readonly<{
  read: (key: string, columnCount: number) => readonly number[] | undefined;
  write: (key: string, widths: readonly number[], previousKey?: string | null) => void;
  remove?: (key: string) => void;
}>;

export type EmbeddedTableColumnLayoutTransactionMapping = Readonly<{
  continuities: readonly EmbeddedInlineViewportContinuity[];
  mapPos: (position: number, assoc?: number) => number;
  touchesRange: (range: SourceRange) => boolean;
}>;

export type EmbeddedTableColumnLayoutRelocation = Readonly<{
  oldRange: SourceRange;
  newRange: SourceRange;
  mapContainedPosition?: (position: number, assoc?: number) => number;
}>;

/**
 * Per-EditorView table geometry. Column widths are presentation state, not
 * Markdown source or undo history, but they still follow the table through
 * CodeMirror transactions and semantic column operations.
 */
export function createEmbeddedTableColumnLayoutSessionStore(
  options: Readonly<{
    maxDetachedSessions?: number;
    now?: () => number;
    persistence?: EmbeddedTableColumnLayoutPersistence | null;
  }> = {},
) {
  const maxDetachedSessions = options.maxDetachedSessions ?? DEFAULT_MAX_DETACHED_SESSIONS;
  const now = options.now ?? Date.now;
  const persistence = options.persistence ?? null;
  const sessions = new Map<string, StoredTableColumnLayoutSession>();
  const autoLayoutMetrics = createAutoLayoutMetricsMemory();
  let sessionSequence = 0;
  let mountSequence = 0;

  const mapPersistence = (
    session: StoredTableColumnLayoutSession,
    mappedRange: SourceRange,
    sourceIdentity: string,
  ): string | null => {
    const persistenceKey = createPersistenceKey(
      session.persistenceNamespace,
      sourceIdentity,
      mappedRange.from,
    );
    if (
      session.persistenceActive
      && persistenceKey
      && persistenceKey !== session.persistenceKey
    ) {
      persistence?.write(persistenceKey, resolveWidths(session.widths, []), session.persistenceKey);
    }
    return persistenceKey;
  };

  const prune = () => {
    const detached = Array.from(sessions.values())
      .filter((session) => session.lifecycle === "detached")
      .sort((left, right) => left.lastTouchedAt - right.lastTouchedAt);
    const overflow = detached.length - maxDetachedSessions;
    for (let index = 0; index < overflow; index += 1) {
      sessions.delete(detached[index].sessionId);
    }
  };

  const snapshot = (
    session: StoredTableColumnLayoutSession,
    fallbackWidths: readonly number[] = [],
  ): EmbeddedTableColumnLayoutSession => ({
    sessionId: session.sessionId,
    featureId: session.featureId,
    mappedRange: { ...session.mappedRange },
    sourceIdentity: session.sourceIdentity,
    widths: resolveWidths(session.widths, fallbackWidths),
    lifecycle: session.lifecycle,
    mountToken: session.mountToken,
    explicit: session.persistenceActive,
    autoLayoutWidth: session.persistenceActive ? null : session.autoLayoutWidth,
  });

  return {
    ...autoLayoutMetrics,

    acquire(input: EmbeddedTableColumnLayoutAcquireInput): EmbeddedTableColumnLayoutSession {
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
        const widths = resolveWidths(existing.widths, input.initialWidths);
        const persistenceNamespace = normalizePersistenceNamespace(input.persistenceNamespace);
        const persistenceKey = createPersistenceKey(
          persistenceNamespace,
          input.sourceIdentity,
          input.mappedRange.from,
        );
        const next: StoredTableColumnLayoutSession = {
          ...existing,
          mappedRange: { ...input.mappedRange },
          sourceIdentity: input.sourceIdentity,
          persistenceNamespace,
          persistenceKey,
          widths: [...widths],
          lifecycle: "mounted",
          mountToken,
          acceptsNextSourceIdentity: false,
          lastTouchedAt: timestamp,
        };
        sessions.set(next.sessionId, next);
        if (existing.persistenceActive && persistenceKey) {
          persistence?.write(persistenceKey, widths, existing.persistenceKey);
        }
        return snapshot(next);
      }

      const persistenceNamespace = normalizePersistenceNamespace(input.persistenceNamespace);
      const persistenceKey = createPersistenceKey(
        persistenceNamespace,
        input.sourceIdentity,
        input.mappedRange.from,
      );
      const persistedWidths = persistenceKey
        ? persistence?.read(persistenceKey, input.initialWidths.length)
        : undefined;
      const session: StoredTableColumnLayoutSession = {
        sessionId: `${input.featureId}:column-layout:${++sessionSequence}`,
        featureId: input.featureId,
        mappedRange: { ...input.mappedRange },
        sourceIdentity: input.sourceIdentity,
        widths: [...(persistedWidths ?? input.initialWidths)],
        lifecycle: "mounted",
        mountToken,
        autoLayoutWidth: input.initialLayoutWidth ?? null,
        acceptsNextSourceIdentity: false,
        persistenceActive: persistedWidths !== undefined,
        persistenceNamespace,
        persistenceKey,
        lastTouchedAt: timestamp,
      };
      sessions.set(session.sessionId, session);
      return snapshot(session);
    },

    setWidths(
      sessionId: string,
      mountToken: number,
      widths: readonly number[],
    ): EmbeddedTableColumnLayoutSession | null {
      const current = sessions.get(sessionId);
      if (!current || current.mountToken !== mountToken || current.lifecycle !== "mounted") {
        return null;
      }
      const next: StoredTableColumnLayoutSession = {
        ...current,
        persistenceActive: true,
        autoLayoutWidth: null,
        widths: widths.map(clampEmbeddedTableColumnWidth),
        lastTouchedAt: now(),
      };
      sessions.set(sessionId, next);
      if (next.persistenceKey) persistence?.write(next.persistenceKey, next.widths);
      return snapshot(next);
    },

    /** Automatic tracks reflowed for a new reading width: not persisted, not explicit. */
    setAutoWidths(
      sessionId: string,
      mountToken: number,
      widths: readonly number[],
      layoutWidth: number,
    ): EmbeddedTableColumnLayoutSession | null {
      const current = sessions.get(sessionId);
      if (
        !current
        || current.mountToken !== mountToken
        || current.lifecycle !== "mounted"
        || current.persistenceActive
      ) {
        return null;
      }
      const next: StoredTableColumnLayoutSession = {
        ...current,
        autoLayoutWidth: layoutWidth,
        widths: widths.map(clampEmbeddedTableColumnWidth),
        lastTouchedAt: now(),
      };
      sessions.set(sessionId, next);
      return snapshot(next);
    },

    /** Forget explicit tracks so the table follows the reading column again. */
    resetToAuto(
      sessionId: string,
      mountToken: number,
    ): EmbeddedTableColumnLayoutSession | null {
      const current = sessions.get(sessionId);
      if (!current || current.mountToken !== mountToken || current.lifecycle !== "mounted") {
        return null;
      }
      const next: StoredTableColumnLayoutSession = {
        ...current,
        persistenceActive: false,
        autoLayoutWidth: null,
        lastTouchedAt: now(),
      };
      sessions.set(sessionId, next);
      if (current.persistenceKey) persistence?.remove?.(current.persistenceKey);
      return snapshot(next);
    },


    detach(sessionId: string, mountToken: number) {
      const current = sessions.get(sessionId);
      if (!current || current.mountToken !== mountToken) return;
      sessions.set(sessionId, {
        ...current,
        lifecycle: "detached",
        lastTouchedAt: now(),
      });
      prune();
    },

    mapTransaction(mapping: EmbeddedTableColumnLayoutTransactionMapping) {
      prune();
      for (const [sessionId, session] of sessions) {
        const continuity = mapping.continuities.find((candidate) => (
          candidate.featureId === session.featureId
          && candidate.oldRange.from === session.mappedRange.from
          && candidate.oldRange.to === session.mappedRange.to
        ));
        if (continuity) {
          const persistenceKey = mapPersistence(
            session,
            continuity.newRange,
            session.sourceIdentity,
          );
          sessions.set(sessionId, {
            ...session,
            mappedRange: { ...continuity.newRange },
            persistenceKey,
            widths: mapColumnWidths(session.widths, continuity.sequenceChange),
            // A column added or removed changes how automatic tracks share the
            // reading column; moving one keeps every track.
            autoLayoutWidth: continuity.sequenceChange.kind === "insert"
              || continuity.sequenceChange.kind === "delete"
              ? null
              : session.autoLayoutWidth,
            acceptsNextSourceIdentity: true,
            lastTouchedAt: now(),
          });
          continue;
        }

        if (mapping.touchesRange(session.mappedRange)) {
          sessions.delete(sessionId);
          continue;
        }

        const mappedRange = mapSourceRange(session.mappedRange, mapping.mapPos);
        sessions.set(sessionId, {
          ...session,
          mappedRange,
          persistenceKey: mapPersistence(session, mappedRange, session.sourceIdentity),
        });
      }
    },

    mapRangesWithRelocation(
      relocation: EmbeddedTableColumnLayoutRelocation,
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
          const mappedRange = {
            from: Math.min(mappedFrom, mappedTo),
            to: Math.max(mappedFrom, mappedTo),
          };
          sessions.set(sessionId, {
            ...session,
            mappedRange,
            persistenceKey: mapPersistence(session, mappedRange, session.sourceIdentity),
            lastTouchedAt: now(),
          });
          continue;
        }

        if (!disjoint) {
          sessions.delete(sessionId);
          continue;
        }

        const mappedRange = mapSourceRange(range, mapPos);
        sessions.set(sessionId, {
          ...session,
          mappedRange,
          persistenceKey: mapPersistence(session, mappedRange, session.sourceIdentity),
        });
      }
    },

    clear() {
      sessions.clear();
    },

    values(): EmbeddedTableColumnLayoutSession[] {
      prune();
      return Array.from(sessions.values(), (session) => snapshot(session));
    },
  };
}

/** Last measured reading geometry, shared by every table in one EditorView. */
function createAutoLayoutMetricsMemory() {
  let metrics: EmbeddedTableAutoLayoutMetrics | null = null;
  return {
    getAutoLayoutMetrics(): EmbeddedTableAutoLayoutMetrics | null {
      return metrics;
    },
    rememberAutoLayoutMetrics(next: EmbeddedTableAutoLayoutMetrics) {
      if (
        Number.isFinite(next.availableWidth) && next.availableWidth > 0
        && Number.isFinite(next.emPx) && next.emPx > 0
      ) {
        metrics = next;
      }
    },
  };
}

export function createEmbeddedTableColumnLayoutBrowserPersistence(
  storage: Pick<Storage, "getItem" | "setItem"> | null = getBrowserStorage(),
): EmbeddedTableColumnLayoutPersistence | null {
  if (!storage) return null;
  return {
    read(key, columnCount) {
      const widths = readPreferenceStore(storage)[key]?.widths;
      if (!widths || widths.length !== columnCount) return undefined;
      return widths.map(clampEmbeddedTableColumnWidth);
    },
    write(key, widths, previousKey) {
      if (widths.length === 0 || widths.some((width) => !Number.isFinite(width) || width <= 0)) return;
      const normalizedWidths = widths.map(clampEmbeddedTableColumnWidth);
      const currentStore = readPreferenceStore(storage);
      const nextStore: TableColumnLayoutPreferenceStore = { ...currentStore };
      const removedPrevious = Boolean(previousKey && previousKey !== key && nextStore[previousKey]);
      if (previousKey && previousKey !== key) delete nextStore[previousKey];
      const current = nextStore[key];
      if (
        !removedPrevious
        && current
        && current.widths.length === normalizedWidths.length
        && current.widths.every((width, index) => width === normalizedWidths[index])
      ) {
        return;
      }
      nextStore[key] = { updatedAt: Date.now(), widths: normalizedWidths };
      const recentEntries = Object.entries(nextStore)
        .sort((left, right) => right[1].updatedAt - left[1].updatedAt)
        .slice(0, MAX_STORED_LAYOUT_PREFERENCES);
      try {
        storage.setItem(
          MARKDOWN_TABLE_LAYOUT_STORAGE_KEY,
          JSON.stringify(Object.fromEntries(recentEntries)),
        );
      } catch {
        // View preferences are best-effort and must never block editing.
      }
    },
    remove(key) {
      const currentStore = readPreferenceStore(storage);
      if (!currentStore[key]) return;
      const nextStore: TableColumnLayoutPreferenceStore = { ...currentStore };
      delete nextStore[key];
      try {
        storage.setItem(MARKDOWN_TABLE_LAYOUT_STORAGE_KEY, JSON.stringify(nextStore));
      } catch {
        // View preferences are best-effort and must never block editing.
      }
    },
  };
}

export type EmbeddedTableColumnLayoutSessionStore = ReturnType<
  typeof createEmbeddedTableColumnLayoutSessionStore
>;

function resolveWidths(
  widths: readonly number[],
  fallbackWidths: readonly number[],
): number[] {
  const columnCount = Math.max(widths.length, fallbackWidths.length);
  return Array.from({ length: columnCount }, (_, index) => (
    widths[index] ?? fallbackWidths[index] ?? fallbackWidths.at(-1) ?? 0
  ));
}

function mapColumnWidths(
  widths: readonly number[],
  change: EmbeddedInlineViewportSequenceChange,
): number[] {
  const next = [...widths];
  if (change.kind === "preserve") return next;
  if (change.kind === "insert") {
    next.splice(
      clampInteger(change.index, 0, next.length),
      0,
      ...Array(change.count).fill(EMBEDDED_TABLE_COLUMN_MIN_WIDTH),
    );
    return next;
  }
  if (change.kind === "delete") {
    next.splice(clampInteger(change.index, 0, next.length), Math.max(0, change.count));
    return next;
  }
  if (next.length === 0) return next;
  const fromIndex = clampInteger(change.fromIndex, 0, next.length - 1);
  const toIndex = clampInteger(change.toIndex, 0, next.length - 1);
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

function mapSourceRange(
  range: SourceRange,
  mapPos: (position: number, assoc?: number) => number,
): SourceRange {
  const from = mapPos(range.from, 1);
  const to = mapPos(range.to, -1);
  return { from: Math.min(from, to), to: Math.max(from, to) };
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Math.trunc(value)));
}

type TableColumnLayoutPreferenceStore = Record<string, Readonly<{
  updatedAt: number;
  widths: readonly number[];
}>>;

function readPreferenceStore(
  storage: Pick<Storage, "getItem">,
): TableColumnLayoutPreferenceStore {
  try {
    const raw = storage.getItem(MARKDOWN_TABLE_LAYOUT_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const entries: TableColumnLayoutPreferenceStore = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const candidate = value as { updatedAt?: unknown; widths?: unknown };
      if (!Array.isArray(candidate.widths) || candidate.widths.length === 0) continue;
      const widths = candidate.widths.filter(
        (width): width is number => typeof width === "number" && Number.isFinite(width) && width > 0,
      );
      if (widths.length !== candidate.widths.length) continue;
      entries[key] = {
        widths,
        updatedAt: typeof candidate.updatedAt === "number" && Number.isFinite(candidate.updatedAt)
          ? candidate.updatedAt
          : 0,
      };
    }
    return entries;
  } catch {
    return {};
  }
}

function getBrowserStorage(): Pick<Storage, "getItem" | "setItem"> | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function normalizePersistenceNamespace(namespace: string | null | undefined): string | null {
  const normalized = namespace?.trim();
  return normalized || null;
}

function createPersistenceKey(
  namespace: string | null,
  sourceIdentity: string,
  tableFrom: number,
): string | null {
  if (!namespace || !sourceIdentity || !Number.isInteger(tableFrom) || tableFrom < 0) return null;
  return JSON.stringify([namespace, sourceIdentity, tableFrom]);
}
