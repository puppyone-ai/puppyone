'use client';

/**
 * CreateAccessPointPanel — Pp.2b in the 3-page Access hierarchy.
 *
 *   Pp.1 Overview         (list of all scopes + entry to Pp.2b)
 *   Pp.2a Scope Detail    (per-scope settings + connect methods)
 *   Pp.2b Create New      ← THIS FILE
 *
 * Trigger map (per 2026-05-08 UX spec):
 *
 *   - Top-right "Add access" header button     → Pp.1 Overview
 *   - Sidebar chain icon on EXISTING scope     → Pp.2a Scope Detail
 *   - Sidebar chain icon on NON-scope folder   → Pp.2b Create (this)
 *   - Overview's "+ Create new" CTA            → Pp.2b Create (this)
 *
 * The path is pre-filled from `panelState.nodeId` (set by whichever
 * trigger opened the page) so the user lands on a one-click "Create"
 * for the folder they actually meant. Path remains editable in case
 * they want to override the target.
 *
 * On success: transitions the panel to Pp.2a Detail of the new scope
 * via `onCreated(scope)` so the user immediately sees what they made.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { createScope, type RepoScope } from '@/lib/repoApi';
import { Dots } from '@/components/loading';
import { PanelShell } from '../PanelShell';
import { PathBreadcrumb } from './PathBreadcrumb';
import {
  COLOR_BG_DASHED,
  COLOR_BORDER,
  COLOR_BORDER_HOVER,
  COLOR_DANGER_FAINT,
  COLOR_FG,
  COLOR_FG_DIM,
  COLOR_FG_MUTED,
  COLOR_SUCCESS,
  PANEL_BG,
} from './tokens';

function normalizePath(raw: string): string {
  return raw.replaceAll(/^\/+|\/+$/g, '').replaceAll(/\/+/g, '/');
}

function deriveName(path: string): string {
  const segs = path.split('/').filter(Boolean);
  return segs.length > 0 ? segs[segs.length - 1] : 'Root';
}

interface Props {
  /**
   * Path to pre-fill the form with. Comes from whichever trigger
   * opened the page (sidebar chain icon's `nodeId`, or the current
   * folder for the Overview's CTA). If empty/'' the form lands on a
   * blank field and the user types their target.
   */
  readonly prefillPath: string;
  readonly scopes: readonly RepoScope[];
  readonly projectId: string;
  readonly onClose: () => void;
  readonly onBack: () => void;
  /** Called with the freshly-created scope so the parent can pop the
   *  panel into Pp.2a Detail of the new scope. */
  readonly onCreated: (scope: RepoScope) => void;
  readonly onMutated: () => Promise<unknown>;
  readonly hideHeader?: boolean;
}

