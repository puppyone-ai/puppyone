'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/app/supabase/SupabaseAuthProvider';
import { post } from '@/lib/apiClient';
import { uploadFiles as uploadFilesApi } from '@/lib/uploadApi';
import {
  addPendingTasks,
  updateTaskStatusById,
  updateTaskProgress,
  replaceTaskId,
} from '@/components/BackgroundTaskNotifier';
import { refreshAllContentNodes } from '@/lib/hooks/useData';
import {
  resolveDataTransferSnapshot,
  snapshotDataTransfer,
} from '@/lib/dropFiles';
import { T } from '../lib/tokens';
import type { DashboardConnection } from '../lib/types';

// =====================================================================
// GetStartedPanel — empty-state for a freshly created project's Home.
//
// Replaces bands 2 + 3 of the regular Home layout when `nodes.total ===
// 0`.  The page-level trigger deliberately ignores `connections.length`
// — see the comment in `home/page.tsx` for the rationale (TL;DR: an AP
// without data behind it is setup-in-progress, not completion, so the
// panel must wait for actual content before retiring).
//
// LAYOUT — single column, two stacked surfaces:
//
//   ┌─────────────────────────────────────────┐
//   │                                         │
//   │              ↑  Drop files              │   ← primary, dominant
//   │       Drag anywhere · Pick from disk    │     dashed dropzone,
//   │                                         │     full-page DnD
//   └─────────────────────────────────────────┘
//
//     Or sync from your terminal
//   ┌─────────────────────────────────────────┐
//   │  $ git clone <url>              [Copy]  │   ← secondary, quiet
//   │  $ git push origin main         [Copy]  │     copy-only card
//   └─────────────────────────────────────────┘
//
//        Need a different source? → /access
//
// We do NOT make the user "choose" between drop and CLI — both paths
// are visible and ready at all times.  The dropzone is the dominant
// affordance (fits 95% of users); the git block is a quiet, always-
// copyable hint for the power-user minority.  Either path completing
// (drop succeeds, or `git push` lands data) flips `nodes.total > 0` and
// the panel auto-retires.
//
// CLI bootstrap policy — EAGER on first panel mount.  The bootstrap
// endpoint is server-side idempotent: `(project_id, '/')` returns the
// existing AP if one exists, else mints a new one.  We trade one
// sometimes-unused root filesystem AP per project (visible in /access,
// deletable from there) for an instant-copyable command experience —
// the previous "click Enable to reveal the commands" pattern collapsed
// the panel mid-onboarding by flipping the trigger condition (now fixed,
// but the click itself was unnecessary friction either way).
// =====================================================================

interface GetStartedPanelProps {
  projectId: string;
  /** Current AP list from the dashboard payload.  We look here first
   *  for an already-bootstrapped root filesystem AP — if found, we
   *  skip the bootstrap call and seed the CLI card from server truth.
   *  This makes the panel refresh-safe and tab-switch-safe. */
  connections: DashboardConnection[];
  /** Called after files upload starts and after a CLI AP is created /
   *  refreshed.  Wire this to SWR `mutate` of the dashboard + tree so
   *  the empty state collapses back into the regular canvas the
   *  moment data shows up. */
  onChanged?: () => void;
}

