import {
  canonicalizeResourcePath,
  isSameOrDescendantResourcePath,
  rebaseResourcePath,
} from "../../core/resourcePath";
import { isDataResourceUri, rebaseDataResourcePath } from "../../core/dataResourcePath";
import {
  ResourceUriIdentityService,
  canonicalizeResourceUri,
  createResourceUri,
  createWorkspaceResourceUri,
  getWorkspaceResourcePath,
  type ResourceUri,
} from "../../core/resourceUri";

export type EditorResourceDescriptor = Readonly<{
  rootUri: ResourceUri;
  /** Provider-relative path used to construct global Resource identity. */
  resourcePath: string;
  /** Host-facing routed path. Defaults to resourcePath for single-root hosts. */
  hostPath?: string;
}>;

export type EditorResourceReference = string | EditorResourceDescriptor;

export type EditorInput = Readonly<{
  id: string;
  /** Workspace-relative display/provider path retained for current host consumers. */
  resource: string;
  /** Global Root-aware resource identity. */
  resourceUri: ResourceUri;
  /** Null only for legacy callers that have not supplied a Workspace Folder. */
  rootUri: ResourceUri | null;
  label: string;
}>;

export type EditorGroupState = Readonly<{
  editors: readonly EditorInput[];
  activeEditorId: string | null;
  mostRecentlyUsed: readonly string[];
}>;

export const EMPTY_EDITOR_GROUP: EditorGroupState = Object.freeze({
  editors: Object.freeze([]),
  activeEditorId: null,
  mostRecentlyUsed: Object.freeze([]),
});

export function createEditorInput(
  resource: EditorResourceReference,
  label?: string,
): EditorInput {
  const identity = resolveEditorResource(resource);
  return Object.freeze({
    id: identity.id,
    resource: identity.resourcePath,
    resourceUri: identity.resourceUri,
    rootUri: identity.rootUri,
    label: label || basename(identity.resourcePath),
  });
}

export function openEditor(
  state: EditorGroupState,
  input: EditorInput,
  options: Readonly<{ preserveFocus?: boolean }> = {},
): EditorGroupState {
  const existingIndex = state.editors.findIndex((editor) => editor.id === input.id);
  const editors = existingIndex < 0
    ? insertAfterActive(state.editors, state.activeEditorId, input)
    : state.editors.map((editor, index) => index === existingIndex ? input : editor);
  if (options.preserveFocus) return freezeState(editors, state.activeEditorId, state.mostRecentlyUsed);
  return activateEditor({ ...state, editors }, input.id);
}

export function activateEditor(state: EditorGroupState, editorId: string): EditorGroupState {
  if (!state.editors.some((editor) => editor.id === editorId)) return state;
  if (state.activeEditorId === editorId && state.mostRecentlyUsed[0] === editorId) return state;
  return freezeState(
    state.editors,
    editorId,
    [editorId, ...state.mostRecentlyUsed.filter((id) => id !== editorId)],
  );
}

export function closeEditor(state: EditorGroupState, editorId: string): EditorGroupState {
  const closingIndex = state.editors.findIndex((editor) => editor.id === editorId);
  if (closingIndex < 0) return state;
  const editors = state.editors.filter((editor) => editor.id !== editorId);
  const mru = state.mostRecentlyUsed.filter((id) => id !== editorId);
  if (state.activeEditorId !== editorId) return freezeState(editors, state.activeEditorId, mru);

  const activeEditorId = mru.find((id) => editors.some((editor) => editor.id === id))
    ?? editors[Math.min(closingIndex, editors.length - 1)]?.id
    ?? null;
  return freezeState(
    editors,
    activeEditorId,
    activeEditorId ? [activeEditorId, ...mru.filter((id) => id !== activeEditorId)] : [],
  );
}

export function closeEditorsUnderResource(
  state: EditorGroupState,
  resource: EditorResourceReference,
): EditorGroupState {
  // A Project root has no provider-relative document path. Close by global
  // resource identity so detaching a Folder also works at its root boundary.
  if (typeof resource === "string" && isDataResourceUri(resource)) {
    return state.editors
      .filter((editor) => editorResourceIdentity.isEqualOrParent(editor.resourceUri, resource))
      .reduce((next, editor) => closeEditor(next, editor.id), state);
  }
  const target = resolveEditorResource(resource);
  return state.editors
    .filter((editor) => isEditorWithinResource(editor, target))
    .reduce((next, editor) => closeEditor(next, editor.id), state);
}

export function rebaseEditorResources(
  state: EditorGroupState,
  previousResource: EditorResourceReference,
  nextResource: EditorResourceReference,
): EditorGroupState {
  const previous = resolveEditorResource(previousResource);
  const next = resolveCompatibleNextResource(previous, nextResource);
  const idMap = new Map<string, string>();
  const editors = state.editors.map((editor) => {
    if (!isEditorWithinResource(editor, previous)) return editor;
    const hostPath = rebaseDataResourcePath(
      editor.resource,
      previous.resourcePath,
      next.resourcePath,
    ) ?? editor.resource;
    if (hostPath === editor.resource) return editor;
    const reference: EditorResourceReference = next.rootUri
      ? {
          rootUri: next.rootUri,
          resourcePath: getWorkspaceResourcePath(
            next.rootUri,
            editorResourceIdentity.rebase(editor.resourceUri, previous.resourceUri, next.resourceUri),
          ),
          hostPath,
        }
      : hostPath;
    const rebased = createEditorInput(
      reference,
      hostPath === next.resourcePath ? basename(hostPath) : editor.label,
    );
    idMap.set(editor.id, rebased.id);
    return rebased;
  });
  const mapId = (id: string) => idMap.get(id) ?? id;
  return freezeState(
    editors,
    state.activeEditorId ? mapId(state.activeEditorId) : null,
    state.mostRecentlyUsed.map(mapId),
  );
}

