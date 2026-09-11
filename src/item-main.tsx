import "./styles/cascade.css";
import "./cloud-globals.css";
import "./styles.css";
import "./features/app-shell/auxiliary-workbench/host/renderer.css";
import { Component, Suspense, lazy, useEffect, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { LocalizationProvider } from "@puppyone/localization/react";
import { bootstrapRendererLocalization } from "./localization";
import { ScrollbarActivity } from "./components/ScrollbarActivity";
import type { ItemHostAppearance, ItemHostConfiguration } from "../shared/item-host-contract/types";
import "./features/app-shell/auxiliary-workbench/host/displayPorts";
import { loadTerminalItemRenderer } from "./features/desktop-terminal";
import { loadAgentItemRenderer } from "./features/desktop-agent/lazy";

const Terminal = lazy(loadTerminalItemRenderer);
const Agent = lazy(loadAgentItemRenderer);
const bridge = window.puppyoneItemHost!;
const bootstrap = await bridge.bootstrap();
const localization = await bootstrapRendererLocalization();
applyAppearance(bootstrap.appearance);

class ItemRenderBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { bridge.publish("display-error", "This item's content could not be rendered."); }
  render() { return this.state.failed ? null : this.props.children; }
}

function ItemRenderer() {
  const [configuration, setConfiguration] = useState<ItemHostConfiguration>(bootstrap);
  useEffect(() => bridge.onConfiguration((next) => { applyAppearance(next.appearance); setConfiguration(next); }), []);
  const Content = bootstrap.kind === "terminal" ? Terminal : Agent;
  return <div className="desktop-item-renderer">
    <Suspense fallback={null}><Content bootstrap={bootstrap} configuration={configuration} /></Suspense>
  </div>;
}

function applyAppearance(appearance?: ItemHostAppearance) {
  if (!appearance) return;
  const root = document.documentElement;
  root.classList.toggle("dark", appearance.dark);
  root.dir = appearance.direction;
  for (const [name, value] of Object.entries(appearance.attributes)) if (/^data-[a-z0-9-]+$/.test(name)) root.setAttribute(name, value);
  for (const [name, value] of Object.entries(appearance.variables)) if (/^--po-[a-z0-9-]+$/.test(name)) root.style.setProperty(name, value);
}

createRoot(document.getElementById("root")!).render(
  <LocalizationProvider initialState={localization.state} initialCatalog={localization.catalog}
    fallbackCatalog={localization.fallbackCatalog} loadCatalog={localization.loadCatalog} client={localization.client}>
    <ItemRenderBoundary><ScrollbarActivity /><ItemRenderer /></ItemRenderBoundary>
  </LocalizationProvider>,
);
