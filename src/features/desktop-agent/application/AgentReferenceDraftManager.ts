import type {
  AgentDraftReference,
  AgentReferenceInputCapabilities,
} from "../domain/agent-contract";
import {
  acceptsAgentAttachment,
  classifyAgentAttachment,
} from "../domain/agent-reference-capabilities";
import type { AgentClientPort, AgentClientProvider } from "./AgentClientPort";
import type { AgentControllerState } from "./agent-controller-state";
import { AgentKnownError, formatAgentError } from "./agent-error";
import { mergeAgentReferences } from "./agent-controller-values";
import { parseWorkspaceResourceReference } from "../../../../shared/workspace-resource-reference.mjs";
import {
  AgentReferencePreviewStore,
  createAgentFileVisualPreview,
  type AgentReferenceVisualPreview,
} from "./AgentReferencePreviewStore";

type AgentReferenceDraftManagerOptions = {
  workspaceRoot: string;
  bridgeProvider: AgentClientProvider;
  readState: () => AgentControllerState;
  patch: (patch: Partial<AgentControllerState>) => void;
  appendText: (text: string) => void;
};

/** Owns draft reference acquisition, validation, retry material and grant release. */
export class AgentReferenceDraftManager {
  private retryFiles = new Map<string, File>();
  private retryWorkspacePaths = new Map<string, string>();
  private readonly previews = new AgentReferencePreviewStore();
  private epoch: string = createReferenceEpoch();
  private acquisitionGeneration = 0;

  constructor(private readonly options: AgentReferenceDraftManagerOptions) {}

  get referenceEpoch() {
    return this.epoch;
  }

  restoreEpoch(epoch: string) {
    if (!/^[A-Za-z0-9_-]{1,160}$/.test(epoch)) throw new Error("Invalid retained reference epoch.");
    this.epoch = epoch;
  }

  captureAcquisition() {
    const generation = this.acquisitionGeneration;
    return () => generation === this.acquisitionGeneration;
  }

  previewUrl(id: string) {
    return this.previews.getUrl(id);
  }

  async addWorkspacePaths(
    paths: string[],
    visualPreviews: ReadonlyMap<string, AgentReferenceVisualPreview> = new Map(),
  ) {
    const generation = this.acquisitionGeneration;
    const uniquePaths = Array.from(new Set(paths.filter(Boolean))).slice(0, 32);
    const acceptedPaths = new Set(uniquePaths);
    let bridge: AgentClientPort;
    try {
      bridge = this.requireBridge("resolveAgentWorkspaceReferences");
    } catch (error) {
      visualPreviews.forEach(safeReleaseVisualPreview);
      throw error;
    }
    for (const [path, preview] of visualPreviews) {
      if (!acceptedPaths.has(path)) safeReleaseVisualPreview(preview);
    }
    const resolved = await Promise.all(uniquePaths.map(async (path) => {
      try {
        const references = await bridge.resolveAgentWorkspaceReferences({
          rootPath: this.options.workspaceRoot,
          paths: [path],
        });
        if (generation !== this.acquisitionGeneration) {
          safeReleaseVisualPreview(visualPreviews.get(path));
          return [];
        }
        const preview = visualPreviews.get(path);
        if (preview && references.length > 0) this.previews.set(references[0]!.id, preview);
        else safeReleaseVisualPreview(preview);
        return references.map((reference) => this.withCapabilityStatus(reference));
      } catch (error) {
        if (generation !== this.acquisitionGeneration) {
          safeReleaseVisualPreview(visualPreviews.get(path));
          return [];
        }
        const reference = workspaceReferenceError(path, error);
        this.retryWorkspacePaths.set(reference.id, path);
        this.previews.set(reference.id, visualPreviews.get(path));
        return [reference];
      }
    }));
    if (generation !== this.acquisitionGeneration) return 0;
    const references = resolved.flat();
    const state = this.options.readState();
    const existingIds = new Set(state.references.map((reference) => reference.id));
    const merged = this.mergeAndValidate(state.references, references);
    this.options.patch({ references: merged, error: null });
    return merged.filter((reference) => reference.status === "ready" && !existingIds.has(reference.id)).length;
  }

