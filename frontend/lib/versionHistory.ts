export type VersionChangeAction = 'add' | 'update' | 'delete';
export type VersionChangeOp = 'added' | 'modified' | 'deleted';

interface VersionChangeOpLike {
  op?: string | null;
  action?: string | null;
}

export interface NormalizedVersionCommitChange {
  path: string;
  action: VersionChangeAction;
  op: VersionChangeOp;
}

const ACTION_ALIASES: Record<string, VersionChangeAction> = {
  add: 'add',
  added: 'add',
  create: 'add',
  created: 'add',
  update: 'update',
  updated: 'update',
  modify: 'update',
  modified: 'update',
  delete: 'delete',
  deleted: 'delete',
  remove: 'delete',
  removed: 'delete',
};

const ACTION_TO_OP: Record<VersionChangeAction, VersionChangeOp> = {
  add: 'added',
  update: 'modified',
  delete: 'deleted',
};

export function normalizeVersionChangeAction(change: VersionChangeOpLike): VersionChangeAction {
  const raw = String(change.action ?? change.op ?? '').trim().toLowerCase();
  return ACTION_ALIASES[raw] ?? 'update';
}

export function normalizeVersionChangeOp(change: VersionChangeOpLike): VersionChangeOp {
  return ACTION_TO_OP[normalizeVersionChangeAction(change)];
}

export function normalizeVersionCommitChange<T extends VersionChangeOpLike & { path?: string | null }>(
  change: T,
): T & NormalizedVersionCommitChange {
  const action = normalizeVersionChangeAction(change);
  return {
    ...change,
    path: change.path ?? '',
    action,
    op: ACTION_TO_OP[action],
  };
}
