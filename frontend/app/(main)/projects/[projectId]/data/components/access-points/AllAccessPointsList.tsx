'use client';

import type { Connector, RepoScope } from '@/lib/repoApi';
import { AccessPointRow } from './AccessPointRow';
import type { ProviderIconLookup } from './types';

const EMPTY_CONNECTORS: readonly Connector[] = Object.freeze([]);

/**
 * AllAccessPointsList — project-wide list of access points.
 *
 * Each scope is rendered as one access-point element. The path is part
 * of the row, not a separate heading, so the user reads a scope as one
 * object instead of "label + card" fragments.
 */
export function AllAccessPointsList({
  scopes,
  connectorsByScope,
  providerIcons,
  currentScopePath,
  onSelectScope,
}: {
  readonly scopes: readonly RepoScope[];
  /** project-wide connectors keyed by scope_id; built once in
   *  DataLayout and passed straight through. */
  readonly connectorsByScope: ReadonlyMap<string, Connector[]>;
  readonly providerIcons: ProviderIconLookup;
  readonly currentScopePath: string;
  readonly onSelectScope: (scopeId: string) => void;
}) {
  if (scopes.length === 0) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {scopes.map((s) => (
        <AccessPointRow
          key={s.id}
          scope={s}
          connectors={connectorsByScope.get(s.id) ?? EMPTY_CONNECTORS}
          providerIcons={providerIcons}
          isCurrent={s.path === currentScopePath}
          onClick={() => onSelectScope(s.id)}
        />
      ))}
    </div>
  );
}