  async pickWorkspaceReferences() {
    const bridge = this.requireBridge("pickAgentWorkspaceReferences");
    try {
      const references = (await bridge.pickAgentWorkspaceReferences({ rootPath: this.options.workspaceRoot }))
        .map((reference) => this.withCapabilityStatus(reference));
      const state = this.options.readState();
      const existingIds = new Set(state.references.map((reference) => reference.id));
      const merged = this.mergeAndValidate(state.references, references);
      this.options.patch({ references: merged, error: null });
      return merged.filter((reference) => reference.status === "ready" && !existingIds.has(reference.id)).length;
    } catch (error) {
      this.options.patch({ error: formatAgentError(error) });
      return 0;
    }
  }

  async addPathTextOrDraft(text: string) {
    const value = text.trim();
    if (!value) return false;
    const bridge = this.requireBridge("resolveAgentWorkspaceReferences");
    try {
      const references = (await bridge.resolveAgentWorkspaceReferences({
        rootPath: this.options.workspaceRoot,
        paths: [value],
      })).map((reference) => this.withCapabilityStatus(reference));
      if (references.length === 0) throw new Error("No workspace reference was resolved.");
      const state = this.options.readState();
      const existingIds = new Set(state.references.map((reference) => reference.id));
      const merged = this.mergeAndValidate(state.references, references);
      this.options.patch({ references: merged, error: null });
      return merged.some((reference) => reference.status === "ready" && !existingIds.has(reference.id));
    } catch {
      this.options.appendText(value);
      return false;
    }
  }

  async stageExternalFiles(files: File[]) {
    const bridge = this.requireBridge("stageAgentAttachments");
    const generation = this.acquisitionGeneration;
    const epoch = this.epoch;
    const selected = files.slice(0, 32);
    const pending = selected.map((file) => pendingAttachment(file));
    pending.forEach((reference, index) => {
      this.previews.set(reference.id, createAgentFileVisualPreview(selected[index]!));
    });
    const state = this.options.readState();
    const existingIds = new Set(state.references.map((reference) => reference.id));
    this.options.patch({ references: this.mergeAndValidate(state.references, pending), error: null });
    const completed = await Promise.all(selected.map(async (file, index) => {
      const pendingId = pending[index]!.id;
      const isCurrent = () => generation === this.acquisitionGeneration
        && this.options.readState().references.some((entry) => entry.id === pendingId);
      let result: AgentDraftReference;
      try {
        const [reference] = await bridge.stageAgentAttachments({
          rootPath: this.options.workspaceRoot,
          epoch,
          files: [file],
        });
        if (!reference) throw new Error("The selected attachment was not staged.");
        if (!isCurrent()) {
          await this.revokeUnretained(reference);
          this.previews.delete(pendingId);
          return null;
        }
        const supported = this.withCapabilityStatus(reference);
        if (supported.status === "error" && supported.kind === "staged-attachment" && supported.token) {
          await bridge.revokeAgentAttachments?.({ rootPath: this.options.workspaceRoot, tokens: [supported.token] });
          result = { ...supported, token: undefined };
        } else result = supported;
      } catch (error) {
        result = attachmentReferenceError(file, error);
      }
      if (!isCurrent()) {
        await this.revokeUnretained(result);
        this.previews.delete(pendingId);
        return null;
      }
      // Replace each pending item atomically in its original position. A slow
      // sibling must not hide a ready image or resurrect one the user removed.
      const merged = this.mergeAndValidate([], this.options.readState().references.map((entry) => entry.id === pendingId ? result : entry));
      const retained = merged.find((entry) => entry.id === result.id);
      this.previews.move(pendingId, result.id);
      if (retained?.status === "error") this.retryFiles.set(retained.id, file);
      this.options.patch({ references: merged });
      return retained ?? null;
    }));
    const completedIds = new Set(completed.flatMap((reference) => reference ? [reference.id] : []));
    return this.options.readState().references.filter((reference) => (
      reference.status === "ready" && completedIds.has(reference.id) && !existingIds.has(reference.id)
    )).length;
  }

