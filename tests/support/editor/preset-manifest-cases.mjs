import { readFileSync } from "node:fs";

export const canonicalManifest = JSON.parse(readFileSync(new URL("../../../packages/shared-ui/src/editor/registry/presetViewerManifest.json", import.meta.url), "utf8"));
const fallback = canonicalManifest.viewers.find(({ id }) => id === canonicalManifest.fallbackViewerId);
const base = {
  id: "fixture-viewer", formatViewerIds: ["fixture-alias"], capability: "preview", source: "content",
  runtime: "eager", surfaceIsolation: "inline", computeIsolation: "main-thread", contentSandbox: "none",
  resourcePolicy: { memoryClass: "small", maxSourceBytes: 10, maxCanvasPixels: 0, maxActiveCanvases: 0, maxWorkers: 0 },
  recoveryPolicy: { maxAutomaticRetries: 0, supportsSafeMode: false }, surfacePreparation: "hidden-safe",
  readinessSignal: "dom-stable", surfaceFamily: "document", surfaceTraits: [],
};
const manifest = () => structuredClone({ contractVersion: 8, fallbackViewerId: fallback.id, viewers: [base, fallback] });
const change = (name, edit) => {
  const input = manifest();
  edit(input.viewers[0], input);
  return [name, input];
};
export const manifestCases = [
  ["canonical", canonicalManifest], ["minimal", manifest()],
  ...[null, [], "invalid"].map((input) => [`manifest ${JSON.stringify(input)}`, input]),
  change("unknown manifest fields", (_, input) => { input.first = true; input.second = true; }),
  change("version", (_, input) => { input.contractVersion = 7; }),
  change("fallback id", (_, input) => { input.fallbackViewerId = "Bad ID"; }),
  change("empty viewers", (_, input) => { input.viewers = []; }),
  change("missing viewers", (_, input) => { delete input.viewers; }),
  ...[null, [], "invalid"].map((value) => change(`definition ${JSON.stringify(value)}`, (_, input) => { input.viewers[0] = value; })),
  change("unknown definition fields", (viewer) => { viewer.first = true; viewer.second = true; }),
  change("invalid id", (viewer) => { viewer.id = "Bad ID"; }),
  change("duplicate canonical id", (viewer, input) => { input.viewers.push(structuredClone(viewer)); }),
  change("alias equals canonical id", (viewer) => { viewer.formatViewerIds = [viewer.id]; }),
  change("alias collides with fallback", (viewer) => { viewer.formatViewerIds = [fallback.id]; }),
  change("fallback missing", (_, input) => { input.fallbackViewerId = "missing"; }),
  change("fallback not placeholder", (_, input) => { input.fallbackViewerId = base.id; }),
  change("multiple placeholders", (viewer) => { viewer.capability = "placeholder"; viewer.source = "none"; viewer.resourcePolicy.maxSourceBytes = 0; }),
];
for (const key of Object.keys(base)) {
  manifestCases.push(change(`missing ${key}`, (viewer) => { delete viewer[key]; }));
}
for (const key of ["capability", "source", "runtime", "surfaceIsolation", "computeIsolation", "contentSandbox", "surfacePreparation", "readinessSignal", "surfaceFamily"]) {
  manifestCases.push(change(`invalid ${key}`, (viewer) => { viewer[key] = "invalid"; }));
}
for (const key of ["formatViewerIds", "surfaceTraits"]) {
  for (const value of [null, "invalid", [null], ["Bad ID"], key === "surfaceTraits" ? ["scrollable", "scrollable"] : ["alias", "alias"]]) {
    manifestCases.push(change(`${key} ${JSON.stringify(value)}`, (viewer) => { viewer[key] = value; }));
  }
}
for (const key of ["resourcePolicy", "recoveryPolicy"]) {
  manifestCases.push(change(`${key} unknown field`, (viewer) => { viewer[key].extra = true; }));
  manifestCases.push(change(`${key} array`, (viewer) => { viewer[key] = []; }));
}
manifestCases.push(change("memory class", (viewer) => { viewer.resourcePolicy.memoryClass = "invalid"; }));
for (const key of ["maxSourceBytes", "maxCanvasPixels", "maxActiveCanvases", "maxWorkers"]) {
  for (const value of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, "1"]) {
    manifestCases.push(change(`${key} ${value}`, (viewer) => { viewer.resourcePolicy[key] = value; }));
  }
}
for (const value of [-1, 2, 0.5, "1"]) {
  manifestCases.push(change(`retry ${value}`, (viewer) => { viewer.recoveryPolicy.maxAutomaticRetries = value; }));
}
manifestCases.push(change("safe mode boolean", (viewer) => { viewer.recoveryPolicy.supportsSafeMode = 1; }));
for (const [name, changes] of [
  ["edit without source", { capability: "edit", source: "none" }],
  ["preview without source", { source: "none" }],
  ["placeholder with source", { capability: "placeholder" }],
  ["metadata byte budget", { capability: "placeholder", source: "none" }],
  ["worker without budget", { computeIsolation: "worker" }],
  ["browser source", { computeIsolation: "browser-engine" }],
  ["browser lazy", { computeIsolation: "browser-engine", source: "resource", runtime: "lazy" }],
  ["native source mismatch", { computeIsolation: "native-process" }],
  ["native compute mismatch", { source: "resource-session" }],
  ["sandbox without trait", { contentSandbox: "sandboxed-frame" }],
  ["trait without sandbox", { surfaceTraits: ["sandboxed"] }],
  ["canvas without budget", { surfaceFamily: "canvas" }],
  ["paginated without budget", { surfaceTraits: ["paginated"] }],
  ["grid pagination allowed", { surfaceFamily: "grid", surfaceTraits: ["paginated"] }],
]) manifestCases.push(change(name, (viewer) => { Object.assign(viewer, changes); }));
manifestCases.push(
  change("zero source budget", (v) => { v.resourcePolicy.maxSourceBytes = 0; }),
  change("main thread worker budget", (v) => { v.resourcePolicy.maxWorkers = 1; }),
  change("worker eager", (v) => { v.computeIsolation = "worker"; v.resourcePolicy.maxWorkers = 1; }),
  change("safe mode requires isolated surface", (v) => { v.recoveryPolicy.supportsSafeMode = true; }),
  change("valid worker", (v) => { v.computeIsolation = "worker"; v.runtime = "lazy"; v.resourcePolicy.maxWorkers = 1; }),
  change("valid sandbox", (v) => { v.contentSandbox = "sandboxed-frame"; v.surfaceTraits = ["sandboxed"]; }),
  change("valid safe mode", (v) => { v.surfaceIsolation = "isolated-webcontents"; v.recoveryPolicy.supportsSafeMode = true; }),
  change("first validation error wins", (v) => { v.formatViewerIds = null; v.source = "invalid"; v.resourcePolicy = null; }),
);
for (const key of ["maxWorkers", "maxCanvasPixels", "maxActiveCanvases"]) {
  manifestCases.push(change(`browser ${key}`, (v) => { v.computeIsolation = "browser-engine"; v.source = "resource"; v.resourcePolicy[key] = 1; }));
}
const native = (v) => Object.assign(v, { source: "resource-session", computeIsolation: "native-process", capability: "preview", runtime: "lazy", surfaceIsolation: "inline" });
manifestCases.push(change("valid native", native));
for (const [key, value] of [["capability", "edit"], ["runtime", "eager"], ["surfaceIsolation", "isolated-webcontents"]]) {
  manifestCases.push(change(`native ${key}`, (v) => { native(v); v[key] = value; }));
}
for (const key of ["maxWorkers", "maxCanvasPixels", "maxActiveCanvases"]) {
  manifestCases.push(change(`native ${key}`, (v) => { native(v); v.resourcePolicy[key] = 1; }));
}
