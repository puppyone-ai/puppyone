import { useCallback, useEffect, useRef, useState } from "react";
import type { DragEvent } from "react";
import {
  classifyReferenceDataTransfer,
  hasReferenceDataTransferSource,
  isDataResourceUri,
} from "@puppyone/shared-ui";
import { useLocalization } from "@puppyone/localization/react";
import type { AgentSessionController } from "../application/AgentSessionController";
import type { AgentReferenceVisualPreview } from "../application/AgentReferencePreviewStore";
import type { AgentReferenceInputCapabilities } from "../domain/agent-contract";
import {
  acceptsAgentAttachment,
  hasAgentAttachmentSupport,
} from "../domain/agent-reference-capabilities";
import { resolveLocalResourceDropSource } from "../../../platform/resourceDragSession";
import { useResourceDragPreview } from "../../../platform/useResourceDragPreview";
import type { AgentReferenceDropEvent } from "./agentReferenceDropEvent";

export type AgentWorkspaceReferenceResolution = Readonly<{
  workspaceRoot: string;
  referencePath: string;
  loadVisualPreview?: () => Promise<AgentReferenceVisualPreview | null>;
}>;

export type AgentWorkspaceReferenceResolver = (
  resource: string,
) => AgentWorkspaceReferenceResolution | null | Promise<AgentWorkspaceReferenceResolution | null>;

