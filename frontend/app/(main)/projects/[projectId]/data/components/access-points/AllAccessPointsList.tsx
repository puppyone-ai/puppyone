'use client';

import type { Connector, RepoScope } from '@/lib/repoApi';
import { AccessPointRow } from './AccessPointRow';
import { COLOR_FG_DIM } from './tokens';
import type { ProviderIconLookup } from './types';

const EMPTY_CONNECTORS: readonly Connector[] = Object.freeze([]);

/**
 * AllAccessPointsList — project-wide list of access points
 * (round 9 layout, 2026-05-08).
 *
 * Each scope renders as a `(path eyebrow + single-row card)` pair.
 * No grouping by top-level segment — each scope's own canonical path
 * is its label, so a parent (`/gtm`) and a child (`/gtm/2026-4-7`)
 * render as two independent (eyebrow + card) units, not as two cards
 * collapsed under a shared `/GTM` header.
 *
 * Visual:
 *
 *   /
 *   ┌──────────────────────────────────────────────────────┐
 *   │ Root              [Read & Write]  [💻 Terminal]       │
 *   └──────────────────────────────────────────────────────┘
 *
 *   /gtm
 *   ┌──────────────────────────────────────────────────────┐
 *   │ gtm        [Read & Write]  [💻 Terminal] [↺ Sync]     │
 *   └──────────────────────────────────────────────────────┘
 *
 *   /gtm/2026-4-7
 *   ┌──────────────────────────────────────────────────────┐
 *   │ gtm/2026-4-7   [Read & Write]  [💻] [↺] [✦]          │
 *   └──────────────────────────────────────────────────────┘
 *
 *   /New Folder
 *   ┌──────────────────────────────────────────────────────┐
 *   │ New Folder         [Read & Write]  [💻] [↺]           │
 *   └──────────────────────────────────────────────────────┘
 *
 *   /New Folder/memory
 *   ┌──────────────────────────────────────────────────────┐
 *   │ memory             [Read & Write]  [💻] [↺]           │
 *   └──────────────────────────────────────────────────────┘
 *
 * Why per-scope eyebrow (not grouped):
 *
 *   - The previous round grouped scopes by their first path segment
 *     (`/gtm` and `/gtm/2026-4-7` collapsed under one `/GTM`
 *     header). That made the page feel more compressed but it
 *     duplicated the path information — the eyebrow showed the
 *     parent path and the card subtitle re-stated the full path.
 *     The user called the duplication out as clutter.
 *
 *   - Per-scope eyebrow shows each scope's full path *exactly
 *     once*, in the most prominent visual slot above its row, and
 *     the row itself is then free to read as a single sentence
 *     (`<name> <permission> <methods>`) without competing for
 *     space with a path subtitle. One info → one place.
 *
 *   - The visual rhythm is `eyebrow → card → 14px gap → eyebrow →
 *     card → ...`. Each (eyebrow + card) pair stands alone, easy
 *     to scan in any order.
 *
 * Path eyebrow styling:
 *
 *   - 11px sans, dim text — readable but not dominant.
 *   - NO uppercase. The detail view's SectionHeader uses uppercase
 *     for short fixed labels like `CONNECT` / `INTEGRATIONS`, but
 *     paths can contain mixed-case segments (`/New Folder/memory`)
 *     and uppercase would mangle them visually. We deliberately
 *     don't reuse SectionHeader here for that reason.
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
    // Outer gap (16px) lets the raised tiles breathe — cramming
    // heavy cards too close makes them read as a single banded
    // surface instead of distinct objects. Inner gap (5px) keeps
    // the eyebrow-to-tile relationship tight so it reads as a
    // labelled unit.
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {scopes.map((s) => {
        const eyebrow = s.is_root || s.path === '' ? '/' : `/${s.path}`;
        return (
          <section
            key={s.id}
            style={{ display: 'flex', flexDirection: 'column', gap: 5 }}
          >
            <PathEyebrow path={eyebrow} />
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

/**
 * PathEyebrow — the small dim path label above each row.
 *
 * Inlined here (rather than reusing the connect-methods SectionHeader)
 * because that header is uppercase by design — fine for short fixed
 * labels like `CONNECT`, broken for paths with mixed case like
 * `/New Folder/memory`. Same dim weight, just no transform.
 */
function PathEyebrow({ path }: { readonly path: string }) {
  return (
    <div
      style={{
        padding: '0 4px',
        fontSize: 11,
        fontWeight: 500,
        color: COLOR_FG_DIM,
        lineHeight: 1.4,
        // Long paths can't be allowed to push the row layout around
        // — they truncate at the eyebrow level too. The full path is
        // already accessible via the row's `title=` tooltip.
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}
      title={path}
    >
      {path}
    </div>
  );
}
