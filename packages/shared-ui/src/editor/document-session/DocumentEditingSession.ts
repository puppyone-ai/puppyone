import type {
  DocumentPersistenceReason,
  DocumentPersistenceResult,
} from "../../core/types";
import type {
  EditorSourceRevision,
  EditorSourceSnapshot,
  EditorSourceSnapshotPort,
} from "../sourceSnapshot";
import type { EditorSaveMode } from "../registry/viewerTypes";
import { invalidateDocumentStorageReads } from "./documentStorageReads";
import type {
  DocumentEditingSessionOptions,
  DocumentPersistedCommit,
  DocumentSessionDrainReason,
  DocumentSessionError,
  DocumentSessionState,
  DocumentEditingSessionHandle,
  ExternalBaselineResult,
} from "./types";
import {
  createImmediateAutoSaveScheduler,
  type DocumentAutoSaveScheduler,
} from "./autoSavePolicy";

type CommitCandidate = {
  sequence: number;
  storageEpoch: number;
  snapshot: EditorSourceSnapshot;
  reason: DocumentPersistenceReason;
};

type CommitWaiter = {
  sequence: number;
  resolve: () => void;
  reject: (error: unknown) => void;
};

type DrainReason = DocumentSessionDrainReason;

const SAVED_STATUS_DURATION_MS = 1200;

const REASON_PRIORITY: Record<DocumentPersistenceReason, number> = {
  edit: 0,
  manual: 2,
  "document-close": 4,
  "document-switch": 5,
  "workspace-switch": 6,
  "git-auto-commit": 7,
  destroy: 8,
  "app-close": 9,
};

/**
 * Framework-independent save lifecycle for one open document. Format editors
 * provide snapshots; storage implementations vary behind the persistence
 * port; ordering and version invariants stay host-owned.
 */
export class DocumentEditingSession implements DocumentEditingSessionHandle {
  readonly documentId: string;

  private readonly persistence: DocumentEditingSessionOptions["persistence"];
  private readonly onPersisted?: (commit: DocumentPersistedCommit) => void;
  private saveMode: EditorSaveMode;
  private source: EditorSourceSnapshotPort | null = null;
  private detachedSnapshot: EditorSourceSnapshot | null = null;
  private persistedContent: string;
  private storageVersion: string | null;
  private currentRevision: string | null = null;
  private persistedRevision: string | null = null;
  private dirty = false;
  private storageEpoch = 0;
  private state: DocumentSessionState;
  private readonly listeners = new Set<() => void>();
  private readonly autoSave: DocumentAutoSaveScheduler;
  private savedStatusTimer: ReturnType<typeof setTimeout> | null = null;
  private pending: CommitCandidate | null = null;
  private inFlight: CommitCandidate | null = null;
  private nextSequence = 0;
  private readonly waiters: CommitWaiter[] = [];
  private readonly activeDrainReasons = new Map<DrainReason, number>();
  private disposed = false;

  constructor(options: DocumentEditingSessionOptions) {
    this.documentId = options.documentId;
    this.persistence = options.persistence;
    this.onPersisted = options.onPersisted;
    this.saveMode = options.saveMode;
    this.persistedContent = options.initialContent;
    this.storageVersion = options.initialVersion ?? null;
    this.autoSave = createImmediateAutoSaveScheduler(() => {
      if (this.disposed || this.saveMode !== "auto" || !this.dirty) return;
      void this.requestAutomaticSave().catch(() => {
        // enqueue has already projected the failure into observable state.
      });
    });
    this.state = Object.freeze({
      documentId: this.documentId,
      status: "clean",
      error: null,
      currentRevision: null,
      persistedRevision: null,
      storageVersion: this.storageVersion,
    });
  }

