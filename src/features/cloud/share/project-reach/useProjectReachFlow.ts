import { useCallback, useEffect, useRef, useState } from "react";
import {
  createCloudMcpEndpoint,
  createCloudScope,
  listCloudScopes,
  type DesktopCloudMcpEndpoint,
  type DesktopCloudSession,
} from "../../../../lib/cloudApi";
import { getWorkspaceGitStatus } from "../../../../lib/localFiles";
import type {
  CloudInitializationErrorCode,
  CloudPublishProgressStage,
} from "../../../../types/electron";
import type { CloudMessageDescriptor } from "../../cloudPresentation";
import type { CloudPublishAccountStep } from "../../initialization/CloudPublishProgressIndicator";
import {
  isIdentityDeferredPreparation,
  prepareWorkspaceForPublish,
  type PublishPreparationStage,
} from "../../initialization/publishPreparation";
import type { CloudInitializationFailure } from "../../initialization/useCloudInitialization";
import {
  getCloudContextWarning,
  type ProjectCloudContext,
} from "../../project/context/projectCloudContext";
import {
  resolveReachAccountStep,
  resolveReachStage,
  type ReachPhase,
  type ReachScope,
} from "./projectReach";
import type { ShareWizardPublishController } from "../ShareWizardDialog";
import type { ShareTarget } from "../shareTargets";
import type { ProjectSharesState } from "../useProjectShares";

export type ReachIssue = Readonly<{
  /** `null` for a link, which needs no credential of its own. */
  endpoint: DesktopCloudMcpEndpoint | null;
  issuedAt: string;
  /** The destination already had this exact reach, so nothing new was minted. */
  reused: boolean;
}>;

export type ReachFailure =
  | Readonly<{ kind: "preparation"; code: CloudInitializationErrorCode }>
  | Readonly<{ kind: "publish"; failure: CloudInitializationFailure }>
  | Readonly<{ kind: "blocked"; message: CloudMessageDescriptor | null }>
  | Readonly<{ kind: "issue" }>;

export type ProjectReachFlow = Readonly<{
  phase: ReachPhase;
  stage: CloudPublishProgressStage;
  account: CloudPublishAccountStep;
  issue: ReachIssue | null;
  failure: ReachFailure | null;
  /** The publish needs an owner and the screen has not resolved one yet. */
  needsOrganization: boolean;
  selectOrganization: (organizationId: string) => void;
  start: () => void;
  retry: () => void;
}>;

/**
 * One continuous task, in the order the user experiences it: do everything
 * that needs nobody's identity, then ask for the account as a step of the same
 * progress list, then make the destination reachable.
 *
 * The order is the point. Preparation touches only this Mac, so abandoning the
 * screen at the account step leaves a folder with version history and nothing
 * in Cloud to clean up. Preparation also repeats harmlessly, so picking the
 * task up later continues instead of starting over.
 */
