import { useCallback, useMemo, useRef, useState } from "react";
import type { DragEvent as ReactDragEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import { useLocalization } from "@puppyone/localization/react";
import { bidiIsolate, type MessageFormatter } from "@puppyone/localization/core";
import {
  Copy,
  Folder,
  GripVertical,
  Play,
  Plus,
  Trash2,
} from "lucide-react";
import {
  compilePuppyFlowRun,
  createDefaultPuppyFlowDocument,
  createPuppyFlowStep,
  getPuppyFlowAgent,
  parsePuppyFlowDocument,
  PUPPYFLOW_AGENT_OPTIONS,
  serializePuppyFlowDocument,
  type PuppyFlowAgentId,
  type PuppyFlowDocument,
  type PuppyFlowStep,
} from "./puppyflowModel";
import { useStructuredDocumentModel } from "../../document-session/useStructuredDocumentModel";
import type { PresetViewerRenderContext } from "../../registry/viewerTypes";
import { AgentBrandImage } from "../../../brand/AgentBrandImage";
import { resolveAgentBrand } from "../../../core/agentBrandCatalog";

type PuppyFlowViewerProps = Pick<
  PresetViewerRenderContext,
  "document" | "content" | "canEdit" | "workspaceRoot"
>;

type StepDropPosition = "before" | "after";
type StepDropTarget = { stepId: string; position: StepDropPosition } | null;

const STEP_DRAG_MIME_TYPE = "application/x-puppyflow-step-id";

export function PuppyFlowViewer({
  document: sourceDocument,
  content: sourceContent,
  canEdit,
  workspaceRoot,
}: PuppyFlowViewerProps) {
  const { t } = useLocalization();
  const fallbackTitle = getTitleFromFilename(
    sourceDocument.name,
    t("editor.puppyflow.untitledFlow"),
  );
  const defaults = useMemo(() => ({
    title: fallbackTitle,
    prompts: [
      t("editor.puppyflow.defaultPrompt.analyze"),
      t("editor.puppyflow.defaultPrompt.apply"),
    ] as const,
  }), [fallbackTitle, t]);
  const { model, state, edit, onHistoryKeyDown } = useStructuredDocumentModel({
    kind: "puppyflow",
    documentId: sourceDocument.path,
    content: sourceContent,
    canEdit,
    parse: (content) => {
      const parsed = parsePuppyFlowDocument(content, defaults);
      return { document: parsed.document, error: parsed.ok ? null : parsed.error };
    },
    serialize: serializePuppyFlowDocument,
  });
  const document = state.document;
  const parseError = state.error;
  const [runMessage, setRunMessage] = useState<"no-enabled-prompts" | null>(null);
  const [draggedStepId, setDraggedStepId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<StepDropTarget>(null);
  const workdirPath = useMemo(() => formatWorkspacePath(workspaceRoot), [workspaceRoot]);
  const workdirLabel = workdirPath ?? t("editor.puppyflow.workspaceSandbox");
  const workdirTitle = workdirPath
    ? t("editor.puppyflow.workdir", { path: bidiIsolate(workdirPath) })
    : t("editor.puppyflow.workspaceSandbox");
  const draggedStepIdRef = useRef<string | null>(null);
  const applyDocumentEdit = useCallback((nextDocument: PuppyFlowDocument) => {
    edit(nextDocument);
    setRunMessage(null);
  }, [edit]);
  const updateDocument = useCallback((updater: (current: PuppyFlowDocument) => PuppyFlowDocument) => {
    applyDocumentEdit(updater(model.getSnapshot().document));
  }, [applyDocumentEdit, model]);

  const updateStep = useCallback((stepId: string, patch: Partial<PuppyFlowStep>) => {
    updateDocument((current) => ({
      ...current,
      steps: current.steps.map((step) => (
        step.id === stepId ? { ...step, ...patch } : step
      )),
    }));
  }, [updateDocument]);

  const addStep = useCallback(() => {
    updateDocument((current) => ({
      ...current,
      steps: [...current.steps, createPuppyFlowStep(current.steps[current.steps.length - 1]?.agent ?? "codex")],
    }));
  }, [updateDocument]);

  const duplicateStep = useCallback((step: PuppyFlowStep) => {
    updateDocument((current) => {
      const index = current.steps.findIndex((candidate) => candidate.id === step.id);
      const duplicate = {
        ...step,
        id: createPuppyFlowStep(step.agent).id,
      };
      const steps = [...current.steps];
      steps.splice(index + 1, 0, duplicate);
      return { ...current, steps };
    });
  }, [updateDocument]);

  const removeStep = useCallback((stepId: string) => {
    updateDocument((current) => ({
      ...current,
      steps: current.steps.length <= 1
        ? current.steps
        : current.steps.filter((step) => step.id !== stepId),
    }));
  }, [updateDocument]);

  const moveStep = useCallback((draggedId: string, targetId: string, position: StepDropPosition) => {
    if (draggedId === targetId) return;
    updateDocument((current) => {
      const steps = moveStepRelativeToTarget(current.steps, draggedId, targetId, position);
      if (steps === current.steps) return current;
      return { ...current, steps };
    });
  }, [updateDocument]);

  const moveStepByOffset = useCallback((stepId: string, offset: -1 | 1) => {
    updateDocument((current) => {
      const steps = moveStepByOffsetInList(current.steps, stepId, offset);
      if (steps === current.steps) return current;
      return { ...current, steps };
    });
  }, [updateDocument]);

  const clearDragState = useCallback(() => {
    draggedStepIdRef.current = null;
    setDraggedStepId(null);
    setDropTarget(null);
  }, []);

  const updateDropTarget = useCallback((stepId: string, position: StepDropPosition) => {
    if (draggedStepIdRef.current === stepId) {
      setDropTarget(null);
      return;
    }
    setDropTarget((current) => (
      current?.stepId === stepId && current.position === position
        ? current
        : { stepId, position }
    ));
  }, []);

  const handleRun = useCallback(() => {
    const compiled = compilePuppyFlowRun(model.getSnapshot().document);
    if (compiled.enabledSteps === 0) {
      setRunMessage("no-enabled-prompts");
      return;
    }

    setRunMessage(null);
  }, [model]);

  const resetInvalidFile = useCallback(() => {
    const nextDocument = createDefaultPuppyFlowDocument(defaults);
    applyDocumentEdit(nextDocument);
  }, [applyDocumentEdit, defaults]);

  return (
    <section className="puppyflow-editor-shell" onKeyDownCapture={onHistoryKeyDown} aria-label={t("editor.puppyflow.ariaLabel")}>
      <button className="puppyflow-run-button" type="button" onClick={handleRun}>
        <Play size={14} fill="currentColor" />
        <span>{t("editor.puppyflow.run")}</span>
      </button>

      <div className="puppyflow-document" data-po-scrollbar="content">
        {runMessage ? (
          <div className="puppyflow-toolbar-status" role="status">
            {runMessage === "no-enabled-prompts"
              ? t("editor.puppyflow.noEnabledPrompts")
              : null}
          </div>
        ) : null}

        {parseError && (
          <div className="puppyflow-parse-error" role="alert">
            <span>{t("editor.puppyflow.parseFailedDetail", { detail: bidiIsolate(parseError) })}</span>
            {canEdit && (
              <button type="button" onClick={resetInvalidFile}>
                {t("editor.puppyflow.resetTemplate")}
              </button>
            )}
          </div>
        )}

        <div className="puppyflow-step-list">
          {document.steps.map((step, index) => (
            <PuppyFlowStepRow
              key={step.id}
              step={step}
              index={index}
              readOnly={!canEdit}
              dragging={draggedStepId === step.id}
              dropPosition={dropTarget?.stepId === step.id ? dropTarget.position : null}
              onDragStart={(event) => {
                draggedStepIdRef.current = step.id;
                setDraggedStepId(step.id);
                setDropTarget(null);
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData(STEP_DRAG_MIME_TYPE, step.id);
                event.dataTransfer.setData("text/plain", step.id);
                event.dataTransfer.setDragImage(event.currentTarget, 12, 12);
              }}
              onDragOver={(event, position) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                updateDropTarget(step.id, position);
              }}
              onDragLeave={(event) => {
                if (didLeaveElement(event)) {
                  setDropTarget((current) => (current?.stepId === step.id ? null : current));
                }
              }}
              onDrop={(event, position) => {
                event.preventDefault();
                const droppedStepId = event.dataTransfer.getData(STEP_DRAG_MIME_TYPE)
                  || event.dataTransfer.getData("text/plain")
                  || draggedStepIdRef.current;
                clearDragState();
                if (droppedStepId) moveStep(droppedStepId, step.id, position);
              }}
              onDragEnd={clearDragState}
              onMoveByKeyboard={(offset) => moveStepByOffset(step.id, offset)}
              onAgentChange={(agent) => updateStep(step.id, { agent })}
              onPromptChange={(prompt) => updateStep(step.id, { prompt })}
              onToggleEnabled={() => updateStep(step.id, { enabled: !step.enabled })}
              onDuplicate={() => duplicateStep(step)}
              onRemove={() => removeStep(step.id)}
              workdirLabel={workdirLabel}
              workdirIsPath={workdirPath !== null}
              workdirTitle={workdirTitle}
            />
          ))}
          <div className="puppyflow-add-row">
            <span className="puppyflow-add-connector" aria-hidden="true" />
            <button
              className="puppyflow-add-button"
              type="button"
              aria-label={t("editor.puppyflow.addStep")}
              title={t("editor.puppyflow.addStep")}
              disabled={!canEdit}
              onClick={addStep}
            >
              <span className="puppyflow-add-icon" aria-hidden="true">
                <Plus size={15} />
              </span>
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function PuppyFlowStepRow({
  step,
  index,
  readOnly,
  dragging,
  dropPosition,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
  onMoveByKeyboard,
  onAgentChange,
  onPromptChange,
  onToggleEnabled,
  onDuplicate,
  onRemove,
  workdirLabel,
  workdirIsPath,
  workdirTitle,
}: {
  step: PuppyFlowStep;
  index: number;
  readOnly: boolean;
  dragging: boolean;
  dropPosition: StepDropPosition | null;
  onDragStart: (event: ReactDragEvent<HTMLButtonElement>) => void;
  onDragOver: (event: ReactDragEvent<HTMLElement>, position: StepDropPosition) => void;
  onDragLeave: (event: ReactDragEvent<HTMLElement>) => void;
  onDrop: (event: ReactDragEvent<HTMLElement>, position: StepDropPosition) => void;
  onDragEnd: () => void;
  onMoveByKeyboard: (offset: -1 | 1) => void;
  onAgentChange: (agent: PuppyFlowAgentId) => void;
  onPromptChange: (prompt: string) => void;
  onToggleEnabled: () => void;
  onDuplicate: () => void;
  onRemove: () => void;
  workdirLabel: string;
  workdirIsPath: boolean;
  workdirTitle: string;
}) {
  const { formatNumber, t } = useLocalization();
  const agent = getPuppyFlowAgent(step.agent);
  const stepNumber = formatNumber(index + 1);

  return (
    <article
      className="puppyflow-step-row"
      data-dragging={dragging}
      data-drop-position={dropPosition ?? undefined}
      data-disabled={!step.enabled}
      data-read-only={readOnly || undefined}
      onDragOver={(event) => onDragOver(event, getStepDropPosition(event))}
      onDragEnter={(event) => onDragOver(event, getStepDropPosition(event))}
      onDragLeave={onDragLeave}
      onDrop={(event) => {
        onDrop(event, getStepDropPosition(event));
      }}
    >
      <button
        className="puppyflow-step-grip"
        type="button"
        draggable={!readOnly}
        disabled={readOnly}
        aria-label={t("editor.puppyflow.reorderStep", { number: index + 1 })}
        title={t("editor.puppyflow.reorderHint")}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onKeyDown={(event) => {
          handleStepGripKeyDown(event, onMoveByKeyboard);
        }}
      >
        <GripVertical size={16} />
      </button>
      <span className="puppyflow-step-index">{stepNumber}</span>
      <div className="puppyflow-step-card">
        <div className="puppyflow-prompt-cell">
          <textarea
            value={step.prompt}
            rows={1}
            placeholder={t("editor.puppyflow.promptPlaceholder")}
            aria-label={t("editor.puppyflow.promptForStep", { number: index + 1 })}
            dir="auto"
            readOnly={readOnly}
            onChange={(event) => onPromptChange(event.target.value)}
          />
        </div>
        <div className="puppyflow-step-footer">
          <label className={`puppyflow-agent-select tone-${agent.tone}`}>
            <span className="puppyflow-agent-logo" aria-hidden="true">
              <PuppyFlowAgentLogo agentId={agent.id} />
            </span>
            <select
              value={step.agent}
              aria-label={t("editor.puppyflow.agentForStep", { number: index + 1 })}
              disabled={readOnly}
              onChange={(event) => onAgentChange(event.target.value as PuppyFlowAgentId)}
            >
              {PUPPYFLOW_AGENT_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>{option.label}</option>
              ))}
            </select>
          </label>
          <span className="puppyflow-step-meta">{agent.provider} · {getAgentModelLabel(agent.id, t)}</span>
          <span className="puppyflow-step-meta workdir" title={workdirTitle}>
            <Folder size={13} />
            <span dir={workdirIsPath ? "ltr" : "auto"}>{workdirLabel}</span>
          </span>
        </div>
        <div className="puppyflow-step-actions">
          <button type="button" disabled={readOnly} aria-label={t("editor.puppyflow.duplicateStep", { number: index + 1 })} onClick={onDuplicate}>
            <Copy size={15} />
          </button>
          <button
            className="puppyflow-toggle"
            type="button"
            disabled={readOnly}
            data-enabled={step.enabled}
            aria-label={step.enabled
              ? t("editor.puppyflow.disableStep", { number: index + 1 })
              : t("editor.puppyflow.enableStep", { number: index + 1 })}
            onClick={onToggleEnabled}
          >
            <span />
          </button>
          <button type="button" disabled={readOnly} aria-label={t("editor.puppyflow.deleteStep", { number: index + 1 })} onClick={onRemove}>
            <Trash2 size={15} />
          </button>
        </div>
      </div>
    </article>
  );
}

function PuppyFlowAgentLogo({ agentId }: { agentId: PuppyFlowAgentId }) {
  const brand = resolveAgentBrand({ id: agentId });
  return brand ? <AgentBrandImage brandId={brand.id} /> : null;
}

function getTitleFromFilename(name: string, fallback: string): string {
  const withoutExtension = name
    .replace(/\.puppyflow\.json$/i, "")
    .replace(/\.puppyflow$/i, "");
  const words = withoutExtension
    .replace(/[-_]+/g, " ")
    .trim();
  return words ? words.replace(/\b\w/g, (char) => char.toUpperCase()) : fallback;
}

function formatWorkspacePath(workspacePath?: string | null): string | null {
  if (!workspacePath) return null;
  return workspacePath.replace(/^\/Users\/[^/]+/, "~");
}



function getAgentModelLabel(agentId: PuppyFlowAgentId, t: MessageFormatter): string {
  if (agentId === "codex") return t("editor.puppyflow.agent.codexModel");
  if (agentId === "claude-code") return t("editor.puppyflow.agent.claudeModel");
  if (agentId === "cursor-cli") return t("editor.puppyflow.agent.cursorModel");
  return t("editor.puppyflow.agent.configuredModel");
}

function getStepDropPosition(event: ReactDragEvent<HTMLElement>): StepDropPosition {
  const rect = event.currentTarget.getBoundingClientRect();
  return event.clientY < rect.top + rect.height / 2 ? "before" : "after";
}

function didLeaveElement(event: ReactDragEvent<HTMLElement>): boolean {
  const nextTarget = event.relatedTarget;
  return !(nextTarget instanceof Node && event.currentTarget.contains(nextTarget));
}

function handleStepGripKeyDown(
  event: ReactKeyboardEvent<HTMLButtonElement>,
  onMoveByKeyboard: (offset: -1 | 1) => void,
) {
  if (event.key === "ArrowUp") {
    event.preventDefault();
    onMoveByKeyboard(-1);
  } else if (event.key === "ArrowDown") {
    event.preventDefault();
    onMoveByKeyboard(1);
  }
}

function moveStepRelativeToTarget(
  steps: PuppyFlowStep[],
  draggedId: string,
  targetId: string,
  position: StepDropPosition,
): PuppyFlowStep[] {
  const fromIndex = steps.findIndex((step) => step.id === draggedId);
  const targetIndex = steps.findIndex((step) => step.id === targetId);
  if (fromIndex < 0 || targetIndex < 0 || fromIndex === targetIndex) return steps;

  const nextSteps = [...steps];
  const [draggedStep] = nextSteps.splice(fromIndex, 1);
  let insertIndex = targetIndex;
  if (fromIndex < targetIndex) insertIndex -= 1;
  if (position === "after") insertIndex += 1;
  nextSteps.splice(clampIndex(insertIndex, nextSteps.length), 0, draggedStep);
  return nextSteps;
}

function moveStepByOffsetInList(steps: PuppyFlowStep[], stepId: string, offset: -1 | 1): PuppyFlowStep[] {
  const fromIndex = steps.findIndex((step) => step.id === stepId);
  if (fromIndex < 0) return steps;

  const toIndex = clampIndex(fromIndex + offset, steps.length - 1);
  if (fromIndex === toIndex) return steps;

  const nextSteps = [...steps];
  const [step] = nextSteps.splice(fromIndex, 1);
  nextSteps.splice(toIndex, 0, step);
  return nextSteps;
}

function clampIndex(index: number, maxIndex: number): number {
  return Math.min(Math.max(index, 0), maxIndex);
}