export function CreateAccessPointPanel({
  prefillPath,
  scopes,
  projectId,
  onClose,
  onBack,
  onCreated,
  onMutated,
  hideHeader = false,
}: Props) {
  const [path, setPath] = useState<string>(() => normalizePath(prefillPath));
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // If the trigger fires again with a different prefill (e.g. user
  // clicked a different folder's chain icon while the create page is
  // open), refresh the field unless the user has already started
  // editing. Compare against the LAST prefill we saw, not the live
  // input value, so a user clearing the field manually doesn't
  // re-populate from a stale prefill on next render.
  const lastPrefillRef = useRef(prefillPath);
  useEffect(() => {
    if (prefillPath !== lastPrefillRef.current) {
      lastPrefillRef.current = prefillPath;
      setPath(normalizePath(prefillPath));
      setError(null);
    }
  }, [prefillPath]);

  const normalized = useMemo(() => normalizePath(path.trim()), [path]);
  const collides = useMemo(
    () => scopes.some((s) => s.path === normalized),
    [scopes, normalized],
  );
  const canCreate = path.trim() !== '' && !collides && !creating;
  const previewName = deriveName(normalized);
  const isRoot = normalized === '';

  const handleCreate = async () => {
    if (!canCreate) return;
    setCreating(true);
    setError(null);
    try {
      const scope = await createScope(projectId, {
        name: previewName,
        path: normalized,
        mode: 'rw',
        exclude: [],
      });
      // ✦ Order matters here:
      //
      //   1. The `await onMutated()` below refreshes the project's
      //      scopes via SWR. As soon as the new data lands in the
      //      cache, every subscriber re-renders — INCLUDING this
      //      form. At that moment our `collides` memo recomputes:
      //      the brand-new scope is now in `scopes` and matches our
      //      `path`, so collides flips false → true. Without
      //      mitigation, the form briefly re-renders showing the
      //      "An access point already exists at this path." warning
      //      at the user, even though they were the ones who just
      //      created it. (2026-05-08 user feedback: "it shows error
      //      'already exists' before transitioning, the flow is
      //      jarring".)
      //
      //   2. To avoid that flash we (a) leave `creating=true`
      //      through the unmount window — see the deliberately-
      //      missing `setCreating(false)` on the success path
      //      below — and (b) gate the collide warning's render on
      //      `!creating`. Together that means the warning is never
      //      reachable by the renderer between scope creation and
      //      panel transition.
      //
      //   3. Even if `onMutated` itself rejects (network blip during
      //      revalidation, etc.) the scope already exists server-
      //      side, so we still call `onCreated(scope)` — the user
      //      experiences a smooth jump to Detail; SWR will re-fetch
      //      lazily on next focus.
      try {
        await onMutated();
      } catch {
        // Refresh failed but the scope was created. Continue the
        // transition; the next focus / explicit refresh will pick
        // up the new row in the project's scopes.
      }
      onCreated(scope);
      // Note: deliberately NOT calling setCreating(false) on the
      // success path. The component is about to unmount as the
      // panel transitions to Detail; an interim setCreating(false)
      // would re-render this form once with creating=false +
      // collides=true, which the !creating guard above would no
      // longer mask, briefly flashing the misleading warning.
    } catch (e) {
      setError((e as Error).message || 'Failed to create access point');
      setCreating(false);
    }
  };

  return (
    <PanelShell
      title="Create access point"
      subtitle="Promote a folder to an access point"
      onClose={onClose}
      onBack={onBack}
      hideHeader={hideHeader}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          background: PANEL_BG,
        }}
      >
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            padding: '14px 12px 24px',
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
          }}
        >
          {/* Preview card — shows what's about to be created so the user
              can confirm the target before clicking Create. Mirrors the
              dashed-card geometry used elsewhere in the access surface. */}
          <div
            style={{
              padding: '14px',
              borderRadius: 8,
              border: `1px dashed ${COLOR_BORDER_HOVER}`,
              background: COLOR_BG_DASHED,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <div
              style={{
                fontSize: 10,
                fontWeight: 600,
                color: COLOR_FG_MUTED,
                textTransform: 'uppercase',
                letterSpacing: 0.6,
              }}
            >
              Target folder
            </div>

            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 500,
                  color: COLOR_FG,
                  lineHeight: 1.3,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {previewName}
              </div>
              <div
                style={{
                  fontSize: 11,
                  lineHeight: 1.5,
                  color: COLOR_FG_DIM,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                <PathBreadcrumb path={normalized} isRoot={isRoot} />
              </div>
            </div>
          </div>

          {/* Path editor — visible (and editable) so the user can adjust
              the prefill, e.g. when they triggered the create from the
              Overview's CTA at the project root and want to point
              somewhere deeper. Leading slashes are tolerated and
              normalised; collisions disable the Create button. */}
          <label
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              padding: '0 2px',
            }}
          >
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                color: COLOR_FG_MUTED,
                textTransform: 'uppercase',
                letterSpacing: 0.6,
              }}
            >
              Folder path
            </span>
            <input
              type="text"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="e.g. gtm/2026-04 or research/specs"
              autoFocus={prefillPath === ''}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && canCreate) {
                  e.preventDefault();
                  handleCreate();
                }
              }}
              style={{
                background: 'rgba(0,0,0,0.3)',
                border: `1px solid ${COLOR_BORDER}`,
                borderRadius: 6,
                color: COLOR_FG,
                fontSize: 13,
                padding: '8px 10px',
                outline: 'none',
              }}
            />
            {collides && !creating ? (
              // !creating is a transition guard: see the comment in
              // handleCreate() — during the brief window between
              // `await createScope` succeeding and the panel
              // unmounting (as it transitions to Detail), the freshly-
              // created scope shows up in `scopes` and would normally
              // make this collide warning fire at the same user who
              // just created it.  `creating` stays true through the
              // unmount, so this branch is unreachable in that window.
              <span style={{ fontSize: 11, color: COLOR_DANGER_FAINT }}>
                An access point already exists at this path.
              </span>
            ) : (
              <span style={{ fontSize: 11, color: COLOR_FG_DIM }}>
                Leading slashes are optional. Leave empty to target the
                workspace root.
              </span>
            )}
          </label>

          {/* Description block — frames why the user is here. Kept
              short so the form stays the centre of attention. */}
          <div
            style={{
              fontSize: 12,
              color: COLOR_FG_DIM,
              lineHeight: 1.55,
              padding: '0 2px',
            }}
          >
            Promoting this folder enables CLI, AI agent, and third-party
            integrations bound to it. Read & write by default — tighten
            the access mode after creation in the scope's Edit panel.
          </div>

          {/* Action row — Create + Cancel. Cancel returns to Overview
              instead of closing so the user lands on the management
              surface (consistent with how the back chevron behaves). */}
          <div
            style={{
              display: 'flex',
              gap: 8,
              alignItems: 'center',
              padding: '4px 2px 0',
            }}
          >
            <button
              type="button"
              onClick={handleCreate}
              disabled={!canCreate}
              style={{
                padding: '8px 14px',
                fontSize: 12,
                fontWeight: 500,
                color: canCreate ? '#0a0a0a' : COLOR_FG_DIM,
                background: canCreate ? COLOR_SUCCESS : 'rgba(255,255,255,0.04)',
                border: `1px solid ${canCreate ? 'rgba(52,211,153,0.7)' : COLOR_BORDER}`,
                borderRadius: 6,
                cursor: canCreate ? 'pointer' : 'not-allowed',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              {creating && <Dots size="xs" />}
              {creating ? 'Creating…' : 'Create access point'}
            </button>
            <button
              type="button"
              onClick={onBack}
              disabled={creating}
              style={{
                padding: '8px 12px',
                fontSize: 12,
                fontWeight: 500,
                color: COLOR_FG_DIM,
                background: 'transparent',
                border: `1px solid ${COLOR_BORDER}`,
                borderRadius: 6,
                cursor: creating ? 'default' : 'pointer',
              }}
            >
              Cancel
            </button>
          </div>

          {error && (
            <div
              style={{
                fontSize: 11,
                color: COLOR_DANGER_FAINT,
                padding: '0 2px',
              }}
            >
              {error}
            </div>
          )}
        </div>
      </div>
    </PanelShell>
  );
}