export function GetStartedPanel({
  projectId,
  connections,
  onChanged,
}: GetStartedPanelProps) {
  const router = useRouter();
  const { session } = useAuth();
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const dragCounterRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  // ---- Upload pipeline (direct-to-S3, project root, no dialog) -----
  // Same pipeline as the explorer dialog and sidebar drag/drop: bytes
  // go browser -> S3 directly via presigned multipart URLs, the
  // worker commits them through the Version Engine, and the BackgroundTaskNotifier
  // surfaces progress via the floating widget. No dialog asks the
  // user about OCR vs raw because Smart Parse is paused server-side
  // (see config.ENABLE_OCR).
  const uploadFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      if (!session?.access_token) {
        console.error('GetStartedPanel: no access token; cannot upload');
        return;
      }
      setUploading(true);
      const placeholderIds: string[] = [];

      try {
        await uploadFilesApi(
          { projectId, files, parentPath: null },
          session.access_token,
          {
            onUploadStart: (entries) => {
              entries.forEach((f) => {
                const tmpId = `tmp-${crypto.randomUUID()}`;
                placeholderIds[f.fileIndex] = tmpId;
              });
              addPendingTasks(
                entries.map((f) => ({
                  taskId: placeholderIds[f.fileIndex],
                  projectId,
                  tableName: f.filename,
                  filename: f.filename,
                  status: 'uploading',
                  taskType: 'file',
                })),
              );
            },
            onTaskCreated: ({ fileIndex, taskId }) => {
              const tmpId = placeholderIds[fileIndex];
              if (tmpId) {
                replaceTaskId(tmpId, taskId);
                placeholderIds[fileIndex] = taskId;
              }
            },
            onProgress: (taskId, _loaded, _total, percent) => {
              updateTaskProgress(taskId, percent);
            },
            onAllPartsUploaded: (taskId) => {
              updateTaskStatusById(taskId, 'finalizing');
            },
            onTaskCompleted: (taskId) => {
              updateTaskStatusById(taskId, 'completed');
            },
            onTaskFailed: (taskId, error) => {
              updateTaskStatusById(taskId, 'failed', { error });
            },
          },
        );

        refreshAllContentNodes(projectId);
        onChanged?.();
      } catch (err) {
        // /upload/init failed — flip placeholders to failed so the
        // widget surfaces a stable terminal state.
        const errMsg = err instanceof Error ? err.message : String(err);
        placeholderIds.forEach((id) => {
          if (id) updateTaskStatusById(id, 'failed', { error: errMsg });
        });
        console.error('GetStartedPanel: upload failed', err);
      } finally {
        setUploading(false);
      }
    },
    [projectId, session?.access_token, onChanged],
  );

  // ---- Page-level drag handlers (panel root) ------------------------
  // Counter pattern (same as useFileImport) avoids the well-known
  // dragLeave-on-child flicker.  We only react to drags that carry
  // actual files — DOM drag-and-drop of cards/text is ignored.
  const onDragEnter = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    setIsDraggingOver(true);
  }, []);

  const onDragOver = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setIsDraggingOver(false);
    }
  }, []);

  const onDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current = 0;
      setIsDraggingOver(false);
      // Snapshot synchronously: see lib/dropFiles.ts.
      const snapshot = snapshotDataTransfer(e.nativeEvent);
      const files = await resolveDataTransferSnapshot(snapshot);
      if (files.length > 0) await uploadFiles(files);
    },
    [uploadFiles],
  );

  const onFilePickerChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files;
    if (list && list.length > 0) {
      void uploadFiles(Array.from(list));
    }
    e.target.value = ''; // allow re-selecting the same file
  };

  return (
    // No `alignItems: center` and no inner `maxWidth` — children
    // stretch to the full content width set by the page wrapper above
    // (`maxWidth: 1080`), so the drop zone's left edge lines up with
    // the page title.  Vertical rhythm: 48 between page header and
    // panel, 32 between primary (drop) and secondary (CLI), 24 between
    // CLI and the demoted escape hatch.  Same 48/32/24 nesting the
    // regular 3-band layout uses.
    <div
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      style={{
        position: 'relative',
        marginTop: 48,
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <DropFilesCard
        isDraggingOver={isDraggingOver}
        uploading={uploading}
        onPickFiles={() => fileInputRef.current?.click()}
        onPickFolder={() => folderInputRef.current?.click()}
      />

      <div style={{ marginTop: 32 }}>
        <GitSyncBlock projectId={projectId} connections={connections} onReady={onChanged} />
      </div>

      {/* Demoted escape hatch — left-aligned, body text size, no
          decoration.  One sentence, one role: "if neither path fits,
          here's where the full provider catalogue lives." */}
      <button
        onClick={() => router.push(`/projects/${projectId}/access`)}
        style={{
          marginTop: 24,
          alignSelf: 'flex-start',
          background: 'none',
          border: 'none',
          height: 30,
          padding: 0,
          color: T.text3,
          fontSize: 13,
          cursor: 'pointer',
          fontFamily: T.fontSans,
          transition: `color 200ms ${T.ease}`,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = T.text1;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = T.text3;
        }}
      >
        Need a different source? Add an integration →
      </button>

      {/* Hidden inputs — clicked programmatically from DropFilesCard. */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        onChange={onFilePickerChange}
        style={{ display: 'none' }}
      />
      <input
        ref={folderInputRef}
        type="file"
        multiple
        // `webkitdirectory` is non-standard but the only practical way
        // to get a folder picker.  React's TS types don't know it; cast
        // to any to silence the prop-name complaint.
        {...({ webkitdirectory: '', directory: '' } as any)}
        onChange={onFilePickerChange}
        style={{ display: 'none' }}
      />

      {/* Full-panel drag overlay.  Non-interactive; just paints a cyan
          dashed frame + soft tint over everything so the user knows the
          drop is captured (rather than hovering over a sibling element
          that won't accept the drop).  Pointer-events:none so it never
          steals the actual drop event from the wrapper. */}
      {isDraggingOver && (
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: -12,
            border: `2px dashed ${T.live}`,
            borderRadius: 12,
            background: 'color-mix(in srgb, var(--po-info) 5%, transparent)',
            pointerEvents: 'none',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'center',
            paddingTop: 16,
          }}
        >
          <div
            style={{
              padding: '6px 14px',
              borderRadius: 999,
              background: T.live,
              color: 'var(--po-inset)',
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: '0.02em',
            }}
          >
            Release to upload
          </div>
        </div>
      )}
    </div>
  );
}

