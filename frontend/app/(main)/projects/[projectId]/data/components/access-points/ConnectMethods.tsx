'use client';

/**
 * ConnectMethods — the default ways to access a scope.
 *
 * Renders stacked MethodCards for the per-scope built-ins:
 *
 *   1. Terminal CLI — copyable terminal setup prompt
 *   2. Local Sync   — copyable bidirectional folder sync prompt
 *   3. AI Agent     — in-app chat runtime (currently HIDDEN behind
 *                     the `AI_AGENT_ENABLED` feature flag in
 *                     `frontend/lib/featureFlags.ts`; the card and
 *                     all activation wiring is still here, just
 *                     not rendered)
 *
 * Terminal CLI and Local Sync are exposure mechanisms — they hand
 * external clients (Claude Desktop, Cursor, MCP, your local
 * filesystem) the credentials and setup prompts to read/write this
 * scope from outside PuppyOne. AI Agent is a *consumer* of the same
 * data instead of an exposure path; it lives behind the feature flag
 * because the in-app chat surface conflicts with PuppyOne's
 * "platform under every agent" positioning.
 *
 * cli + filesystem + agent are auto-INSERTed per scope by a DB trigger
 * (post-2026-05-08 migration), so the scope always has an access_key
 * plus three connector records — one for each method. Each connector's
 * `status` (`active` / `paused`) is the single source of truth for
 * whether that method is enabled for this scope, and the in-card toggle
 * routes through `pauseConnector` / `resumeConnector` to flip it.
 *
 * Body visibility is now a pure function of the connector's active
 * status: active → expanded, paused → collapsed. There is no
 * separate user-controlled expand/collapse — see `./connect-methods/
 * MethodCard.tsx` for the full reasoning.
 *
 * The visual primitives (MethodCard, PromptBlock, CommandBlock,
 * Disclosure, etc.) and the per-method bodies live in `./connect-methods/`.
 * This file is the thin section orchestrator that wires up state +
 * mounts the right body inside each MethodCard.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  activateAgentConnector,
  pauseConnector,
  resumeConnector,
  type Connector,
  type RepoScope,
} from '@/lib/repoApi';
import { AI_AGENT_ENABLED } from '@/lib/featureFlags';
import {
  AiAgentBody,
  LocalSyncBody,
  METHOD_META,
  MethodCard,
  NoAccessKeyNotice,
  SectionHeader,
  TerminalCliBody,
  profileSlug,
} from './connect-methods';

interface ConnectMethodsBlockProps {
  readonly scope: RepoScope;
  /** Auto-INSERTed cli connector. Drives the Terminal CLI card's
   *  on/off toggle. The card body still derives prompts from the
   *  scope's access_key directly — toggling cli paused doesn't blank
   *  the body, it just stops the access key from authorising terminal
   *  access on the server side until resumed. */
  readonly cliConnector: Connector | undefined;
  /** Auto-INSERTed filesystem connector (added by the 2026-05-08
   *  migration). Drives the Local Sync card's on/off toggle for the
   *  same reason as cli — body content is shared from the scope
   *  access key, the connector status is what gates the server-side
   *  authorisation for sync sessions. */
  readonly filesystemConnector: Connector | undefined;
  /** Auto-INSERTed agent connector — also drives the in-card toggle,
   *  separately from the activation flow (`config.scope` is set
   *  during activation, `status` is set by pause/resume; both must
   *  be in the right state for the chat runtime to launch). */
  readonly agentConnector: Connector | undefined;
  readonly projectId: string;
  /** Backend base, e.g. `https://api.puppyone.com`. */
  readonly apiBase: string;
  /** Refresh repo scopes/connectors after agent activation OR a
   *  pause/resume so the parent SWR cache sees the new status. The
   *  inner local connector state is purely for optimistic UI between
   *  request start and the parent's revalidate landing — once the
   *  parent props update, we sync from those. */
  readonly onScopeMutated: () => Promise<unknown>;
  readonly onOpenAgentChat: (agentId: string, scopePath: string) => void;
}

