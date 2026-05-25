export type MutChangeAction = 'add' | 'update' | 'delete';
export type MutChangeOp = 'added' | 'modified' | 'deleted';

interface MutChangeOpLike {
  op?: string | null;
  action?: string | null;
}

export interface NormalizedMutCommitChange {
  path: string;
  action: MutChangeAction;
  op: MutChangeOp;
}

const ACTION_ALIASES: Record<string, MutChangeAction> = {
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

const ACTION_TO_OP: Record<MutChangeAction, MutChangeOp> = {
  add: 'added',
  update: 'modified',
  delete: 'deleted',
};

export function normalizeMutChangeAction(change: MutChangeOpLike): MutChangeAction {
  const raw = String(change.action ?? change.op ?? '').trim().toLowerCase();
  return ACTION_ALIASES[raw] ?? 'update';
}

export function normalizeMutChangeOp(change: MutChangeOpLike): MutChangeOp {
  return ACTION_TO_OP[normalizeMutChangeAction(change)];
}

export function normalizeMutCommitChange<T extends MutChangeOpLike & { path?: string | null }>(
  change: T,
): T & NormalizedMutCommitChange {
  const action = normalizeMutChangeAction(change);
  return {
    ...change,
    path: change.path ?? '',
    action,
    op: ACTION_TO_OP[action],
  };
}