  attachSource = (source: EditorSourceSnapshotPort): (() => void) => {
    if (this.disposed) return () => undefined;
    this.source = source;
    const hasLocalChanges = this.dirty || this.hasCurrentCommit();
    const retainedSnapshot = this.detachedSnapshot;
    if (retainedSnapshot && source.readSnapshot().content !== retainedSnapshot.content) {
      // A Pane can be recreated while its Working Copy remains open. Restore
      // the authoritative unsaved snapshot before the new editor reports its
      // initial disk-backed revision, otherwise tab activation could silently
      // replace dirty content with a stale file read.
      source.replaceContent(retainedSnapshot.content);
    } else if (!hasLocalChanges && source.readSnapshot().content !== this.persistedContent) {
      // A newly mounted Viewer is a projection, not a new data authority. Its
      // props may lag a storage event; initialize it from the Working Copy and
      // wait for an explicit storage snapshot instead of inferring an edit.
      source.replaceContent(this.persistedContent);
    } else if (!hasLocalChanges) {
      this.detachedSnapshot = null;
    }
    return () => {
      if (this.source !== source) return;
      if (this.dirty || this.hasCurrentCommit()) {
        // Capture synchronously while the editor model is still alive. The
        // retiring registry owns the asynchronous durability barrier.
        this.detachedSnapshot = source.readSnapshot();
      }
      this.source = null;
    };
  };

  reportRevision = (revision: EditorSourceRevision): void => {
    if (this.disposed) return;
    this.currentRevision = revision.revision;

    const localEdit = revision.origin === "local-edit";
    if (!localEdit) {
      const attachedSnapshot = this.source?.readSnapshot();
      const attachedSourceDiffers = Boolean(
        attachedSnapshot && attachedSnapshot.content !== this.persistedContent,
      );
      if (!this.hasCurrentCommit()) {
        if (!attachedSourceDiffers && !this.dirty) {
          this.cancelImmediateCommit();
          this.detachedSnapshot = null;
          this.dirty = false;
          this.persistedRevision = revision.revision;
          this.publish("clean", null);
        } else {
          // Model lifecycle is never evidence of a local edit. A dirty Working
          // Copy stays dirty; a clean mismatch is repaired by attachSource or
          // the next explicit storage-snapshot event, but is never written.
          this.publish(this.dirty ? "dirty" : this.state.status, this.state.error);
        }
      } else {
        // An older revision may already be crossing the storage boundary. Keep
        // the current baseline revision dirty until that write completes, then
        // persist this revision again if necessary (for example, an undo back
        // to the last saved content while a newer edit is in flight).
        this.dirty = true;
        this.publish(this.inFlight ? "saving" : "dirty", this.state.error);
      }
      return;
    }

    this.dirty = true;
    this.publish(this.inFlight ? "saving" : "dirty", null);
    if (this.saveMode === "auto") this.scheduleImmediateCommit();
  };

  requestSave = async (): Promise<void> => {
    const snapshot = this.source?.readSnapshot() ?? this.detachedSnapshot;
    if (!snapshot) return;
    await this.enqueue(snapshot, "manual");
  };

  flushCurrent = async (
    reason: DrainReason = "app-close",
  ): Promise<void> => {
    this.enterDrain(reason);
    try {
      // A revision may arrive while the first close write is in flight. Keep
      // snapshotting the attached source until the acknowledged revision is
      // the newest one, rather than treating the first completed write as the
      // drain. Immediate edit commits inherit the strongest active drain
      // reason so they cannot race around a close/navigation barrier.
      while (true) {
        const source = this.source;
        if (source) {
          await this.enqueue(source.readSnapshot(), this.strongestDrainReason() ?? reason);
        } else if (this.detachedSnapshot) {
          await this.enqueue(this.detachedSnapshot, this.strongestDrainReason() ?? reason);
        } else if (this.pending) {
          // A source can detach after submitting its final snapshot. Drain the
          // exact candidate already owned by the session.
          this.pending.reason = higherPriorityReason(
            this.pending.reason,
            this.strongestDrainReason() ?? reason,
          );
          await this.waitFor(this.pending.sequence);
        } else if (this.inFlight) {
          await this.waitFor(this.inFlight.sequence);
        } else if (this.hasUnpersistedChanges()) {
          throw new Error(
            this.state.error?.detail
            ?? `Unable to flush ${this.documentId}: its editor source is unavailable.`,
          );
        }

        if (!this.hasUnpersistedChanges()) return;
      }
    } finally {
      this.leaveDrain(reason);
    }
  };