// =====================================================================
// DropFilesCard — the dominant primary surface.  Big icon, headline,
// short helper line, two action buttons.  Click anywhere on the card
// opens the file picker; the folder picker has its own button so users
// who only wanted a single file aren't surprised by a directory dialog.
// =====================================================================

function DropFilesCard({
  isDraggingOver,
  uploading,
  onPickFiles,
  onPickFolder,
}: {
  isDraggingOver: boolean;
  uploading: boolean;
  onPickFiles: () => void;
  onPickFolder: () => void;
}) {
  const [hover, setHover] = useState(false);
  const active = isDraggingOver || hover;

  // Typography in this card sticks to the unified panel scale: 14/600
  // for the heading, 13 for body, 13/500 for buttons.  No decorative
  // upload-arrow icon at the top — the dashed border + the literal
  // "Drop files…" sentence already convey the affordance, the icon was
  // chrome.  Buttons share a single weight (500) so neither one reads
  // as the "blessed" choice — both are equally valid entry points.
  return (
    <div
      onClick={onPickFiles}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        minHeight: 220,
        padding: '40px 24px',
        borderRadius: 8,
        border: `1px dashed ${active ? T.live : T.cardBorderH}`,
        background: active ? 'color-mix(in srgb, var(--po-info) 4%, transparent)' : T.cardBg,
        cursor: 'pointer',
        transition: `all 200ms ${T.ease}`,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
        textAlign: 'center',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: T.text1,
            lineHeight: 1.4,
          }}
        >
          Drop files or a folder here
        </div>
        <div style={{ fontSize: 13, color: T.text3, lineHeight: 1.5 }}>
          Drag anywhere on this page, or pick from your disk
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onPickFiles();
          }}
          disabled={uploading}
          style={{
            height: 30,
            padding: '0 14px',
            borderRadius: 6,
            border: `1px solid ${T.text1}`,
            background: T.text1,
            color: 'var(--po-inset)',
            fontSize: 13,
            fontWeight: 500,
            cursor: uploading ? 'not-allowed' : 'pointer',
            opacity: uploading ? 0.5 : 1,
            fontFamily: T.fontSans,
            transition: `all 200ms ${T.ease}`,
          }}
        >
          {uploading ? 'Uploading…' : 'Choose files'}
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onPickFolder();
          }}
          disabled={uploading}
          style={{
            height: 30,
            padding: '0 14px',
            borderRadius: 6,
            border: `1px solid ${T.border}`,
            background: 'transparent',
            color: T.text1,
            fontSize: 13,
            fontWeight: 500,
            cursor: uploading ? 'not-allowed' : 'pointer',
            opacity: uploading ? 0.5 : 1,
            fontFamily: T.fontSans,
            transition: `all 200ms ${T.ease}`,
          }}
          onMouseEnter={(e) => {
            if (!uploading) e.currentTarget.style.borderColor = T.borderH;
          }}
          onMouseLeave={(e) => {
            if (!uploading) e.currentTarget.style.borderColor = T.border;
          }}
        >
          Choose folder
        </button>
      </div>
    </div>
  );
}

