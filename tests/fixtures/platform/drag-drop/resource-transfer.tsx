import { canonicalizeResourceUri, createWorkspaceFolder, EXPLORER_REFERENCE_DRAG_TYPE, serializeExplorerReferenceDrag, type DataNode } from "@puppyone/shared-ui";
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { useResourceDragExport } from "../../../../src/features/data-workspace/useResourceDragExport";
import { resolveResourceDropSource } from "../../../../src/platform/resourceDragSession";
import { requireResourceSmokeBridge } from "./resourceSmoke";

const { workspacePath } = await window.resourceSmoke.config();
const folder = createWorkspaceFolder({ id: "smoke-root", name: "Native drag smoke", path: workspacePath, status: "recording" });
const rootUri = canonicalizeResourceUri("puppyone-local://workspace/smoke-root");
const file: DataNode = { id: "file", path: `${rootUri}/docs/%E4%B8%AD%E6%96%87%20file.md`, name: "中文 file.md", type: "file", source: "local" };
const directory: DataNode = { id: "directory", path: `${rootUri}/docs`, name: "docs", type: "folder", source: "local" };
const mode = new URL(location.href).searchParams.get("mode");
function Harness() {
  const [result, setResult] = useState("Drop here");
  useEffect(() => {
    const record = (event: DragEvent) => window.resourceSmoke.record({ mode, event: event.type, x: event.clientX, y: event.clientY, related: Boolean(event.relatedTarget) });
    for (const type of ["dragstart", "dragend", "drop"] as const) window.addEventListener(type, record, true);
    return () => { for (const type of ["dragstart", "dragend", "drop"] as const) window.removeEventListener(type, record, true); };
  }, []);
  const exportNodes = useResourceDragExport((resource) => ({ folder, resourceUri: canonicalizeResourceUri(resource), providerPath: resource === directory.path ? "docs" : "docs/中文 file.md" }));
  const receive = (event: React.DragEvent<HTMLElement>) => {
    event.preventDefault();
    const entry = { mode, types: [...event.dataTransfer.types], text: event.dataTransfer.getData("text/plain"), internal: event.dataTransfer.getData(EXPLORER_REFERENCE_DRAG_TYPE), files: [...event.dataTransfer.files].map((file) => ({ name: file.name, path: requireResourceSmokeBridge().getPathForFile(file) })) };
    window.resourceSmoke.record(entry);
    void resolveResourceDropSource({kind: "files", files: [...event.dataTransfer.files]}, "agent-reference").then((source) => {
      window.resourceSmoke.record({ claimed: source });
    }).catch((error) => window.resourceSmoke.record({ claimError: String(error) }));
    setResult(JSON.stringify(entry, null, 2));
  };
  return <main style={{ padding: 24, font: "16px system-ui" }}>
    <h2>{mode === "source" ? "Drag source" : "Native file receiver"}</h2>
    {mode === "source" && [[file], [directory], [file, directory]].map((nodes, index) => <div key={index}
      draggable onDragStart={(event) => {
        event.dataTransfer.setData(EXPLORER_REFERENCE_DRAG_TYPE, serializeExplorerReferenceDrag("smoke-workbench", nodes));
        exportNodes(nodes, event);
      }} style={{ padding: 18, marginBlock: 12, background: "#ddd", borderRadius: 6 }}>
      {index === 0 ? "File: 中文 file.md" : index === 1 ? "Directory: docs" : "Multiple entries"}
    </div>)}
    <pre onDragOver={(event) => event.preventDefault()} onDrop={receive} style={{ minHeight: mode === "source" ? 60 : 300, background: "#eef3ff", padding: 12, whiteSpace: "pre-wrap", fontSize: 12 }}>{result}</pre>
  </main>;
}
createRoot(document.getElementById("root")!).render(<Harness />);
