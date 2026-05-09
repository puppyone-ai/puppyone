'use client';

import type { Connector, RepoScope } from '@/lib/repoApi';
import { AccessPointRow } from './AccessPointRow';
import { COLOR_FG_DIM } from './tokens';
import type { ProviderIconLookup } from './types';

const EMPTY_CONNECTORS: readonly Connector[] = Object.freeze([]);

/**
 * AllAccessPointsList — project-wide list of access points.
 *
 * Each scope is shown as a path label followed by the access point
 * element attached to that path.
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {scopes.map((s) => {
        const path = s.is_root || s.path === '' ? '/' : `/${s.path}`;
        return (
          <section
            key={s.id}
            style={{ display: 'flex', flexDirection: 'column', gap: 4 }}
          >
            <PathLabel path={path} />
            <AccessPointRow
              scope={s}
              connectors={connectorsByScope.get(s.id) ?? EMPTY_CONNECTORS}
              providerIcons={providerIcons}
              isCurrent={s.path === currentScopePath}
              onClick={() => onSelectScope(s.id)}
            />
          </section>
        );
      })}
    </div>
  );
}

function PathLabel({ path }: { readonly path: string }) {
  return (
    <div
      title={path}
      style={{
        padding: '0 4px',
        fontSize: 13,
        fontWeight: 500,
        lineHeight: 1.35,
        color: COLOR_FG_DIM,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}
    >
      {path}
    </div>
  );
}
