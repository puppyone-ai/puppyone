import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listAgentLinks, listAgentSessions } from "../../features/cloud/share/agentLinks";
import { resolveWorkspaceAgents } from "../../features/cloud/share/useWorkspaceAgents";
import type { DesktopCloudSession } from "../../lib/cloudApi";
import type { CloudSpace, ProjectHomeItem } from "../../lib/workspaceHomeModel";

/** An Agent that can reach the person's Cloud projects, as the Cloud last saw it. */
export type HomepageCloudAgent = Readonly<{
  id: string;
  name: string;
  /** The brand the Agent chose when it connected, if any. */
  avatar: string | null;
  lastActiveAt: string | null;
}>;

const EMPTY_CLOUD_AGENTS: readonly HomepageCloudAgent[] = [];
const EMPTY_PROJECT_AGENTS: ReadonlyMap<string, readonly HomepageCloudAgent[]> = new Map();

function isForbiddenCloudError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { status?: unknown }).status === 403;
}

function newerIsoTimestamp(left: string | null, right: string | null): string | null {
  if (!left) return right;
  if (!right) return left;
  const leftMs = Date.parse(left);
  const rightMs = Date.parse(right);
  if (Number.isNaN(leftMs)) return right;
  if (Number.isNaN(rightMs)) return left;
  return rightMs > leftMs ? right : left;
}

/**
 * Reads the Agents connected to the person's personal-space Cloud projects on mount
 * and window focus only (never polling). Deduplicates the top strip by `name + avatar`
 * and keeps per-project Agent lists for Cloud project tiles.
 */
export function useHomepageCloudAgents({
  enabled,
  session,
  apiBaseUrl,
  spaces,
  items,
}: {
  enabled: boolean;
  session: DesktopCloudSession | null;
  apiBaseUrl: string | null;
  spaces: readonly CloudSpace[];
  items: readonly ProjectHomeItem[];
}): Readonly<{
  agents: readonly HomepageCloudAgent[];
  projectAgents: ReadonlyMap<string, readonly HomepageCloudAgent[]>;
}> {
  const personalSpaceId = spaces.find((space) => space.isDefault)?.id ?? null;
  const personalProjectIds = useMemo(() => {
    if (!personalSpaceId) return [] as string[];
    const seen = new Set<string>();
    const ids: string[] = [];
    for (const item of items) {
      if (!item.cloudProjectId || item.cloudOrganizationId !== personalSpaceId) continue;
      if (seen.has(item.cloudProjectId)) continue;
      seen.add(item.cloudProjectId);
      ids.push(item.cloudProjectId);
    }
    return ids;
  }, [items, personalSpaceId]);

  const projectIdsKey = personalProjectIds.join("\n");
  const canQuery = Boolean(enabled && session && apiBaseUrl && personalSpaceId && projectIdsKey);
  const [state, setState] = useState<{
    key: string;
    agents: readonly HomepageCloudAgent[];
    projectAgents: ReadonlyMap<string, readonly HomepageCloudAgent[]>;
  }>({
    key: "",
    agents: EMPTY_CLOUD_AGENTS,
    projectAgents: EMPTY_PROJECT_AGENTS,
  });
  const generationRef = useRef(0);
  const scopeKey = canQuery && session ? `${session.user_id}:${session.session_generation}:${apiBaseUrl}:${projectIdsKey}` : "";

  const refresh = useCallback(async () => {
    if (!canQuery || !session || !apiBaseUrl || !projectIdsKey) return;
    const requestId = ++generationRef.current;
    const projectIds = projectIdsKey.split("\n");
    const nextProjectAgents = new Map<string, readonly HomepageCloudAgent[]>();
    const deduplicated = new Map<string, HomepageCloudAgent>();

    await Promise.all(projectIds.map(async (projectId) => {
      const [linksOutcome, sessionsOutcome] = await Promise.allSettled([
        listAgentLinks(session, projectId, apiBaseUrl),
        listAgentSessions(session, projectId, apiBaseUrl),
      ]);

      if (linksOutcome.status === "rejected") {
        if (!isForbiddenCloudError(linksOutcome.reason)) {
          // Non-403 failures still must not break the Homepage strip.
        }
        return;
      }

      const sessions = sessionsOutcome.status === "fulfilled" ? sessionsOutcome.value : [];

      const resolved = resolveWorkspaceAgents(linksOutcome.value.connections, sessions, Date.now());
      if (resolved.length === 0) return;

      const mapped: HomepageCloudAgent[] = resolved.map((agent) => ({
        id: agent.id,
        name: agent.name,
        avatar: agent.avatar ?? null,
        lastActiveAt: agent.lastActiveAt,
      }));
      nextProjectAgents.set(projectId, mapped);

      for (const agent of mapped) {
        const dedupeKey = `${agent.name}\0${agent.avatar ?? ""}`;
        const existing = deduplicated.get(dedupeKey);
        if (!existing) {
          deduplicated.set(dedupeKey, agent);
        } else {
          deduplicated.set(dedupeKey, {
            ...existing,
            lastActiveAt: newerIsoTimestamp(existing.lastActiveAt, agent.lastActiveAt),
          });
        }
      }
    }));

    if (requestId !== generationRef.current) return;
    setState({
      key: scopeKey,
      agents: deduplicated.size > 0 ? [...deduplicated.values()] : EMPTY_CLOUD_AGENTS,
      projectAgents: nextProjectAgents.size > 0 ? nextProjectAgents : EMPTY_PROJECT_AGENTS,
    });
  }, [apiBaseUrl, canQuery, projectIdsKey, scopeKey, session]);

  useEffect(() => {
    if (!canQuery) {
      generationRef.current += 1;
      return undefined;
    }
    void refresh();
    const onFocus = () => { void refresh(); };
    window.addEventListener("focus", onFocus);
    return () => {
      generationRef.current += 1;
      window.removeEventListener("focus", onFocus);
    };
  }, [canQuery, refresh]);

  return useMemo(() => {
    if (!canQuery || state.key !== scopeKey) {
      return { agents: EMPTY_CLOUD_AGENTS, projectAgents: EMPTY_PROJECT_AGENTS };
    }
    return { agents: state.agents, projectAgents: state.projectAgents };
  }, [canQuery, scopeKey, state]);
}
