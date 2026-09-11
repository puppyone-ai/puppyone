import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ItemHostBootstrap, ItemHostConfiguration } from "../../../../shared/item-host-contract/types";
import type { AuxiliaryWorkbenchItemSnapshot } from "../../app-shell/auxiliary-workbench/types";
import { ItemRendererResources } from "../../app-shell/auxiliary-workbench/host/ItemRendererResources";
import { projectAgentControllers } from "../workbench/projectAgentControllers";
import { getElectronAgentClient, createProjectAgentClientProvider } from "../infrastructure/electron/electronAgentClient";
import { createHostedAgentClient } from "../infrastructure/electron/hostedAgentClient";
import { AgentChatWorkbenchItem } from "../workbench/AgentChatWorkbenchItem";
import type { AgentRoutePreference } from "../domain/agent-route-preference";
import type { AgentWorkspaceReferenceResolver } from "../ui/useAgentReferenceIngestion";

export function AgentItemRenderer({ bootstrap, configuration }: { bootstrap: ItemHostBootstrap; configuration: ItemHostConfiguration }) {
  const scope = useMemo(() => {
    const project = new ItemRendererResources(bootstrap.projectContext);
    const client = createHostedAgentClient(getElectronAgentClient()!, bootstrap);
    const registry = projectAgentControllers(project, {
      createClient: () => createProjectAgentClientProvider(bootstrap.projectContext, () => client), preserveDraftOnDispose: true,
    });
    return { project, controller: registry.get(bootstrap.itemId) };
  }, [bootstrap]);
  const [error, setError] = useState<string | null>(null);
  const [attached, setAttached] = useState(!bootstrap.session && !bootstrap.historyTarget);
  const { controller, project } = scope;
  const initialization = useRef<Promise<void> | null>(null);
  useEffect(() => {
    if (!initialization.current) initialization.current = (async () => {
      if (bootstrap.session) await controller.attachLiveSession(bootstrap.session.sessionId, bootstrap.session.runtimeId);
      else if (bootstrap.historyTarget) await controller.openSavedSession(bootstrap.historyTarget.sessionId, bootstrap.historyTarget.runtimeId);
      else if (bootstrap.recipeId) controller.beginInitializeForRuntime(bootstrap.recipeId);
      if (bootstrap.draft?.referenceEpoch) controller.restoreDisplayDraft({ text: bootstrap.draft.text,
        mentions: bootstrap.draft.mentions ?? [], references: bootstrap.draft.references ?? [], referenceEpoch: bootstrap.draft.referenceEpoch });
      setAttached(true);
      await window.puppyoneItemHost!.ready();
    })();
    void initialization.current.catch((failure: Error) => { setError(failure.message); window.puppyoneItemHost!.publish("display-error", failure.message); });
  }, [bootstrap, controller]);
  useEffect(() => {
    let revision = bootstrap.draft?.revision ?? 0;
    let previous = "";
    let failedValue = "";
    let timer: number | null = null;
    let writing = false;
    let disposed = false;
    const flush = async () => {
      timer = null;
      if (writing || disposed) return;
      writing = true;
      try {
        await initialization.current;
        if (disposed) return;
        const draft = controller.exportDisplayDraft();
        const value = JSON.stringify(draft);
        if (value === previous || value === failedValue) return;
        try { await window.puppyoneItemHost!.saveDraft({ ...draft, revision: ++revision }); previous = value; failedValue = ""; }
        catch (failure) { failedValue = value; throw failure; }
      } catch (failure) { if (!disposed) setError(failure instanceof Error ? failure.message : String(failure)); }
      finally { writing = false; }
      const next = JSON.stringify(controller.exportDisplayDraft());
      if (!disposed && next !== previous && next !== failedValue) timer = window.setTimeout(() => { void flush(); }, 500);
    };
    const stop = controller.subscribe(() => { if (timer === null && !writing) timer = window.setTimeout(() => { void flush(); }, 200); });
    return () => { disposed = true; stop(); if (timer !== null) clearTimeout(timer); };
  }, [bootstrap, controller]);
  useEffect(() => () => project.dispose(), [project]);
  const present = useCallback((snapshot: AuxiliaryWorkbenchItemSnapshot) => window.puppyoneItemHost!.publish("summary", { snapshot }), []);
  const resolveReference: AgentWorkspaceReferenceResolver = useCallback(async (resource: string) => {
    const value = await window.puppyoneItemHost!.request("resolve-reference", resource) as { workspaceRoot: string; referencePath: string; previewUrl?: string } | null;
    return value ? { ...value, loadVisualPreview: value.previewUrl ? async () => ({ url: value.previewUrl! }) : undefined } : null;
  }, []);
  const settings = configuration.settings ?? {};
  // The existing Chat UI may prewarm a new session. Mount it only after a
  // recovery/history replica has attached to its already-authorized session.
  if (!attached) return error ? <div role="alert" className="desktop-item-renderer-error">{error}</div> : null;
  return <>
    {error && <div role="alert" className="desktop-item-renderer-error">{error}</div>}
    <AgentChatWorkbenchItem project={project} item={{ id: bootstrap.itemId, kind: "agent", rootId: bootstrap.projectContext.rootPath, contextId: bootstrap.projectContext.projectId }}
      presentation={{ sidebarVisible: configuration.presented === true, presented: configuration.presented === true,
        commandTarget: configuration.commandTarget === true, domFocused: configuration.commandTarget === true }}
      onPresentationChange={present} hiddenRuntimeIds={settings.hiddenRuntimeIds as string[] ?? []}
      preferredModel={settings.preferredModel as string | null ?? null} preferredRuntimeId={settings.preferredRuntimeId as string | null ?? null}
      preferredRoute={settings.preferredRoute as AgentRoutePreference ?? {}}
      onOpenFile={(path) => window.puppyoneItemHost!.publish("open-file", path)}
      onPreferredModelChange={(model) => window.puppyoneItemHost!.publish("preferred-model", model)}
      onPreferredRuntimeChange={(runtime) => window.puppyoneItemHost!.publish("preferred-runtime", runtime)}
      onPreferredRouteChange={(route) => window.puppyoneItemHost!.publish("preferred-route", route)}
      resolveWorkspaceReference={resolveReference} />
  </>;
}