export function parseEditorGroupState(
  value: unknown,
  options: Readonly<{ rootUri?: ResourceUri }> = {},
): EditorGroupState {
  if (!value || typeof value !== "object") return EMPTY_EDITOR_GROUP;
  const candidate = value as Partial<EditorGroupState>;
  if (!Array.isArray(candidate.editors)) return EMPTY_EDITOR_GROUP;
  const persistedIdMap = new Map<string, string>();
  const editors = candidate.editors.flatMap((editor) => {
    if (!editor || typeof editor !== "object") return [];
    const input = editor as Partial<EditorInput>;
    if (typeof input.resource !== "string" || !input.resource.trim()) return [];
    try {
      const rootUri = typeof input.rootUri === "string"
        ? canonicalizeResourceUri(input.rootUri)
        : options.rootUri;
      const persistedResourceUri = rootUri && typeof input.resourceUri === "string"
        ? canonicalizeResourceUri(input.resourceUri)
        : null;
      const parsed = createEditorInput(
        rootUri ? {
          rootUri,
          resourcePath: persistedResourceUri
            ? getWorkspaceResourcePath(rootUri, persistedResourceUri)
            : input.resource,
          hostPath: input.resource,
        } : input.resource,
        typeof input.label === "string" ? input.label : undefined,
      );
      if (typeof input.id === "string") persistedIdMap.set(input.id, parsed.id);
      persistedIdMap.set(input.resource, parsed.id);
      if (typeof input.resourceUri === "string") persistedIdMap.set(input.resourceUri, parsed.id);
      return [parsed];
    } catch {
      return [];
    }
  });
  const ids = new Set(editors.map((editor) => editor.id));
  const requestedActiveEditorId = typeof candidate.activeEditorId === "string"
    ? persistedIdMap.get(candidate.activeEditorId) ?? candidate.activeEditorId
    : null;
  const activeEditorId = requestedActiveEditorId && ids.has(requestedActiveEditorId)
    ? requestedActiveEditorId
    : editors[0]?.id ?? null;
  const storedMru = Array.isArray(candidate.mostRecentlyUsed)
    ? candidate.mostRecentlyUsed.flatMap((id) => {
      if (typeof id !== "string") return [];
      const mappedId = persistedIdMap.get(id) ?? id;
      return ids.has(mappedId) ? [mappedId] : [];
    })
    : [];
  const mru = [...new Set([...(activeEditorId ? [activeEditorId] : []), ...storedMru, ...ids])];
  return freezeState(editors, activeEditorId, mru);
}

function insertAfterActive(
  editors: readonly EditorInput[],
  activeEditorId: string | null,
  input: EditorInput,
): readonly EditorInput[] {
  const activeIndex = activeEditorId ? editors.findIndex((editor) => editor.id === activeEditorId) : -1;
  const insertIndex = activeIndex < 0 ? editors.length : activeIndex + 1;
  return [...editors.slice(0, insertIndex), input, ...editors.slice(insertIndex)];
}

function freezeState(
  editors: readonly EditorInput[],
  activeEditorId: string | null,
  mostRecentlyUsed: readonly string[],
): EditorGroupState {
  return Object.freeze({
    editors: Object.freeze([...editors]),
    activeEditorId,
    mostRecentlyUsed: Object.freeze([...mostRecentlyUsed]),
  });
}

function basename(resource: string): string {
  return resource.split("/").filter(Boolean).at(-1) ?? resource;
}

type ResolvedEditorResource = Readonly<{
  id: string;
  resourcePath: string;
  resourceUri: ResourceUri;
  rootUri: ResourceUri | null;
}>;

const editorResourceIdentity = new ResourceUriIdentityService();

function resolveEditorResource(resource: EditorResourceReference): ResolvedEditorResource {
  if (typeof resource === "string") {
    const resourcePath = canonicalizeResourcePath(resource);
    const resourceUri = createResourceUri({
      scheme: "puppyone-legacy",
      authority: "workspace",
      path: resourcePath,
    });
    return { id: resourcePath, resourcePath, resourceUri, rootUri: null };
  }
  const rootUri = canonicalizeResourceUri(resource.rootUri);
  const providerPath = canonicalizeResourcePath(resource.resourcePath);
  const resourcePath = resource.hostPath?.trim() || providerPath;
  const resourceUri = createWorkspaceResourceUri(rootUri, providerPath);
  return {
    id: editorResourceIdentity.canonicalKey(resourceUri),
    resourcePath,
    resourceUri,
    rootUri,
  };
}

function resolveCompatibleNextResource(
  previous: ResolvedEditorResource,
  next: EditorResourceReference,
): ResolvedEditorResource {
  if (typeof next !== "string") {
    const resolved = resolveEditorResource(next);
    if (previous.rootUri && resolved.rootUri && !editorResourceIdentity.isEqual(previous.rootUri, resolved.rootUri)) {
      throw new Error("Editor resource rebasing cannot cross Workspace Folders.");
    }
    return resolved;
  }
  return resolveEditorResource(previous.rootUri
    ? { rootUri: previous.rootUri, resourcePath: next }
    : next);
}

function isEditorWithinResource(
  editor: EditorInput,
  target: ResolvedEditorResource,
): boolean {
  if (target.rootUri === null) {
    return editor.rootUri === null
      && isSameOrDescendantResourcePath(editor.resource, target.resourcePath);
  }
  return editor.rootUri !== null
    && editorResourceIdentity.isEqual(editor.rootUri, target.rootUri)
    && editorResourceIdentity.isEqualOrParent(editor.resourceUri, target.resourceUri);
}
