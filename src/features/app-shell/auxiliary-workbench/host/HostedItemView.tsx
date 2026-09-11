import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { RotateCw } from "lucide-react";
import { useLocalization } from "@puppyone/localization/react";
import type { ItemHostAppearance, ItemHostEvent } from "../../../../../shared/item-host-contract/types";
import { useNativeSurfaceGeometry, type NativeSurfaceGeometry } from "../../../native-surfaces";
import type { AuxiliaryWorkbenchItemRenderContext } from "../types";
import { projectItemHosts } from "./HostedItemPool";
import "./item-host.css";

export function HostedItemView({ project, item, presentation, onPresentationChange, settings, onEvent }: AuxiliaryWorkbenchItemRenderContext & {
  settings?: Record<string, unknown>;
  onEvent?: (event: ItemHostEvent) => void;
}) {
  const host = projectItemHosts(project).get(item.id);
  if (!host) throw new Error("The workbench item has no isolated host.");
  const { t, direction } = useLocalization();
  const state = useSyncExternalStore(host.subscribe, host.getSnapshot);
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [recovering, setRecovering] = useState(false);
  const latest = useRef({ settings, presentation, onEvent });
  latest.current = { settings, presentation, onEvent };
  const geometry = useRef<NativeSurfaceGeometry | null>(null);
  const geometrySequence = useRef(0);
  const publishGeometry = useCallback((next: NativeSurfaceGeometry) => {
    geometry.current = next;
    host.bridge.setGeometry({ ...host.identity, ...next, revision: ++geometrySequence.current,
      visible: next.visible && latest.current.presentation.presented });
  }, [host]);
  useNativeSurfaceGeometry(element, publishGeometry);
  useEffect(() => {
    if (geometry.current) publishGeometry(geometry.current);
  }, [presentation.presented, state.generation, publishGeometry]);
  useEffect(() => {
    if (presentation.commandTarget && presentation.presented) host.bridge.focus(host.identity);
  }, [host, presentation.commandTarget, presentation.presented, state.generation]);
  useEffect(() => {
    const listener = (event: ItemHostEvent) => latest.current.onEvent?.(event);
    host.eventListeners.add(listener);
    return () => { host.eventListeners.delete(listener); };
  }, [host]);
  useEffect(() => {
    if (host.summary) onPresentationChange({ ...host.summary, displayHealth: state.display, executionHealth: state.execution });
  }, [host, state, onPresentationChange]);
  const configure = useCallback(() => {
    const current = latest.current;
    return host.configure({ settings: current.settings, presented: current.presentation.presented,
      commandTarget: current.presentation.commandTarget, appearance: readItemAppearance(element, direction) });
  }, [direction, element, host]);
  useEffect(() => { void configure().catch((error: Error) => setFailure(error.message)); }, [configure, settings, presentation.presented, presentation.commandTarget]);
  useEffect(() => {
    let frame: number | null = null;
    const refresh = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => { frame = null; void configure().catch(() => {}); });
    };
    const observer = new MutationObserver(refresh);
    observer.observe(document.documentElement, { attributes: true });
    const sidebar = element?.closest(".desktop-right-sidebar");
    if (sidebar) observer.observe(sidebar, { attributes: true });
    return () => { observer.disconnect(); if (frame !== null) cancelAnimationFrame(frame); };
  }, [configure, element]);
  useEffect(() => () => {
    if (geometry.current && !project.disposed) host.bridge.setGeometry({ ...host.identity, ...geometry.current,
      revision: ++geometrySequence.current, visible: false });
  }, [host, project]);
  const failed = state.display === "crashed" || state.display === "unresponsive" || state.execution === "interrupted";
  return <div ref={setElement} className="desktop-item-host" data-item-id={item.id}>
    {(failed || failure) && <div className="desktop-item-host-failure" role="alert">
      <p>{failure ?? state.message}</p>
      {state.execution !== "interrupted" && <button type="button" className="desktop-item-host-retry" disabled={recovering}
        title={t("common.action.retry")} aria-label={t("common.action.retry")} onClick={() => {
          setRecovering(true); setFailure(null);
          void host.recover().catch((error: Error) => setFailure(error.message)).finally(() => setRecovering(false));
        }}><RotateCw size={16} /></button>}
    </div>}
  </div>;
}

function readItemAppearance(element: HTMLElement | null, direction: string): ItemHostAppearance {
  const root = document.documentElement;
  const source = element?.closest(".desktop-right-sidebar") ?? element ?? root;
  const style = getComputedStyle(source);
  const variables: Record<string, string> = {};
  for (const name of Array.from(style)) {
    if (name.startsWith("--po-") && Object.keys(variables).length < 600) variables[name] = style.getPropertyValue(name).trim();
  }
  const attributes = Object.fromEntries(root.getAttributeNames().filter((name) => name.startsWith("data-"))
    .slice(0, 80).map((name) => [name, root.getAttribute(name)!]));
  return { dark: root.classList.contains("dark"), direction: direction === "rtl" ? "rtl" : "ltr", attributes, variables };
}
