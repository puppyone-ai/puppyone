import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { useLocalization } from "@puppyone/localization/react";
import type { ItemHostBootstrap, ItemHostConfiguration } from "../../../../shared/item-host-contract/types";
import { ItemRendererResources } from "../../app-shell/auxiliary-workbench/host/ItemRendererResources";
import { TerminalRuntimePool } from "../runtime/TerminalRuntimePool";
import { createHostedTerminalBridge } from "../runtime/hostedTerminalBridge";
import { readTerminalAppearance, type TerminalAppearance } from "../runtime/terminalAppearance";
import { DESKTOP_TERMINAL_LAUNCHERS } from "../model/terminalLaunchers";
import { presentTerminalSessionHeader } from "../model/terminalSessionHeader";
import { TerminalSessionView } from "../ui/TerminalSessionView";
import "../ui/desktop-terminal.css";

export function TerminalItemRenderer({ bootstrap, configuration }: { bootstrap: ItemHostBootstrap; configuration: ItemHostConfiguration }) {
  const { t } = useLocalization();
  const formatter = useRef(t);
  formatter.current = t;
  const entry = useMemo(() => {
    const project = new ItemRendererResources(bootstrap.projectContext);
    const bridge = createHostedTerminalBridge(bootstrap);
    const pool = new TerminalRuntimePool(project, (...args) => formatter.current(...args), bridge);
    const launcher = DESKTOP_TERMINAL_LAUNCHERS.find((item) => item.id === bootstrap.recipeId);
    if (!launcher) throw new Error("Unknown terminal launcher.");
    return pool.ensure(bootstrap.itemId, launcher.id,
      bootstrap.settings?.terminalAppearance as TerminalAppearance ?? readTerminalAppearance(document.documentElement));
  }, [bootstrap]);
  const session = useSyncExternalStore((listener) => { entry.listeners.add(listener); return () => { entry.listeners.delete(listener); }; }, () => entry.session);
  useEffect(() => {
    entry.runtime.applyAppearance(configuration.settings?.terminalAppearance as TerminalAppearance ?? readTerminalAppearance(document.documentElement));
  }, [configuration, entry]);
  useEffect(() => {
    let timer: number | null = null;
    const publish = () => {
      if (timer !== null) return;
      timer = window.setTimeout(() => {
        timer = null;
        const header = presentTerminalSessionHeader(entry.session, bootstrap.projectContext.rootPath, t);
        window.puppyoneItemHost!.publish("summary", { snapshot: { title: header.pathLabel,
          accessibleLabel: header.accessibleLabel, detail: header.overflowDetail, iconKey: entry.session.launcherId,
          status: entry.session.status, running: entry.session.status === "running", resourceId: bootstrap.itemId },
          activity: entry.runtime.activity, minimumSize: entry.runtime.getMinimumViewportSize() });
      }, 100);
    };
    publish();
    const stop = entry.runtime.subscribeActivity(publish);
    return () => { stop(); if (timer !== null) clearTimeout(timer); };
  }, [bootstrap, entry, session, t]);
  useEffect(() => {
    void window.puppyoneItemHost!.ready();
    return () => entry.runtime.dispose();
  }, [entry]);
  return <div className="desktop-terminal-session-host-content">
    <TerminalSessionView runtime={entry.runtime} workspacePath={bootstrap.projectContext.rootPath}
      presented={configuration.presented === true} focused={configuration.commandTarget === true} />
    {session.launchError && <div className="desktop-terminal-drop-error" role="alert">{session.launchError}</div>}
  </div>;
}
