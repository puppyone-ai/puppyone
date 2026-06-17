'use client';

import type { Connector, RepoScope } from '@/lib/repoApi';
import { CountBadge } from '@/components/ui/CountBadge';
import { AccessPointRow } from './AccessPointRow';
import { ACCESS_PANEL_TYPOGRAPHY, COLOR_FG, COLOR_FG_DIM } from './tokens';
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
  readonly currentScopePath?: string | null;
  readonly onSelectScope: (scopeId: string) => void;
}) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 2px',
          gap: 10,
        }}
      >
        <div style={{ ...ACCESS_PANEL_TYPOGRAPHY.title, color: COLOR_FG }}>
          Active access points
        </div>
        <CountBadge
          value={scopes.length}
          size="md"
          tone="neutral"
        />
      </div>

      {scopes.length === 0 ? (
        <div
          style={{
            minHeight: 66,
            display: 'flex',
            alignItems: 'center',
            padding: '0 12px',
            borderRadius: 8,
            border: '1px solid var(--po-border-subtle)',
            background: 'color-mix(in srgb, var(--po-control) 30%, transparent)',
            color: COLOR_FG_DIM,
            ...ACCESS_PANEL_TYPOGRAPHY.body,
          }}
        >
          No active access points yet.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {scopes.map((s) => (
            <AccessPointRow
              key={s.id}
              scope={s}
              connectors={connectorsByScope.get(s.id) ?? EMPTY_CONNECTORS}
              providerIcons={providerIcons}
              isCurrent={currentScopePath !== null && currentScopePath !== undefined && s.path === currentScopePath}
              onClick={() => onSelectScope(s.id)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