export function useProjectReachFlow({
  workspacePath,
  session,
  apiBaseUrl,
  projectContext,
  publish,
  shares,
  target,
  targetLabel,
  scope,
  onIssued,
  onSessionChange,
}: {
  workspacePath: string | null;
  session: DesktopCloudSession | null;
  apiBaseUrl: string | null;
  projectContext: ProjectCloudContext;
  publish: ShareWizardPublishController;
  shares: ProjectSharesState;
  target: ShareTarget | null;
  /** Stored as the destination's name, so the readers list names it the way the screen did. */
  targetLabel: string;
  scope: ReachScope;
  onIssued: (issue: ReachIssue, target: ShareTarget) => void;
  onSessionChange: (session: DesktopCloudSession | null) => void;
}): ProjectReachFlow {
  const [phase, setPhase] = useState<ReachPhase>("form");
  const [localStage, setLocalStage] = useState<PublishPreparationStage | null>(null);
  const [failure, setFailure] = useState<ReachFailure | null>(null);
  const [issue, setIssue] = useState<ReachIssue | null>(null);
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const publishRequested = useRef(false);
  const latest = useRef({ session, apiBaseUrl, shares, onSessionChange, publish, projectContext, onIssued });
  latest.current = { session, apiBaseUrl, shares, onSessionChange, publish, projectContext, onIssued };

  const signedIn = session !== null;
  const contextStatus = projectContext.status;
  const projectId = projectContext.status === "resolved" ? projectContext.projectId : null;
  const sharesSettled = shares.loaded || shares.error;

  const fail = useCallback((next: ReachFailure) => {
    setFailure(next);
    setPhase("failed");
  }, []);

  const start = useCallback(() => {
    setFailure(null);
    setLocalStage(null);
    setPhase("preparing");
  }, []);

  const retry = useCallback(() => {
    publishRequested.current = false;
    setFailure(null);
    setPhase("preparing");
  }, []);

  // Everything that needs no account: version history, a first snapshot and a
  // branch to send. A missing identity is not a failure here; the publish will
  // supply one after the account step.
  useEffect(() => {
    if (phase !== "preparing") return undefined;
    let cancelled = false;
    const run = async () => {
      const status = workspacePath ? await getWorkspaceGitStatus(workspacePath).catch(() => null) : null;
      if (cancelled) return;
      if (workspacePath && status) {
        const prepared = await prepareWorkspaceForPublish({
          rootPath: workspacePath,
          status,
          onStage: (stage) => {
            if (!cancelled) setLocalStage(stage);
          },
        });
        if (cancelled) return;
        if (!prepared.ok && !isIdentityDeferredPreparation(prepared.code)) {
          fail({ kind: "preparation", code: prepared.code });
          return;
        }
      }
      setPhase(latest.current.session ? "publishing" : "account");
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [fail, phase, workspacePath]);

  useEffect(() => {
    if (phase === "account" && signedIn) setPhase("publishing");
  }, [phase, signedIn]);

  // The project's own Cloud state decides what is left: nothing, a publish, or
  // a reason the screen cannot continue.
  useEffect(() => {
    if (phase !== "publishing") return;
    if (contextStatus === "resolved") {
      setPhase("issuing");
      return;
    }
    if (contextStatus === "resolving") return;
    if (contextStatus === "local-only") {
      if (publishRequested.current || !organizationId) return;
      publishRequested.current = true;
      void latest.current.publish.start(organizationId, { navigateToCloud: false });
      return;
    }
    fail({ kind: "blocked", message: getCloudContextWarning(latest.current.projectContext) });
  }, [contextStatus, fail, organizationId, phase]);

  useEffect(() => {
    if (phase !== "publishing" || !publish.error || !publishRequested.current) return;
    fail({ kind: "publish", failure: publish.error });
  }, [fail, phase, publish.error]);

  // Reuse the destination's existing reach when it is identical; a second key
  // for the same thing would leave the user unable to tell which is live.
  useEffect(() => {
    if (phase !== "issuing" || !projectId) return undefined;
    if (!target) return undefined;
    if (target.channel === "mcp" && !sharesSettled) return undefined;
    let cancelled = false;
    const settle = (next: ReachIssue) => {
      if (cancelled) return;
      setIssue(next);
      setPhase("ready");
      latest.current.onIssued(next, target);
    };
    const run = async () => {
      if (target.channel === "link") {
        settle({ endpoint: null, issuedAt: new Date().toISOString(), reused: false });
        return;
      }
      const existing = latest.current.shares.shares.find((share) => (
        share.path === scope.path && share.readonly === (scope.mode === "r") && share.status !== "disabled"
      ));
      if (existing) {
        settle({ endpoint: existing.endpoint, issuedAt: existing.createdAt ?? new Date().toISOString(), reused: true });
        return;
      }
      try {
        const endpoint = await issueProjectReach({
          session: latest.current.session,
          apiBaseUrl: latest.current.apiBaseUrl,
          onSessionChange: latest.current.onSessionChange,
          request: { projectId, scope, name: targetLabel },
        });
        if (cancelled) return;
        settle({ endpoint, issuedAt: new Date().toISOString(), reused: false });
        void latest.current.shares.reload();
      } catch {
        if (!cancelled) fail({ kind: "issue" });
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [fail, phase, projectId, scope, sharesSettled, target, targetLabel]);

  return {
    phase,
    stage: resolveReachStage({ phase, localStage, publishStage: publish.progress?.stage ?? null }),
    account: resolveReachAccountStep(phase),
    issue,
    failure,
    needsOrganization: phase === "publishing" && contextStatus === "local-only" && !organizationId,
    selectOrganization: setOrganizationId,
    start,
    retry,
  };
}

/**
 * Give the destination its own reach. A folder needs a named scope before an
 * endpoint can be limited to it, and an existing scope is reused so repeating
 * the screen does not accumulate duplicates of the same folder.
 */
async function issueProjectReach({
  session,
  apiBaseUrl,
  onSessionChange,
  request,
}: {
  session: DesktopCloudSession | null;
  apiBaseUrl: string | null;
  onSessionChange: (session: DesktopCloudSession | null) => void;
  request: Readonly<{ projectId: string; scope: ReachScope; name: string }>;
}): Promise<DesktopCloudMcpEndpoint> {
  if (!session) throw new Error("An account is required before a destination can reach a project.");
  const { projectId, scope, name } = request;
  if (scope.path) {
    const scopes = await listCloudScopes(session, projectId, onSessionChange, apiBaseUrl);
    if (!scopes.some((candidate) => candidate.path === scope.path)) {
      await createCloudScope(session, projectId, {
        name: scope.path.split("/").filter(Boolean).pop() ?? scope.path,
        path: scope.path,
        max_mode: scope.mode,
        exclude: [],
      }, onSessionChange, apiBaseUrl);
    }
  }
  return createCloudMcpEndpoint(session, {
    project_id: projectId,
    path: scope.path,
    name,
    accesses: [{ path: scope.path, json_path: "", readonly: scope.mode === "r" }],
  }, onSessionChange, apiBaseUrl);
}