// =====================================================================
// GitSyncBlock — secondary, subordinate surface.  Always-on, always-
// copyable terminal block.  No CTA, no Enable button — the AP is
// silently bootstrapped on mount (server-side idempotent) so the
// commands populate with the real access key as soon as the network
// round-trip resolves (the key is wired into the git-credentials helper
// line of the connect script).
//
// State derives from server truth (`connections` prop).  If the
// dashboard already lists a root filesystem AP with an access_key, we
// skip the bootstrap call and seed the commands from that.  Otherwise
// we fire bootstrap once on mount and capture the returned key.
// =====================================================================

function GitSyncBlock({
  projectId,
  connections,
  onReady,
}: {
  projectId: string;
  connections: DashboardConnection[];
  onReady?: () => void;
}) {
  // Look for an already-bootstrapped root filesystem AP in dashboard
  // truth.  We accept either '/' or null path as "root scope" — older
  // rows in the wild have null.  This makes the block instantly ready
  // on refresh / tab switch / second-machine open.
  //
  // CRITICAL: the dashboard endpoint masks access_key for safety
  // (see backend dashboard_router._mask_key — turns
  // `cli_<43chars>` into `cli_<prefix>...<last4>`).  That masked
  // string is fine to *display* but useless to *paste into a
  // terminal*: the literal `...` makes the key look like
  // `cli_...R6CA` which the backend can't resolve, so
  // the connect command returns 401 / not found.  Treat the masked form
  // as "no seed" so the bootstrap effect below fires and the
  // bootstrap endpoint (idempotent — returns the existing AP's
  // real, full access_key) gives us a paste-runnable command.
  const seededKey = useMemo(() => {
    const fs = connections.find(
      (c) =>
        c.provider === 'filesystem' &&
        (c.path === '/' || c.path === null || c.path === '') &&
        !!c.access_key,
    );
    const raw = fs?.access_key ?? null;
    if (raw && raw.includes('...')) return null;
    return raw;
  }, [connections]);

  const [accessKey, setAccessKey] = useState<string | null>(seededKey);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const bootstrapTriggered = useRef(false);
  const [copied, setCopied] = useState<string | null>(null);

  // Keep `accessKey` in sync with server truth — if connections updates
  // (e.g. SWR revalidation surfaces an AP we didn't have before), we
  // adopt it instead of holding stale local state.
  useEffect(() => {
    if (seededKey && seededKey !== accessKey) setAccessKey(seededKey);
  }, [seededKey, accessKey]);

  // Eager bootstrap on mount — fire-and-forget.  Idempotent on backend
  // so calling it when an AP already exists just returns the same key
  // (we'd already have it from `seededKey` in that case, but the call
  // is cheap insurance against the edge case where dashboard hasn't
  // surfaced the AP yet for a brand-new project).
  useEffect(() => {
    if (accessKey || bootstrapTriggered.current) return;
    bootstrapTriggered.current = true;

    let cancelled = false;
    (async () => {
      try {
        const result = await post<{
          access_point_id: string;
          access_key: string;
          path: string;
          project_id: string;
        }>(
          `/api/v1/filesystem/bootstrap?project_id=${encodeURIComponent(
            projectId,
          )}&path=${encodeURIComponent('/')}`,
        );
        if (cancelled) return;
        setAccessKey(result.access_key);
        setBootstrapError(null);
        // Nudge SWR so the dashboard re-fetches and any AP-list UI
        // elsewhere (e.g. /access) reflects the new entry promptly.
        // Important: this does NOT collapse the panel — the trigger
        // condition is `nodes.total > 0`, not `connections > 0`.
        onReady?.();
      } catch (err) {
        if (cancelled) return;
        console.warn('Filesystem bootstrap failed:', err);
        setBootstrapError(
          err instanceof Error ? err.message : 'CLI commands unavailable',
        );
        // Reset so a future render can retry (e.g. user comes back
        // online).  We don't auto-retry on a timer here — the dropzone
        // path is fully functional regardless.
        bootstrapTriggered.current = false;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [accessKey, projectId, onReady]);

  // The Git remote endpoint that backs this access point. Stock
  // `git clone`, `git push`, and `git pull --ff-only` all talk to it
  // directly. The URL must point at the *backend* host (not the
  // Next.js origin) — local dev set `NEXT_PUBLIC_API_URL` to the
  // backend, single-host deployments fall back to `window.location.origin`.
  // This is the canonical Git-native transport.
  const apiBase = typeof window !== 'undefined'
    ? (process.env.NEXT_PUBLIC_API_URL || window.location.origin)
    : '';
  const apUrl = accessKey ? `${apiBase}/git/ap/${accessKey}.git` : '';

  // The onboarding command for an EMPTY project bootstraps a fresh
  // git repo and pushes the user's local folder up. `clone` pulls
  // server → local; meaningless when the server side is empty. This
  // sequence does the opposite: init + remote + push so the local
  // files become the project's contents. Direction matches the
  // drop-zone above (local → server) instead of contradicting it.
  //
  // CRITICAL: this command must be runnable as-is when pasted into a
  // terminal inside the user's project folder. We DO include
  // git-credential auth as the first line so the push doesn't prompt
  // for a password — the access key plays the password role over
  // Basic auth.
  const apiHost = (() => {
    try { return apUrl ? new URL(apUrl).host : ''; }
    catch { return ''; }
  })();
  const connectCmd = accessKey
    ? [
        'git config --global credential.helper store',
        String.raw`printf "https://x-access-token:%s@%s\n" "` + accessKey + `" "${apiHost}" >> ~/.git-credentials`,
        'git init -b main',
        `git remote add origin ${apUrl}`,
        'git add -A && git commit -m "initial import" && git push -u origin main',
      ].join('\n')
    : '';

  const copy = useCallback((text: string, key: string) => {
    void navigator.clipboard.writeText(text);
    setCopied(key);
    window.setTimeout(() => setCopied(null), 1500);
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Eyebrow — matches the "DATA" eyebrow style on the regular Home
          layout's left card: 11px / 500 / uppercase / 0.10em / text3.
          Naming reflects the actual data direction (local → server),
          parallel to the drop-zone above. */}
      <div
        style={{
          fontSize: 11,
          fontWeight: 500,
          color: T.text3,
          letterSpacing: '0.10em',
          textTransform: 'uppercase',
          fontFamily: T.fontSans,
        }}
      >
        Or sync from a local folder
      </div>

      {/* Step 1 — prereq check. Stock `git` is the data plane now;
          we only need to verify it's installed
          rather than offer a CLI to install. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <ProseLabel>Confirm Git is installed (one-time):</ProseLabel>
        <CmdLine
          cmd="git --version"
          copied={copied === 'install'}
          onCopy={() => copy('git --version', 'install')}
        />
      </div>

      {/* Step 2 — connect.  Three render branches; ONLY the `ready`
          branch produces a `$`-prefixed copyable command.  Loading
          renders a non-text skeleton bar (clearly not a command),
          error renders prose + retry (no `$`, no copy button) — both
          paths foolproof against blind copy-paste. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <ProseLabel>
          In a terminal,{' '}
          <span style={{ color: T.text2, fontWeight: 500 }}>
            cd into the local folder you want to sync
          </span>
          , then run:
        </ProseLabel>
        {accessKey ? (
          <CmdLine
            cmd={connectCmd}
            copied={copied === 'connect'}
            onCopy={() => copy(connectCmd, 'connect')}
            wrap
          />
        ) : bootstrapError ? (
          <CmdLineError onRetry={() => location.reload()} />
        ) : (
          <CmdLineSkeleton />
        )}
      </div>

      {/* Reassurance footer — the init-and-push sequence looks like it
          might overwrite the user's local files; spelling out the
          server-side merge semantics removes the "wait, will this
          delete my stuff?" hesitation. */}
      <div
        style={{
          fontSize: 13,
          color: T.text3,
          lineHeight: 1.5,
        }}
      >
        First pulls cloud state with rebase, then pushes the result. The
        server applies the V1 conflict policy (safe auto-merge → parent-
        scope-wins → LWW); unsafe conflicts queue for manual review and
        the push is rejected with a clear message — nothing silently
        overwrites your work.
      </div>
    </div>
  );
}

// =====================================================================
// ProseLabel — instructional text that sits above a copyable command.
// Distinctly NOT terminal styled (no mono font, no `$` prefix, no dark
// background) so users never confuse instructions with runnable code.
// =====================================================================

function ProseLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 13, color: T.text3, lineHeight: 1.5 }}>
      {children}
    </div>
  );
}