  reconcileExternalBaseline = (
    content: string,
    version: string | null = null,
  ): ExternalBaselineResult => {
    if (content === this.persistedContent) {
      if (version !== null) {
        this.storageVersion = version;
        this.publish(this.state.status, this.state.error);
      }
      return "acknowledged";
    }

    if (this.inFlight?.storageEpoch === this.storageEpoch && this.inFlight.snapshot.content === content) {
      // Our own atomic save may be observed before its IPC reply. Preserve
      // newer typing; the receipt will advance this candidate's baseline.
      return "acknowledged";
    }
    return this.adoptStorageSnapshot(content, version);
  };

  /** Disk is authoritative. Retire every older input/save intent before
   * replacing the model, so an obsolete completion cannot restore it later. */
  private adoptStorageSnapshot(content: string, version: string | null): ExternalBaselineResult {
    const currentSnapshot = this.source?.readSnapshot() ?? this.detachedSnapshot;
    const converged = currentSnapshot?.content === content;
    this.storageEpoch += 1;
    this.cancelImmediateCommit();
    this.clearSavedStatusTimer();
    this.pending = null;
    this.persistedContent = content;
    this.storageVersion = version;
    const replacement = converged ? currentSnapshot : this.source?.replaceContent(content) ?? null;
    this.detachedSnapshot = null;
    this.currentRevision = replacement?.revision ?? null;
    this.persistedRevision = replacement?.revision ?? null;
    this.dirty = false;
    // Cancelled intents are settled, not reported as failed saves. Close still
    // waits for any already dispatched operation through hasUnpersistedChanges.
    this.resolveWaitersThrough(this.nextSequence);
    this.publish("clean", null);
    return converged ? "acknowledged" : "applied";
  }

  hasUnpersistedChanges = (): boolean => (
    this.dirty || this.pending !== null || this.inFlight !== null
  );

  getState = (): DocumentSessionState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  setSaveMode(saveMode: EditorSaveMode): void {
    if (this.saveMode === saveMode) return;
    this.saveMode = saveMode;
    if (saveMode === "auto" && this.dirty) this.scheduleImmediateCommit();
    if (saveMode === "manual") this.cancelImmediateCommit();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelImmediateCommit();
    this.autoSave.dispose();
    this.clearSavedStatusTimer();
    if (this.source && this.hasUnpersistedChanges()) {
      this.detachedSnapshot = this.source.readSnapshot();
    }
    this.source = null;
    this.listeners.clear();
  }

  private scheduleImmediateCommit(): void {
    if (this.disposed) return;
    this.autoSave.schedule();
  }

  private cancelImmediateCommit(): void {
    this.autoSave.cancel();
  }

  private async requestAutomaticSave(): Promise<void> {
    const source = this.source;
    if (!source) return;
    await this.enqueue(source.readSnapshot(), this.strongestDrainReason() ?? "edit");
  }

  private enterDrain(reason: DrainReason): void {
    this.activeDrainReasons.set(reason, (this.activeDrainReasons.get(reason) ?? 0) + 1);
  }

  private leaveDrain(reason: DrainReason): void {
    const count = this.activeDrainReasons.get(reason) ?? 0;
    if (count <= 1) this.activeDrainReasons.delete(reason);
    else this.activeDrainReasons.set(reason, count - 1);
  }

  private strongestDrainReason(): DrainReason | null {
    let strongest: DrainReason | null = null;
    for (const reason of this.activeDrainReasons.keys()) {
      if (!strongest || REASON_PRIORITY[reason] > REASON_PRIORITY[strongest]) {
        strongest = reason;
      }
    }
    return strongest;
  }

