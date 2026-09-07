import {
  auxiliaryWorkbenchReducer, createAuxiliaryWorkbenchState,
  type AuxiliaryWorkbenchAction, type AuxiliaryWorkbenchItem, type AuxiliaryWorkbenchState,
} from "@puppyone/shared-ui";
import type { ProjectSessionContext } from "../../../../shared/project-session-contract/types";
import type { AuxiliaryWorkbenchCreationFailure } from "./useAuxiliaryWorkbenchContributions";
import type {
  AuxiliaryWorkbenchContribution, AuxiliaryWorkbenchCreationRecipe, AuxiliaryWorkbenchHistoryTarget,
  AuxiliaryWorkbenchItemSnapshot, AuxiliaryWorkbenchPreparationContext, AuxiliaryWorkbenchProject,
} from "./types";

export const LAUNCHER_ITEM_KIND = "launcher";
const entityId = () => crypto.randomUUID();
type CreationIntent = { kind: string; group: string | null; recipe: AuxiliaryWorkbenchCreationRecipe | null; history: AuxiliaryWorkbenchHistoryTarget | null };
type WorkbenchSnapshot = Readonly<{
  topology: AuxiliaryWorkbenchState;
  snapshots: ReadonlyMap<string, AuxiliaryWorkbenchItemSnapshot>;
  preparingKinds: ReadonlySet<string>;
  creationFailure: AuxiliaryWorkbenchCreationFailure | null;
  closing: boolean;
  closeFailures: readonly string[];
}>;

