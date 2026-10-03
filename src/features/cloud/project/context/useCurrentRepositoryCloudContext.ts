import { useEffect, useMemo, useRef, useState } from "react";
import type { Workspace } from "@puppyone/shared-ui";
import {
  getCloudRepositoryContext,
  type DesktopCloudSession,
} from "../../../../lib/cloudApi";
import type { GitStatusSnapshot } from "../../../../types/electron";
import {
  describePuppyoneRemoteCandidates,
  resolveCanonicalPuppyoneRemotes,
  type PuppyoneRemoteResolution,
} from "../../../source-control/remotes";
import { cloudMessage } from "../../cloudPresentation";
import { repositoryTargetMatchesRemote } from "../../repositoryTarget";
import { isRetryableCloudFailure } from "../../workspace/cloudProjectResolution";
import { createWorkspaceCloudResolutionKey } from "../../workspace/workspaceCloudResolutionKey";
import { isTrustedCloudGitOrigin } from "../../workspace/workspaceGitRemote";
import type { ProjectCloudContext } from "./projectCloudContext";

type UniqueRemote = Extract<PuppyoneRemoteResolution, { status: "unique" }>;

type ResolutionSnapshot = {
  key: string;
  activeCloudSession: DesktopCloudSession | null;
  activeGitStatus: GitStatusSnapshot | null;
  desktopCloudApiBaseUrl: string | null;
  workspace: Workspace;
};

type ResolutionResult = {
  key: string | null;
  context: ProjectCloudContext;
};

function errorStatus(error: unknown): number | null {
  return error && typeof error === "object" && "status" in error
    ? Number((error as { status?: unknown }).status) || null
    : null;
}

function errorCode(error: unknown): string | null {
  return error && typeof error === "object" && "code" in error
    ? String((error as { code?: unknown }).code ?? "") || null
    : null;
}

function contextMatchesRemote(
  remote: UniqueRemote,
  context: Awaited<ReturnType<typeof getCloudRepositoryContext>>,
): boolean {
  return remote.info.kind !== "access-point"
    && context.project.id === context.target.project_id
    && repositoryTargetMatchesRemote(context.target, remote.info);
}

/**
 * Resolve exactly one Cloud Project from the currently open repository.
 *
 * The hook owns its asynchronous state instead of publishing into a homepage
 * catalog cache. A result is keyed by repository, session, host, and canonical
 * remote so stale authorization can never leak into a newly opened workspace.
 */