  private enqueue(snapshot: EditorSourceSnapshot, reason: DocumentPersistenceReason): Promise<void> {
    this.cancelImmediateCommit();

    if (snapshot.content === this.persistedContent && this.inFlight
      && this.inFlight.storageEpoch !== this.storageEpoch) {
      // Do not queue a compensating write while retiring an obsolete save.
      return this.waitFor(this.inFlight.sequence);
    }

    if (snapshot.content === this.persistedContent && !this.hasActiveCommit()) {
      this.currentRevision = snapshot.revision;
      this.persistedRevision = snapshot.revision;
      this.dirty = false;
      this.publish("clean", null);
      return Promise.resolve();
    }

    if (this.inFlight?.storageEpoch === this.storageEpoch && sameSnapshot(this.inFlight.snapshot, snapshot)) {
      return this.waitFor(this.inFlight!.sequence);
    }

    if (sameSnapshot(this.pending?.snapshot, snapshot)) {
      this.pending!.reason = higherPriorityReason(this.pending!.reason, reason);
      return this.waitFor(this.pending!.sequence);
    }

    const candidate: CommitCandidate = {
      sequence: ++this.nextSequence,
      storageEpoch: this.storageEpoch,
      snapshot,
      reason,
    };
    this.pending = candidate;
    this.dirty = true;
    this.publish(this.inFlight ? "saving" : "dirty", null);
    // Register before starting the async pump. A host adapter is required to
    // return a Promise, but it may still throw while constructing that Promise
    // (for example when the desktop bridge is unavailable).
    const completion = this.waitFor(candidate.sequence);
    void this.pump();
    return completion;
  }

