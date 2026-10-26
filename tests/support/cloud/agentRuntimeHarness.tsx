import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { LocalizationProvider } from "@puppyone/localization/react";
import { bootstrapRendererLocalization } from "../../../src/localization";
import { CloudAgentSidebar } from "../../../src/features/cloud/agent/CloudAgentSidebar";
import { AuxiliaryWorkbenchPanel } from "../../../src/features/app-shell/auxiliary-workbench/AuxiliaryWorkbenchPanel";
import { useCloudAgentWorkspace } from "../../../src/features/cloud/agent/useCloudAgentWorkspace";
import "../../../src/styles/cascade.css";
import "../../../src/styles.css";
import "../../../src/features/desktop-agent/ui/desktop-agent.css";

const config = await (window as any).agentAcceptance.configuration();
const { session } = await window.puppyoneDesktop!.readCloudAuthState();
const localization = await bootstrapRendererLocalization();
function Harness() {
  const [active, setActive] = useState(true);
  const agent = useCloudAgentWorkspace({ context: { status: "resolved", projectId: config.project,
    target: { kind: "project_root", project_id: config.project }, capabilities: ["content.read"] },
    session, apiBaseUrl: config.api, active, onPublication: () => {} });
  (window as any).agentIntegration = { state: () => ({ ...agent.state, active, open: agent.open }) };
  return <main style={{ height: "100vh", width: 620 }}>
    <nav><button data-test-location="local" onClick={() => setActive(false)}>Local</button>
      <button data-test-location="cloud" onClick={() => setActive(true)}>Cloud</button>
      <button data-test-open-agent onClick={() => agent.toggle?.()}>Puppyone Agent</button></nav>
    {active && agent.open && agent.workbench && <CloudAgentSidebar workbench={agent.workbench} active Panel={AuxiliaryWorkbenchPanel} />}
  </main>;
}
createRoot(document.getElementById("root")!).render(<LocalizationProvider initialState={localization.state}
  initialCatalog={localization.catalog} fallbackCatalog={localization.fallbackCatalog}
  loadCatalog={localization.loadCatalog} client={localization.client}><Harness /></LocalizationProvider>);