  private async revokeUnretained(reference: AgentDraftReference) {
    if (reference.kind !== "staged-attachment" || !reference.token) return;
    // Staging deduplicates: a cancelled duplicate cannot revoke a retained image.
    if (this.options.readState().references.some((entry) => entry.kind === "staged-attachment" && entry.token === reference.token)) return;
    await this.revoke([reference]);
  }

  remove(id: string) {
    const state = this.options.readState();
    const reference = state.references.find((entry) => entry.id === id);
    if (!reference) return;
    this.retryFiles.delete(id);
    this.retryWorkspacePaths.delete(id);
    this.options.patch({ references: state.references.filter((entry) => entry.id !== id) });
    void this.revoke([reference]);
  }

  retry(id: string) {
    const state = this.options.readState();
    const reference = state.references.find((entry) => entry.id === id);
    if (!reference || reference.status !== "error") return;
    const file = this.retryFiles.get(id);
    const workspacePath = this.retryWorkspacePaths.get(id);
    this.retryFiles.delete(id);
    this.retryWorkspacePaths.delete(id);
    this.options.patch({ references: state.references.filter((entry) => entry.id !== id) });
    void (async () => {
      await this.revoke([reference]);
      if (file) await this.stageExternalFiles([file]);
      else if (reference.kind === "workspace-entry") await this.addWorkspacePaths([workspacePath ?? reference.resourceUri ?? reference.relativePath]);
    })();
  }

  mergeAndValidate(current: AgentDraftReference[], incoming: AgentDraftReference[]) {
    const capabilities = this.options.readState().inspection?.capabilities?.referenceInputs;
    let count = 0;
    let bytes = 0;
    return mergeAgentReferences(current, incoming).map((original) => {
      if (original.status !== "ready") return original;
      const reference = this.withCapabilityStatus(original);
      if (reference.status !== "ready" || !capabilities) return reference;
      count += 1;
      bytes += reference.size ?? 0;
      if (count > capabilities.limits.maxCount) {
        return referenceCapabilityError(reference, "reference-limit", "This Agent's reference count limit was reached.");
      }
      if (bytes > capabilities.limits.maxTotalBytes) {
        return referenceCapabilityError(reference, "reference-total-size", "This Agent's total reference size limit was reached.");
      }
      return reference;
    });
  }

  async revoke(references: AgentDraftReference[]) {
    this.releasePreviews(references);
    const tokens = Array.from(new Set(references.flatMap((reference) => (
      reference.kind === "staged-attachment" && reference.token ? [reference.token] : []
    ))));
    if (tokens.length === 0) return;
    const bridge = this.options.bridgeProvider();
    if (!bridge?.revokeAgentAttachments) return;
    await bridge.revokeAgentAttachments({ rootPath: this.options.workspaceRoot, tokens }).catch(() => undefined);
  }

  async rotate(references: AgentDraftReference[]) {
    this.acquisitionGeneration += 1;
    await this.revoke(references);
    this.retryFiles.clear();
    this.retryWorkspacePaths.clear();
    this.previews.clear();
    this.epoch = createReferenceEpoch();
  }

  async reset(references: AgentDraftReference[]) {
    await this.rotate(references);
    this.options.patch({ references: [], draftMentions: [], pendingIntent: null });
  }

  releasePreviews(references: AgentDraftReference[]) {
    this.previews.deleteMany(references.map((reference) => reference.id));
  }

  disposeRendererResources() {
    this.acquisitionGeneration += 1;
    this.retryFiles.clear();
    this.retryWorkspacePaths.clear();
    this.previews.clear();
  }

  private withCapabilityStatus(reference: AgentDraftReference): AgentDraftReference {
    const failure = unsupportedReferenceFailure(
      reference,
      this.options.readState().inspection?.capabilities?.referenceInputs,
    );
    return failure ? { ...reference, status: "error", error: failure } : reference;
  }

