import { canonicalizeDocumentResourcePath } from "./documentIdentity";

export type DocumentOperationScope = Readonly<{ storageIdentity: string; resource: string | null }>;
type Operation = {
  key?: string;
  scopes: readonly DocumentOperationScope[];
  execute: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
};

/** Atomically reserves all source/destination scopes: no nested locks or deadlocks. */
export class ResourceOperationQueue {
  private active = new Set<Operation>();
  private queued: Operation[] = [];
  private shared = new Map<string, Promise<unknown>>();
  private uncertain = new Map<string, readonly DocumentOperationScope[]>();

  hold(scopes: readonly DocumentOperationScope[], operationKey: string): () => void {
    this.uncertain.set(operationKey, scopes.map((scope) => ({ ...scope,
      resource: scope.resource === null ? null : canonicalizeDocumentResourcePath(scope.resource) })));
    return () => { this.uncertain.delete(operationKey); };
  }

  isBlocked(storageIdentity: string, resource: string): boolean {
    const scope = { storageIdentity, resource: canonicalizeDocumentResourcePath(resource) };
    return [...this.active, ...this.queued].some((operation) => overlaps(operation.scopes, [scope]))
      || [...this.uncertain.values()].some((scopes) => overlaps(scopes, [scope]));
  }

  run<T>(scopes: readonly DocumentOperationScope[], execute: () => Promise<T>, coalesceKey?: string): Promise<T> {
    if (coalesceKey && this.shared.has(coalesceKey)) return this.shared.get(coalesceKey) as Promise<T>;
    if (this.queued.length >= 256) return Promise.reject(new Error("Too many pending document operations."));
    const canonical = scopes.map((scope) => ({ ...scope, resource: scope.resource === null ? null : canonicalizeDocumentResourcePath(scope.resource) }));
    if ([...this.uncertain].some(([key, held]) => key !== coalesceKey && overlaps(held, canonical))) {
      return Promise.reject(new Error("A previous operation on this resource must be reconciled first."));
    }
    const result = new Promise<T>((resolve, reject) => {
      this.queued.push({ key: coalesceKey, scopes: canonical, execute, resolve: (value) => resolve(value as T), reject });
    });
    if (coalesceKey) this.shared.set(coalesceKey, result);
    void result.finally(() => { if (coalesceKey) this.shared.delete(coalesceKey); }).catch(() => undefined);
    this.pump();
    return result;
  }

  private pump(): void {
    const waiting: Operation[] = [];
    for (const operation of this.queued) {
      if ([...this.uncertain].some(([key, scopes]) => key !== operation.key && overlaps(scopes, operation.scopes))) {
        operation.reject(new Error("A previous operation on this resource must be reconciled first."));
        continue;
      }
      if ([...this.active, ...waiting].some((other) => overlaps(other.scopes, operation.scopes))) {
        waiting.push(operation);
        continue;
      }
      this.active.add(operation);
      void Promise.resolve().then(operation.execute).then(operation.resolve, operation.reject).finally(() => {
        this.active.delete(operation);
        this.pump();
      });
    }
    this.queued = waiting;
  }
}

function overlaps(left: readonly DocumentOperationScope[], right: readonly DocumentOperationScope[]): boolean {
  return left.some((a) => right.some((b) => a.storageIdentity === b.storageIdentity && (
    a.resource === null || b.resource === null || a.resource === b.resource
    || a.resource.startsWith(`${b.resource}/`) || b.resource.startsWith(`${a.resource}/`)
  )));
}

export const documentOperationQueue = new ResourceOperationQueue();