// =====================================================================
// CmdLineSkeleton — placeholder rendered while bootstrap is in flight.
// Uses an animated grey bar instead of any text — a user can't
// accidentally copy a skeleton.  No Copy button (don't even tempt the
// click).  Layout matches `CmdLine` so the row doesn't jump when the
// real command arrives.
// =====================================================================

function CmdLineSkeleton() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 12px',
        background: 'var(--po-inset)',
        border: `1px solid ${T.cardBorder}`,
        borderRadius: 6,
      }}
    >
      <span
        style={{
          fontSize: 12,
          color: T.text3,
          fontFamily: T.fontMono,
          flexShrink: 0,
        }}
      >
        $
      </span>
      <div
        className="animate-pulse"
        style={{
          flex: 1,
          height: 12,
          background: 'var(--po-border-subtle)',
          borderRadius: 2,
        }}
      />
    </div>
  );
}

// =====================================================================
// CmdLineError — bootstrap failed.  Prose only, no `$`, no Copy button,
// nothing that could be mistaken for a runnable command.  Includes a
// retry that simply reloads the page (rebuilds the whole component
// tree, so the bootstrap re-fires from scratch on a fresh useEffect).
// =====================================================================

function CmdLineError({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      style={{
        padding: '10px 12px',
        background: 'var(--po-inset)',
        border: `1px solid ${T.cardBorder}`,
        borderRadius: 6,
        fontSize: 13,
        color: T.text3,
        lineHeight: 1.5,
      }}
    >
      Couldn’t generate credentials.{' '}
      <button
        onClick={onRetry}
        style={{
          background: 'none',
          border: 'none',
          height: 30,
          padding: 0,
          color: T.text2,
          fontSize: 13,
          cursor: 'pointer',
          textDecoration: 'underline',
          fontFamily: T.fontSans,
        }}
      >
        Try again
      </button>
      , or use the file drop above.
    </div>
  );
}