  private requireBridge<K extends keyof AgentClientPort>(...methods: K[]): AgentClientPort {
    const bridge = this.options.bridgeProvider();
    if (!bridge || methods.some((method) => typeof bridge[method] !== "function")) {
      throw new AgentKnownError("native-bridge-unavailable");
    }
    return bridge;
  }
}

function createReferenceEpoch() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function pendingAttachment(file: File): AgentDraftReference {
  return {
    id: `pending-${createReferenceEpoch()}`,
    kind: "staged-attachment",
    displayName: safeReferenceName(file.name),
    mime: file.type || "application/octet-stream",
    size: Number.isFinite(file.size) ? file.size : 0,
    status: "resolving",
  };
}

function attachmentReferenceError(file: File, error: unknown): AgentDraftReference {
  return {
    id: `error-${createReferenceEpoch()}`,
    kind: "staged-attachment",
    displayName: safeReferenceName(file.name),
    mime: file.type || "application/octet-stream",
    size: Number.isFinite(file.size) ? file.size : 0,
    status: "error",
    error: { code: "staging-failed", message: safeReferenceError(error) },
  };
}

function workspaceReferenceError(referencePath: string, error: unknown): AgentDraftReference {
  try { referencePath = parseWorkspaceResourceReference(referencePath).relativePath; } catch { /* Legacy relative path. */ }
  const displayName = safeReferenceName(referencePath.split(/[\\/]/).filter(Boolean).at(-1) || "workspace item");
  return {
    id: `error-${createReferenceEpoch()}`,
    kind: "workspace-entry",
    entryType: "file",
    relativePath: displayName,
    displayName,
    status: "error",
    error: { code: "workspace-resolution-failed", message: safeReferenceError(error) },
  };
}

function unsupportedReferenceFailure(
  reference: AgentDraftReference,
  capabilities: AgentReferenceInputCapabilities | undefined,
): { code: string; message: string } | null {
  if (!capabilities) return referenceFailure("capability-unreported", "The selected Agent has not reported reference input support.");
  if ((reference.size ?? 0) > capabilities.limits.maxBytesPerReference) {
    return referenceFailure("reference-size", "This reference exceeds the selected Agent's size limit.");
  }
  if (reference.kind === "workspace-entry") {
    if (reference.workspaceName && capabilities.workspace.crossRoots !== true) {
      return referenceFailure("workspace-cross-root-unsupported", "The selected Agent does not accept references from another project.");
    }
    if (reference.entryType === "directory" && !capabilities.workspace.directories) {
      return referenceFailure("workspace-directory-unsupported", "The selected Agent does not accept workspace directories.");
    }
    if (reference.entryType === "file" && !capabilities.workspace.files) {
      return referenceFailure("workspace-file-unsupported", "The selected Agent does not accept workspace files.");
    }
    return null;
  }
  const attachment = { mime: reference.mime, name: reference.displayName };
  const kind = classifyAgentAttachment(attachment);
  const kindLimit = capabilities.attachments[kind].maxBytes;
  if (kindLimit && (reference.size ?? 0) > kindLimit) {
    return referenceFailure("reference-size", "This reference exceeds the selected Agent's size limit.");
  }
  if (!acceptsAgentAttachment(capabilities, attachment)) {
    return kind === "image"
      ? referenceFailure("image-unsupported", "The selected Agent does not accept image attachments.")
      : referenceFailure("file-unsupported", "The selected Agent does not accept this file type.");
  }
  return null;
}

function referenceFailure(code: string, message: string) {
  return { code, message };
}

function referenceCapabilityError(reference: AgentDraftReference, code: string, message: string): AgentDraftReference {
  return { ...reference, status: "error", error: { code, message } };
}

function safeReferenceName(value: string) {
  return value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 512) || "attachment";
}

function safeReferenceError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/i, "")
    .replace(/[\r\n]+/g, " ")
    .slice(0, 500) || "The reference could not be added.";
}

function safeReleaseVisualPreview(preview: AgentReferenceVisualPreview | undefined) {
  try {
    preview?.release?.();
  } catch {
    // Preview cleanup must not turn a recoverable reference into a draft error.
  }
}
