import type { PresetViewerContribution } from "./viewerTypes";

export type EditorProviderPolicy = Readonly<{
  profile: "editable-document" | "readonly-preview" | "app-runtime";
  sourceToggle: boolean;
  resourceDependencies?: "document-directory";
  semanticInputs: readonly ("link-graph" | "asset-resolver")[];
}>;

export function normalizeEditorProviderPolicy(viewer: PresetViewerContribution): EditorProviderPolicy {
  const expected = viewer.capability === "edit" ? "editable-document"
    : viewer.source === "none" && viewer.capability === "preview" ? "app-runtime" : "readonly-preview";
  const policy = viewer.providerPolicy ?? { profile: expected, sourceToggle: false, semanticInputs: [] };
  if (policy.profile !== expected || typeof policy.sourceToggle !== "boolean"
    || !Array.isArray(policy.semanticInputs)
    || policy.semanticInputs.some((input) => input !== "link-graph" && input !== "asset-resolver")
    || (policy.resourceDependencies !== undefined && policy.resourceDependencies !== "document-directory")
    || Object.keys(policy).some((key) => !["profile", "sourceToggle", "semanticInputs", "resourceDependencies"].includes(key))) {
    throw new TypeError(`Viewer ${viewer.id} has an invalid provider lifecycle policy.`);
  }
  if (policy.sourceToggle && expected !== "editable-document") throw new TypeError("A read-only provider cannot expose an editable source toggle.");
  return Object.freeze({ ...policy, semanticInputs: Object.freeze([...policy.semanticInputs]) });
}