export function useAgentReferenceIngestion({
  controller,
  workspaceId,
  capabilities,
  resolveWorkspaceReference,
}: {
  controller: AgentSessionController;
  workspaceId: string;
  capabilities?: AgentReferenceInputCapabilities;
  resolveWorkspaceReference?: AgentWorkspaceReferenceResolver;
}) {
  const { t } = useLocalization();
  const [announcement, setAnnouncement] = useState("");
  const dragPreview = useResourceDragPreview();
  const dropEpoch = useRef(0);
  useEffect(() => () => { dropEpoch.current += 1; }, [controller, workspaceId]);
  const announceBatchResult = useCallback((beforeIds: Set<string>, count: number) => {
    const failed = controller.getSnapshot().references
      .filter((reference) => reference.status === "error" && !beforeIds.has(reference.id)).length;
    setAnnouncement(failed > 0
      ? t("agent.reference.batchPartial", { count, failed })
      : t("agent.reference.batchResult", { count }));
  }, [controller, t]);

  const onDragOver = useCallback((event: DragEvent<HTMLElement>) => {
    if (!hasReferenceDataTransferSource(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = canIngestDataTransfer(event.dataTransfer, workspaceId, capabilities, dragPreview)
      ? "copy"
      : "none";
  }, [capabilities, dragPreview, workspaceId]);

  const ingestDrop = useCallback((event: AgentReferenceDropEvent) => {
    if (!hasReferenceDataTransferSource(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    const beforeIds = new Set(controller.getSnapshot().references.map((reference) => reference.id));
    const epoch = dropEpoch.current;
    const acquisitionCurrent = controller.captureReferenceAcquisition();
    void ingestDataTransfer(
      event.dataTransfer,
      workspaceId,
      controller,
      resolveWorkspaceReference,
      () => epoch === dropEpoch.current && acquisitionCurrent(),
    ).then((result) => {
      if (epoch !== dropEpoch.current || !acquisitionCurrent()) return;
      setAnnouncement(result === "workspace-mismatch"
        ? t("agent.reference.workspaceMismatch")
        : result === "resource-unavailable"
          ? t("agent.reference.resourceUnavailable")
          : "");
      if (typeof result === "number") announceBatchResult(beforeIds, result);
    }).catch(() => { if (epoch === dropEpoch.current && acquisitionCurrent()) setAnnouncement(t("agent.reference.resourceUnavailable")); });
  }, [announceBatchResult, controller, resolveWorkspaceReference, t, workspaceId]);

  const onDrop = useCallback((event: DragEvent<HTMLElement>) => {
    ingestDrop(event);
  }, [ingestDrop]);

  const onEditorDrop = useCallback((event: AgentReferenceDropEvent) => {
    ingestDrop(event);
  }, [ingestDrop]);

  const onPaste = useCallback((event: { clipboardData: DataTransfer; preventDefault: () => void }) => {
    const files = Array.from(event.clipboardData.files).filter((file) => acceptsAgentAttachment(capabilities, {
      mime: file.type,
      name: file.name,
    }));
    if (files.length === 0) return;
    event.preventDefault();
    const beforeIds = new Set(controller.getSnapshot().references.map((reference) => reference.id));
    void controller.stageExternalFiles(files).then((count) => {
      announceBatchResult(beforeIds, count);
    });
  }, [announceBatchResult, capabilities, controller]);

  const addExternalFiles = useCallback((files: File[]) => {
    const beforeIds = new Set(controller.getSnapshot().references.map((reference) => reference.id));
    void controller.stageExternalFiles(files).then((count) => {
      announceBatchResult(beforeIds, count);
    });
  }, [announceBatchResult, controller]);

  const pickWorkspaceReferences = useCallback(() => {
    const beforeIds = new Set(controller.getSnapshot().references.map((reference) => reference.id));
    void controller.pickWorkspaceReferences().then((count) => {
      announceBatchResult(beforeIds, count);
    });
  }, [announceBatchResult, controller]);

  return {
    announcement,
    onDragOver,
    onDrop,
    onEditorDrop,
    onPaste,
    addExternalFiles,
    pickWorkspaceReferences,
  };
}

function canIngestDataTransfer(
  dataTransfer: DataTransfer,
  workspaceId: string,
  capabilities: AgentReferenceInputCapabilities | undefined,
  preview: ReturnType<typeof useResourceDragPreview>,
) {
  const source = preview
    ? { kind: "workspace-entries" as const, workspaceId: null, entries: preview.entries }
    : classifyReferenceDataTransfer(dataTransfer);
  if (source.kind === "text") return true;
  if (source.kind === "none") {
    const types = Array.from(dataTransfer.types ?? []);
    if (types.includes("Files")) return Boolean(capabilities?.workspace.files || capabilities?.workspace.directories || hasAgentAttachmentSupport(capabilities));
    return true;
  }
  if (!capabilities) return false;
  if (source.kind === "workspace-entries") {
    if (source.workspaceId && source.workspaceId !== workspaceId && source.entries.some((entry) => !isDataResourceUri(entry.path))) return false;
    return source.entries.every((entry) => entry.entryType === "directory"
      ? capabilities.workspace.directories
      : capabilities.workspace.files);
  }
  if (source.files.length === 0) {
    return hasAgentAttachmentSupport(capabilities);
  }
  // Chromium exposes Finder folders through DataTransfer.files before Main
  // can stat them. A directory-capable runtime must therefore admit the drop
  // for authoritative file-vs-directory inspection after release.
  return capabilities.workspace.directories || source.files.every((file) => acceptsAgentAttachment(capabilities, {
    mime: file.type,
    name: file.name,
  }));
}

async function ingestDataTransfer(
  dataTransfer: DataTransfer,
  workspaceId: string,
  controller: AgentSessionController,
  resolveWorkspaceReference: AgentWorkspaceReferenceResolver | undefined,
  isCurrent: () => boolean,
): Promise<number | "workspace-mismatch" | "resource-unavailable" | "path-inserted"> {
  const source = await resolveLocalResourceDropSource(classifyReferenceDataTransfer(dataTransfer), "agent-reference");
  if (!isCurrent()) return 0;
  if (source.kind === "workspace-entries") {
    const paths: string[] = [];
    const resolutions: Array<{ resourceUri: string; resolved: AgentWorkspaceReferenceResolution }> = [];
    for (const entry of source.entries) {
      if (!isDataResourceUri(entry.path)) {
        if (source.workspaceId && source.workspaceId !== workspaceId) return "workspace-mismatch";
        paths.push(entry.path);
        continue;
      }
      const resolved = await Promise.resolve(resolveWorkspaceReference?.(entry.path)).catch(() => null);
      // Preserve the owner through Main authorization and native delivery. The
      // session's cwd is not the identity of a reference from another root.
      paths.push(entry.path);
      if (resolved) resolutions.push({ resourceUri: entry.path, resolved });
    }
    const visualPreviews = new Map<string, AgentReferenceVisualPreview>();
    await Promise.all(resolutions.map(async ({ resourceUri, resolved }) => {
      if (!resolved.loadVisualPreview) return;
      const preview = await resolved.loadVisualPreview().catch(() => null);
      if (preview) {
        try {
          visualPreviews.get(resourceUri)?.release?.();
        } catch {
          // A stale duplicate preview must not block the valid reference.
        }
        visualPreviews.set(resourceUri, preview);
      }
    }));
    if (!isCurrent()) {
      for (const preview of visualPreviews.values()) preview.release?.();
      return 0;
    }
    return controller.addWorkspacePaths(paths, visualPreviews);
  }
  if (source.kind === "local-entries") {
    const files = source.entries.filter((entry) => entry.entryType === "file").map((entry) => entry.file);
    let count = files.length > 0 ? await controller.stageExternalFiles(files) : 0;
    let insertedPath = false;
    for (const directory of source.entries.filter((entry) => entry.entryType === "directory")) {
      if (await controller.addPathTextOrDraft(directory.path)) count += 1;
      else insertedPath = true;
    }
    return count > 0 ? count : insertedPath ? "path-inserted" : 0;
  }
  if (source.kind === "files") return controller.stageExternalFiles(source.files);
  if (source.kind === "text") return (await controller.addPathTextOrDraft(source.text)) ? 1 : 0;
  return 0;
}