// =====================================================================
// CmdLine — single runnable command rendered as `$ <cmd>` plus a Copy
// button.  Anything in here is a hard contract: it MUST be paste-and-
// run safe, because users will copy it without reading.  Loading and
// error states live in sibling components (`CmdLineSkeleton`,
// `CmdLineError`) so this component never shows fake-command text.
//
// `wrap` enables soft-wrap + word-break for long lines like the access-
// point URL; default behaviour is single-line ellipsis.
// =====================================================================

function CmdLine({
  cmd,
  copied,
  onCopy,
  wrap,
}: {
  cmd: string;
  copied: boolean;
  onCopy: () => void;
  wrap?: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: wrap ? 'flex-start' : 'center',
        justifyContent: 'space-between',
        gap: 12,
        padding: '8px 12px',
        background: 'var(--po-inset)',
        border: `1px solid ${T.cardBorder}`,
        borderRadius: 6,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: wrap ? 'flex-start' : 'center',
          gap: 8,
          flex: 1,
          minWidth: 0,
        }}
      >
        {/* `$` and code share the same 12-px mono size — visually
            adjacent characters at different sizes reads as a typo. */}
        <span
          style={{
            fontSize: 12,
            color: T.text3,
            fontFamily: T.fontMono,
            flexShrink: 0,
            marginTop: wrap ? 2 : 0,
          }}
        >
          $
        </span>
        <code
          style={{
            flex: 1,
            fontSize: 12,
            color: T.text1,
            fontFamily: T.fontMono,
            lineHeight: 1.6,
            ...(wrap
              ? { whiteSpace: 'pre-wrap', wordBreak: 'break-all' }
              : { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }),
          }}
        >
          {cmd}
        </code>
      </div>
      <button
        onClick={onCopy}
        style={{
          flexShrink: 0,
          height: 30,
          padding: '0 10px',
          borderRadius: 4,
          border: `1px solid ${T.cardBorder}`,
          background: 'var(--po-hover)',
          color: copied ? 'var(--po-success)' : T.text2,
          fontSize: 11,
          fontWeight: 500,
          cursor: 'pointer',
          fontFamily: T.fontSans,
          transition: `all 150ms ${T.ease}`,
          alignSelf: wrap ? 'flex-start' : 'center',
        }}
      >
        {copied ? '✓' : 'Copy'}
      </button>
    </div>
  );
}