export function ConnectMethodsBlock({
  scope,
  cliConnector,
  filesystemConnector,
  agentConnector,
  projectId,
  apiBase,
  onScopeMutated,
  onOpenAgentChat,
}: ConnectMethodsBlockProps) {
  // Local optimistic copies of each built-in connector. We keep them
  // here so a pause/resume click can flip the toggle UI in the same
  // frame as the click, without waiting for the round-trip + parent
  // revalidate to land. Each `useEffect` re-syncs from props once the
  // parent's data refreshes. Same pattern as the existing
  // `localAgentConnector` for activation — extended to cli + filesystem
  // now that those are togglable too.
  const [localCli, setLocalCli] = useState<Connector | undefined>(cliConnector);
  const [localFilesystem, setLocalFilesystem] = useState<Connector | undefined>(filesystemConnector);
  const [localAgent, setLocalAgent] = useState<Connector | undefined>(agentConnector);

  useEffect(() => setLocalCli(cliConnector), [cliConnector]);
  useEffect(() => setLocalFilesystem(filesystemConnector), [filesystemConnector]);
  useEffect(() => setLocalAgent(agentConnector), [agentConnector]);

  const [pendingCli, setPendingCli] = useState(false);
  const [pendingFilesystem, setPendingFilesystem] = useState(false);
  const [pendingAgentToggle, setPendingAgentToggle] = useState(false);

  const [activatingAgent, setActivatingAgent] = useState(false);
  const [agentActivationError, setAgentActivationError] = useState<string | null>(null);

  useEffect(() => {
    setAgentActivationError(null);
  }, [agentConnector]);

  const accessKey = scope.access_key || '';
  const cloneUrl = `${apiBase}/mut/ap/${accessKey}`;
  const scopeName = scope.name || (scope.path === '' ? 'root' : scope.path);
  const profileName = profileSlug(scope.name || scope.path || 'root');

  // Active flags — drive both the toggle position AND the body
  // visibility on each MethodCard. The card's body is now a pure
  // function of `active` (no manual expand/collapse), so flipping
  // these flags is the single user-facing way to show or hide the
  // method's body.
  const cliActive = localCli?.status === 'active';
  const filesystemActive = localFilesystem?.status === 'active';
  const agentActive = localAgent?.status === 'active';
  const agentActivated = Boolean(localAgent?.config?.scope);

  /**
   * Optimistic-toggle helper.
   *
   * Pause / resume on the backend is just `UPDATE access_points SET
   * status = ... WHERE id = ...` — a single PK update that returns
   * in milliseconds. The perceived latency, when we made the user
   * wait, came almost entirely from the *full SWR revalidate* we ran
   * afterwards (re-fetching the scope + connector list pulls
   * hundreds of KB through the auth middleware → backend → Supabase
   * pipeline, ~1-3s round-trip).
   *
   * The UX contract for a toggle should be: click → instant flip,
   * server confirms in the background. So we:
   *
   *   1. Flip the local copy synchronously — the switch animates
   *      in the same frame as the click.
   *   2. Fire the pause/resume API in the background. We DO NOT
   *      await it from the React handler — the local state is
   *      already correct, so blocking on the network only adds
   *      perceived latency without buying anything.
   *   3. Fire-and-forget the parent revalidate so a stale list
   *      eventually reconciles, but again don't await — the local
   *      state already reflects the new status.
   *   4. On error, roll the local copy back to its previous value
   *      so the toggle bounces visibly. (We log the error too;
   *      future PR can add a toast.)
   *
   * The `pending` flag stays around purely to deduplicate concurrent
   * requests (rapid double-click on the same toggle). It no longer
   * dims the switch — the click feels instant and the server
   * confirmation happens silently.
   */
  const toggleConnector = useCallback(
    (
      connector: Connector,
      setLocal: (c: Connector | undefined) => void,
      setPending: (b: boolean) => void,
    ) => {
      const next: 'active' | 'paused' =
        connector.status === 'active' ? 'paused' : 'active';
      const previous = connector;
      setPending(true);
      setLocal({ ...connector, status: next });

      const request =
        next === 'paused'
          ? pauseConnector(projectId, connector.id)
          : resumeConnector(projectId, connector.id);

      request
        .then(() => {
          // Fire-and-forget revalidate. We don't `await` it — the
          // local optimistic state already matches the server, and
          // blocking on a list refetch (~1-3s for the scopes +
          // connectors round-trip) just to confirm a single-row
          // update would defeat the point of optimistic UI.
          void onScopeMutated();
        })
        .catch((err) => {
          console.error('Failed to toggle connector:', err);
          setLocal(previous);
        })
        .finally(() => {
          setPending(false);
        });
    },
    [projectId, onScopeMutated],
  );

  const handleToggleCli = useCallback(() => {
    if (!localCli || pendingCli) return;
    void toggleConnector(localCli, setLocalCli, setPendingCli);
  }, [localCli, pendingCli, toggleConnector]);

  const handleToggleFilesystem = useCallback(() => {
    if (!localFilesystem || pendingFilesystem) return;
    void toggleConnector(localFilesystem, setLocalFilesystem, setPendingFilesystem);
  }, [localFilesystem, pendingFilesystem, toggleConnector]);

  const handleToggleAgent = useCallback(() => {
    if (!localAgent || pendingAgentToggle) return;
    void toggleConnector(localAgent, setLocalAgent, setPendingAgentToggle);
  }, [localAgent, pendingAgentToggle, toggleConnector]);

  const handleActivateAgent = useCallback(async () => {
    if (!localAgent?.id || activatingAgent || !agentActive) return;
    setActivatingAgent(true);
    setAgentActivationError(null);
    try {
      const updated = await activateAgentConnector(projectId, localAgent.id);
      setLocalAgent(updated);
      await onScopeMutated();
      onOpenAgentChat(updated.id, scope.path);
    } catch (err) {
      setAgentActivationError((err as Error).message || 'Failed to activate AI Agent');
    } finally {
      setActivatingAgent(false);
    }
  }, [
    localAgent,
    activatingAgent,
    agentActive,
    projectId,
    onScopeMutated,
    onOpenAgentChat,
    scope.path,
  ]);

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <SectionHeader eyebrow="Connect" />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {!accessKey && <NoAccessKeyNotice />}

        <MethodCard
          meta={METHOD_META.terminal}
          active={cliActive}
          togglePending={pendingCli}
          onToggle={localCli ? handleToggleCli : undefined}
        >
          <TerminalCliBody
            apiBase={apiBase}
            accessKey={accessKey}
            profileName={profileName}
            scopeName={scopeName}
            cloneUrl={cloneUrl}
          />
        </MethodCard>

        <MethodCard
          meta={METHOD_META.sync}
          active={filesystemActive}
          togglePending={pendingFilesystem}
          onToggle={localFilesystem ? handleToggleFilesystem : undefined}
        >
          <LocalSyncBody
            accessKey={accessKey}
            cloneUrl={cloneUrl}
            scopeName={scopeName}
          />
        </MethodCard>

        {/* AI Agent MethodCard — gated on `AI_AGENT_ENABLED` feature
            flag (see `frontend/lib/featureFlags.ts` for the full
            rationale). The activation handler, toggle wiring,
            optimistic state, and the AiAgentBody component are all
            kept intact below the gate so flipping the flag back to
            `true` re-enables the surface without code changes. */}
        {AI_AGENT_ENABLED && (
          <MethodCard
            meta={METHOD_META.agent}
            active={agentActive}
            togglePending={pendingAgentToggle}
            onToggle={localAgent ? handleToggleAgent : undefined}
          >
            <AiAgentBody
              scopeName={scopeName}
              activated={agentActivated}
              // While the connector is paused the activation flow is
              // disabled — the user has to flip the toggle on first
              // before the chat runtime can be wired up. Same gate
              // applies once activated: pausing freezes the "Open chat"
              // button so accidental access is blocked while the
              // connector is intentionally off.
              canActivate={Boolean(localAgent?.id) && agentActive}
              activating={activatingAgent}
              activationError={agentActivationError}
              onActivate={handleActivateAgent}
              onOpenChat={() => {
                if (localAgent?.id && agentActive) {
                  onOpenAgentChat(localAgent.id, scope.path);
                }
              }}
            />
          </MethodCard>
        )}
      </div>
    </section>
  );
}