export function useCurrentRepositoryCloudContext({
  activeCloudSession,
  activeGitStatus,
  cloudEnabled,
  desktopCloudApiBaseUrl,
  resolutionInputsLoading,
  refreshKey = 0,
  updateCloudSession,
  workspace,
}: {
  activeCloudSession: DesktopCloudSession | null;
  activeGitStatus: GitStatusSnapshot | null;
  cloudEnabled: boolean;
  desktopCloudApiBaseUrl: string | null;
  resolutionInputsLoading: boolean;
  refreshKey?: number;
  updateCloudSession: (session: DesktopCloudSession | null) => void;
  workspace: Workspace | null;
}): ProjectCloudContext {
  const nextKey = useMemo(() => (
    workspace
      ? createWorkspaceCloudResolutionKey({
          activeCloudSession,
          activeGitStatus,
          desktopCloudApiBaseUrl,
          workspace,
        })
      : null
  ), [activeCloudSession, activeGitStatus, desktopCloudApiBaseUrl, workspace]);
  const [result, setResult] = useState<ResolutionResult>({
    key: null,
    context: { status: "local-only", projectId: null },
  });
  const snapshotRef = useRef<ResolutionSnapshot | null>(null);

  if (!workspace || !nextKey) {
    snapshotRef.current = null;
  } else if (snapshotRef.current?.key !== nextKey) {
    snapshotRef.current = {
      key: nextKey,
      activeCloudSession,
      activeGitStatus,
      desktopCloudApiBaseUrl,
      workspace,
    };
  }
  const snapshot = snapshotRef.current;

  useEffect(() => {
    if (!snapshot || !cloudEnabled) {
      setResult({
        key: snapshot?.key ?? null,
        context: { status: "local-only", projectId: null },
      });
      return undefined;
    }

    const {
      activeCloudSession: session,
      activeGitStatus: status,
      desktopCloudApiBaseUrl: apiBaseUrlOverride,
      key,
    } = snapshot;
    const remoteResolution = resolveCanonicalPuppyoneRemotes(status);
    const apiBaseUrl = apiBaseUrlOverride ?? session?.api_base_url ?? null;
    let cancelled = false;
    const apply = (context: ProjectCloudContext) => {
      if (!cancelled) setResult({ key, context });
    };

    if (resolutionInputsLoading) {
      apply({ status: "resolving", projectId: null });
      return () => { cancelled = true; };
    }
    if (remoteResolution.status === "none") {
      apply({ status: "local-only", projectId: null });
      return () => { cancelled = true; };
    }
    if (remoteResolution.status === "conflict") {
      apply({
        status: "locator-conflict",
        projectId: null,
        message: cloudMessage(
          "remote-locator-conflict",
          undefined,
          describePuppyoneRemoteCandidates(remoteResolution.candidates),
        ),
      });
      return () => { cancelled = true; };
    }

    const cloudRemote = remoteResolution;
    const candidateProjectId = cloudRemote.info.projectId ?? null;
    if (!isTrustedCloudGitOrigin(cloudRemote.rawUrl, apiBaseUrl)) {
      apply({
        status: "wrong-host",
        projectId: candidateProjectId,
        message: cloudMessage("remote-wrong-host", { origin: cloudRemote.info.origin }),
      });
      return () => { cancelled = true; };
    }
    if (!session) {
      apply({
        status: "wrong-account",
        projectId: candidateProjectId,
        message: cloudMessage("remote-sign-in"),
      });
      return () => { cancelled = true; };
    }

    apply({ status: "resolving", projectId: null });

    const onFailure = (error: unknown) => {
      if (cancelled) return;
      if (errorCode(error) === "SESSION_CHANGED") {
        // The session callback changes `session_generation`, which produces a
        // fresh resolution key and effect. Never retry with this stale session
        // snapshot: doing so can create an unbounded request loop.
        apply({ status: "resolving", projectId: null });
        return;
      }

      const statusCode = errorStatus(error);
      const detail = error instanceof Error ? error.message : String(error);
      if (statusCode === 401) {
        apply({
          status: "wrong-account",
          projectId: candidateProjectId,
          message: cloudMessage("remote-sign-in"),
        });
      } else if (statusCode === 403) {
        apply({
          status: "not-authorized",
          projectId: candidateProjectId,
          message: cloudMessage("remote-not-authorized"),
        });
      } else if (statusCode === 404) {
        apply({
          status: "not-found",
          projectId: candidateProjectId,
          message: cloudMessage("remote-not-found"),
        });
      } else if (isRetryableCloudFailure(statusCode)) {
        apply({
          status: "temporarily-unavailable",
          projectId: candidateProjectId,
          message: cloudMessage("remote-network-failed", undefined, detail),
        });
      } else {
        apply({
          status: "unresolvable",
          projectId: null,
          message: cloudMessage("remote-unresolvable", undefined, detail),
        });
      }
    };

    const resolveCanonical = async () => {
      const target = cloudRemote.info.kind === "scope"
        ? {
            kind: "scope" as const,
            project_id: cloudRemote.info.projectId as string,
            scope_id: cloudRemote.info.scopeId as string,
          }
        : {
            kind: "project_root" as const,
            project_id: cloudRemote.info.projectId as string,
          };
      const context = await getCloudRepositoryContext(
        session,
        cloudRemote.info.projectId as string,
        target,
        updateCloudSession,
        apiBaseUrlOverride,
      );
      if (!contextMatchesRemote(cloudRemote, context)) {
        apply({
          status: "locator-conflict",
          projectId: candidateProjectId,
          message: cloudMessage("remote-response-mismatch"),
        });
        return;
      }
      apply({
        status: "resolved",
        projectId: context.project.id,
        ...(context.project.name?.trim() ? { projectName: context.project.name.trim() } : {}),
        target: context.target,
        ...(context.scope_path ? { scopePath: context.scope_path } : {}),
        ...(context.project.capabilities?.length
          ? { capabilities: context.project.capabilities }
          : {}),
      });
    };

    void resolveCanonical().catch(onFailure);
    return () => { cancelled = true; };
  }, [cloudEnabled, refreshKey, resolutionInputsLoading, snapshot, updateCloudSession]);

  if (!workspace || !cloudEnabled) {
    return { status: "local-only", projectId: null };
  }
  if (result.key === nextKey) return result.context;

  const remoteResolution = resolveCanonicalPuppyoneRemotes(activeGitStatus);
  if (!resolutionInputsLoading && remoteResolution.status === "none") {
    return { status: "local-only", projectId: null };
  }
  return { status: "resolving", projectId: null };
}