  private waitFor(sequence: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.waiters.push({ sequence, resolve, reject });
    });
  }

  private async pump(): Promise<void> {
    if (this.inFlight || !this.pending) return;

    const candidate = this.pending;
    this.pending = null;

    // The editor may return to the content currently crossing the storage
    // boundary (type, then undo) under a newer editor revision. Once that
    // earlier write is acknowledged, advance the semantic revision without a
    // redundant filesystem replacement or empty Cloud commit.
    if (candidate.snapshot.content === this.persistedContent) {
      this.persistedRevision = candidate.snapshot.revision;
      this.dirty = this.currentRevision !== null
        && this.currentRevision !== candidate.snapshot.revision;
      this.resolveWaitersThrough(candidate.sequence);
      this.publish(this.dirty ? "dirty" : "clean", null);
      if (this.dirty && this.saveMode === "auto" && !this.disposed) {
        this.scheduleImmediateCommit();
      }
      return;
    }

    this.inFlight = candidate;
    this.publish("saving", null);

    let failure: unknown = null;
    try {
      const result = await this.persistence.persist({
        path: this.documentId,
        content: candidate.snapshot.content,
        revision: candidate.snapshot.revision,
        baseVersion: this.storageVersion,
        reason: candidate.reason,
      });
      invalidateDocumentStorageReads(this.persistence, this.documentId);
      if (candidate.storageEpoch !== this.storageEpoch) {
        // A fresher storage observation already replaced this editing epoch.
        // Its old success, rejection, or failure cannot update the new model.
        this.resolveWaitersThrough(candidate.sequence);
      } else if (result.ok) {
        this.acknowledge(candidate, result);
      } else if (result.kind === "conflict") {
        // Conditional write rejection is an observation of disk, not a UI
        // conflict. Never retry the obsolete local snapshot over these bytes.
        this.adoptStorageSnapshot(result.content, result.version);
      } else {
        failure = new Error(result.message);
      }
    } catch (error) {
      if (candidate.storageEpoch === this.storageEpoch) failure = error;
      else this.resolveWaitersThrough(candidate.sequence);
    } finally {
      this.inFlight = null;
    }

    if (failure) {
      const sessionError = createSessionError("persistence-failed", toErrorMessage(failure));
      if (this.pending) {
        this.dirty = true;
        this.publish("dirty", sessionError);
      } else {
        this.dirty = true;
        this.publish("error", sessionError);
        this.rejectWaitersThrough(candidate.sequence, failure);
      }
    }

    if (this.pending) {
      void this.pump();
      return;
    }

    if (!failure && this.currentRevision !== this.persistedRevision) {
      this.dirty = true;
      this.publish("dirty", null);
      if (this.saveMode === "auto" && !this.disposed) this.scheduleImmediateCommit();
    }
  }

  private acknowledge(
    candidate: CommitCandidate,
    result: Extract<DocumentPersistenceResult, { ok: true }>,
  ): void {
    invalidateDocumentStorageReads(this.persistence, this.documentId);
    this.persistedContent = candidate.snapshot.content;
    this.persistedRevision = candidate.snapshot.revision;
    const currentSnapshot = this.source?.readSnapshot() ?? this.detachedSnapshot;
    if (currentSnapshot?.content === candidate.snapshot.content) {
      this.currentRevision = currentSnapshot.revision;
      this.persistedRevision = currentSnapshot.revision;
    }
    if (this.detachedSnapshot?.content === candidate.snapshot.content) {
      this.detachedSnapshot = null;
    }
    this.storageVersion = result.version;
    this.dirty = this.currentRevision !== null && this.currentRevision !== this.persistedRevision;
    this.resolveWaitersThrough(candidate.sequence);

    try {
      this.onPersisted?.(Object.freeze({
        documentId: this.documentId,
        content: candidate.snapshot.content,
        revision: candidate.snapshot.revision,
        reason: candidate.reason,
        version: this.storageVersion,
      }));
    } catch (error) {
      console.error("Unable to apply persisted document acknowledgement:", error);
    }

    if (this.dirty || this.pending) {
      this.publish(this.pending ? "saving" : "dirty", null);
      return;
    }

    if (this.disposed) {
      this.publish("clean", null);
      return;
    }

    this.publish("saved", null);
    this.clearSavedStatusTimer();
    this.savedStatusTimer = setTimeout(() => {
      this.savedStatusTimer = null;
      if (!this.hasUnpersistedChanges()) this.publish("clean", null);
    }, SAVED_STATUS_DURATION_MS);
  }

  private resolveWaitersThrough(sequence: number): void {
    for (let index = this.waiters.length - 1; index >= 0; index -= 1) {
      const waiter = this.waiters[index];
      if (waiter.sequence > sequence) continue;
      this.waiters.splice(index, 1);
      waiter.resolve();
    }
  }

  private rejectWaitersThrough(sequence: number, error: unknown): void {
    for (let index = this.waiters.length - 1; index >= 0; index -= 1) {
      const waiter = this.waiters[index];
      if (waiter.sequence > sequence) continue;
      this.waiters.splice(index, 1);
      waiter.reject(error);
    }
  }

  private publish(status: DocumentSessionState["status"], error: DocumentSessionError | null): void {
    const next = Object.freeze({
      documentId: this.documentId,
      status,
      error,
      currentRevision: this.currentRevision,
      persistedRevision: this.persistedRevision,
      storageVersion: this.storageVersion,
    });
    if (sameState(this.state, next)) return;
    this.state = next;
    for (const listener of this.listeners) listener();
  }

  private hasActiveCommit(): boolean {
    return this.pending !== null || this.inFlight !== null;
  }

  private hasCurrentCommit(): boolean {
    return this.pending !== null || this.inFlight?.storageEpoch === this.storageEpoch;
  }

  private clearSavedStatusTimer(): void {
    if (this.savedStatusTimer === null) return;
    clearTimeout(this.savedStatusTimer);
    this.savedStatusTimer = null;
  }
}

function sameSnapshot(
  left: EditorSourceSnapshot | null | undefined,
  right: EditorSourceSnapshot,
): boolean {
  return Boolean(left && left.revision === right.revision && left.content === right.content);
}

function higherPriorityReason(
  left: DocumentPersistenceReason,
  right: DocumentPersistenceReason,
): DocumentPersistenceReason {
  return REASON_PRIORITY[right] > REASON_PRIORITY[left] ? right : left;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createSessionError(
  code: DocumentSessionError["code"],
  detail: string | null = null,
): DocumentSessionError {
  return Object.freeze({ code, detail });
}

function sameState(left: DocumentSessionState, right: DocumentSessionState): boolean {
  return (
    left.status === right.status
    && left.error?.code === right.error?.code
    && left.error?.detail === right.error?.detail
    && left.currentRevision === right.currentRevision
    && left.persistedRevision === right.persistedRevision
    && left.storageVersion === right.storageVersion
  );
}