/** Project-owned data and resources. React subscribers never own their lifetime. */
export class ProjectWorkbenchStore implements AuxiliaryWorkbenchProject {
  disposed = false;
  private listeners = new Set<() => void>();
  private resources = new Map<string, { dispose(): void }>();
  private contributions = new Map<string, AuxiliaryWorkbenchContribution>();
  private failedIntent: CreationIntent | null = null;
  private snapshot: WorkbenchSnapshot = {
    topology: createAuxiliaryWorkbenchState(), snapshots: new Map(), preparingKinds: new Set(), creationFailure: null, closing: false, closeFailures: [],
  };
  constructor(readonly context: ProjectSessionContext) {}
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private patch(value: Partial<WorkbenchSnapshot>) {
    if (this.disposed) return;
    this.snapshot = { ...this.snapshot, ...value };
    this.listeners.forEach((listener) => listener());
  }
  setClosing(closing: boolean, closeFailures: readonly string[] = []) {
    if (closing !== this.snapshot.closing || closeFailures.join("\0") !== this.snapshot.closeFailures.join("\0")) this.patch({ closing, closeFailures });
  }
  assertOpen() { if (this.disposed || this.snapshot.closing) throw new Error("This project is closing."); }
  getResource<T extends { dispose(): void }>(key: string, create: () => T): T {
    let resource = this.resources.get(key);
    if (!resource) { this.assertOpen(); this.resources.set(key, resource = create()); }
    return resource as T;
  }
  configure(contributions: readonly AuxiliaryWorkbenchContribution[]) {
    this.contributions = new Map(contributions.map((entry) => [entry.kind, entry]));
  }
  dispatch = (action: AuxiliaryWorkbenchAction) => {
    if (this.disposed || this.snapshot.closing) return;
    this.patch({ topology: auxiliaryWorkbenchReducer(this.snapshot.topology, action) });
  };
  updateSnapshot = (id: string, value: AuxiliaryWorkbenchItemSnapshot) => {
    const previous = this.snapshot.snapshots.get(id);
    if (previous && Object.keys(value).every((key) => previous[key as keyof typeof previous] === value[key as keyof typeof value])) return;
    const snapshots = new Map(this.snapshot.snapshots);
    snapshots.set(id, value);
    this.patch({ snapshots });
  };
  removeItem = (id: string) => {
    this.resources.get(`launcher:${id}`)?.dispose();
    this.resources.delete(`launcher:${id}`);
    const snapshots = new Map(this.snapshot.snapshots);
    snapshots.delete(id);
    this.patch({ topology: auxiliaryWorkbenchReducer(this.snapshot.topology, { type: "close", itemId: id }), snapshots });
  };
  private reserve(kind: string): AuxiliaryWorkbenchItem {
    this.assertOpen();
    return Object.freeze({ id: entityId(), kind, rootId: this.context.rootPath, contextId: this.context.projectId });
  }
  private commit(item: AuxiliaryWorkbenchItem, group: string | null) {
    this.assertOpen();
    this.dispatch({ type: "create", item, groupId: entityId(), targetGroupId: group });
    return item.id;
  }
  createLauncher(group: string | null, label: string) {
    const topology = this.snapshot.topology;
    const target = group ?? topology.activeGroupId;
    const existing = topology.groups.find((entry) => entry.id === target)?.itemIds.find((id) => topology.items.some((item) => item.id === id && item.kind === LAUNCHER_ITEM_KIND));
    if (existing) { this.dispatch({ type: "activate", itemId: existing }); return existing; }
    const item = this.reserve(LAUNCHER_ITEM_KIND);
    this.updateSnapshot(item.id, { title: label, accessibleLabel: label, detail: null, iconKey: null, status: "selecting", running: false, resourceId: null });
    return this.commit(item, group);
  }
  canCreate = (kind: string) => {
    const contribution = this.contributions.get(kind);
    return !this.disposed && !this.snapshot.closing && !!contribution && !this.snapshot.preparingKinds.has(kind)
      && this.snapshot.topology.items.filter((item) => item.kind === kind).length < (contribution.maximumItems ?? Infinity);
  };
  create = async (kind: string, group: string | null, recipe: AuxiliaryWorkbenchCreationRecipe | null = null, history: AuxiliaryWorkbenchHistoryTarget | null = null): Promise<string | null> => {
    const contribution = this.contributions.get(kind);
    if (!contribution || !this.canCreate(kind)) return null;
    if (history ? !contribution.history || recipe : recipe ? !contribution.creationRecipes?.some((entry) => entry.id === recipe.id && entry.status === "available") : contribution.creationRecipes !== undefined) return null;
    const intent = { kind, group, recipe, history };
    this.failedIntent = null;
    this.patch({ preparingKinds: new Set([...this.snapshot.preparingKinds, kind]), creationFailure: null });
    const preparation: AuxiliaryWorkbenchPreparationContext = { item: this.reserve(kind), recipe, historyTarget: history, project: this };
    let committed = false;
    try {
      await contribution.prepare?.(preparation);
      this.assertOpen();
      if (!this.contributions.has(kind)) return null;
      if (!this.snapshot.snapshots.has(preparation.item.id)) this.updateSnapshot(preparation.item.id, {
        ...contribution.initialSnapshot,
        title: history?.title ?? contribution.initialSnapshot.title,
        iconKey: history?.iconKey ?? recipe?.iconKey ?? contribution.initialSnapshot.iconKey,
        resourceId: history?.id ?? contribution.initialSnapshot.resourceId,
      });
      const id = this.commit(preparation.item, group);
      committed = true;
      return id;
    } catch (error) {
      const value = error as { message?: string; code?: string; retryable?: boolean };
      this.failedIntent = intent;
      this.patch({ creationFailure: { kind, label: contribution.label, code: value.code ?? null, detail: value.message ?? String(error), retryable: value.retryable === true } });
      return null;
    } finally {
      if (!committed) {
        const snapshots = new Map(this.snapshot.snapshots);
        snapshots.delete(preparation.item.id);
        this.patch({ snapshots });
        try { await contribution.discardPreparedItem?.(preparation); }
        catch (error) { console.error("Unable to release prepared workbench item:", error); }
      }
      this.patch({ preparingKinds: new Set([...this.snapshot.preparingKinds].filter((entry) => entry !== kind)) });
    }
  };
  retryCreation = () => {
    const intent = this.failedIntent;
    return intent && this.snapshot.creationFailure?.retryable ? this.create(intent.kind, intent.group, intent.recipe, intent.history) : Promise.resolve(null);
  };
  dismissCreationFailure = () => { this.failedIntent = null; this.patch({ creationFailure: null }); };
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const resource of this.resources.values()) {
      try { resource.dispose(); } catch (error) { console.error("Unable to release project view resources:", error); }
    }
    this.resources.clear();
    this.listeners.clear();
  }
}
