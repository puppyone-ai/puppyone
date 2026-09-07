import type {
  AgentDraftReference,
  AgentPromptReferenceMention,
  AgentSubmissionIntent,
} from "../domain/agent-contract";
import type { AgentClientPort, AgentClientProvider } from "./AgentClientPort";
import type { AgentControllerState } from "./agent-controller-state";
import { AgentKnownError, createAgentError, formatAgentError } from "./agent-error";
import type { AgentReferenceDraftManager } from "./AgentReferenceDraftManager";

type AgentTurnSubmissionCoordinatorOptions = {
  workspaceRoot: string;
  bridgeProvider: AgentClientProvider;
  references: AgentReferenceDraftManager;
  readState: () => AgentControllerState;
  patch: (patch: Partial<AgentControllerState>) => void;
  writeDraft: (draft: string, mentions: AgentPromptReferenceMention[]) => void;
  prepareSession: () => Promise<boolean>;
};

/** Captures and advances immutable prompt/configuration/reference intents. */
export class AgentTurnSubmissionCoordinator {
  constructor(private readonly options: AgentTurnSubmissionCoordinatorOptions) {}

  async submit(prompt: string) {
    const bridge = this.requireBridge("startAgentTurn");
    const state = this.options.readState();
    const normalized = normalizeSubmissionDraft(prompt, state.draftMentions);
    const text = normalized.prompt;
    const attachmentOnly = state.references.length > 0
      && state.inspection?.capabilities?.referenceInputs?.attachmentOnly === true;
    if ((!text && !attachmentOnly) || state.submitting || state.pendingIntent) return false;
    if (state.references.some((reference) => reference.status !== "ready")) {
      this.options.patch({ error: createAgentError("references-not-ready") });
      return false;
    }
    if (state.inspection?.capabilities?.modelSelection && !state.selectedModel) {
      this.options.patch({ error: createAgentError("model-required") });
      return false;
    }
    const intent = createSubmissionIntent({
      referenceEpoch: this.options.references.referenceEpoch,
      prompt: text,
      model: state.selectedModel,
      effort: state.selectedEffort,
      mode: state.selectedMode,
      references: state.references,
      promptMentions: normalized.mentions,
    });
    const activeTurnId = state.projection.runningTurnId;
    if (activeTurnId && state.session && state.inspection?.capabilities?.steer && bridge.steerAgentTurn) {
      if (intent.references.length > 0 && state.inspection.capabilities.referenceInputs?.steer !== true) {
        this.options.patch({ error: createAgentError("steer-references-unsupported") });
        return false;
      }
      try {
        await bridge.steerAgentTurn({
          rootPath: this.options.workspaceRoot,
          sessionId: state.session.id,
          commandId: intent.id,
          turnId: activeTurnId,
          ...commandPreconditions(state),
          message: text,
          referenceEpoch: intent.referenceEpoch,
          references: intent.references,
          promptMentions: intent.promptMentions,
        });
        this.options.references.releasePreviews(intent.references);
        this.options.patch({ draft: "", draftMentions: [], references: [], error: null });
        this.options.writeDraft("", []);
        return true;
      } catch (error) {
        this.options.patch({ error: formatAgentError(error) });
        return false;
      }
    }
    if (activeTurnId && state.inspection?.capabilities?.queue) {
      return this.startIntent(intent, true);
    }
    if (activeTurnId) return false;
    return this.startIntent(intent, true);
  }

  private async startIntent(intent: AgentSubmissionIntent, captureCurrentDraft: boolean) {
    const bridge = this.requireBridge("startAgentTurn");
    this.options.patch({
      submitting: true,
      pendingPrompt: intent.prompt,
      pendingIntent: intent,
      ...(captureCurrentDraft ? { draft: "", draftMentions: [], references: [] } : {}),
      error: null,
    });
    if (captureCurrentDraft) this.options.writeDraft("", []);
    try {
      let session = this.options.readState().session;
      if (!session) {
        const prepared = await this.options.prepareSession();
        session = this.options.readState().session;
        if (!prepared || !session) return this.restorePreparationFailure(intent, captureCurrentDraft);
      }
      await bridge.startAgentTurn({
        rootPath: this.options.workspaceRoot,
        sessionId: session.id,
        commandId: intent.id,
        ...commandPreconditions(this.options.readState()),
        prompt: intent.prompt,
        model: intent.model,
        effort: intent.effort,
        mode: intent.mode,
        referenceEpoch: intent.referenceEpoch,
        references: intent.references,
        promptMentions: intent.promptMentions,
      });
      this.options.references.releasePreviews(intent.references);
      // The request result is a delivery acknowledgement, not execution
      // authority. turn.started/terminal facts alone drive the visible phase.
      return true;
    } catch (error) {
      const observed = this.options.readState();
      const command = observed.control?.commands.find(entry => entry.commandId === intent.id);
      const accepted = Boolean(command && ["accepted", "outcome-unknown"].includes(command.status))
        || observed.projection.messages.some(message => message.submissionId === intent.id);
      if (accepted) this.options.references.releasePreviews(intent.references);
      if (!captureCurrentDraft && !accepted) {
        const state = this.options.readState();
        const restored = mergeFailedDraft(intent, state.draft, state.draftMentions);
        this.options.patch({
          pendingPrompt: null,
          pendingIntent: null,
          draft: restored.prompt,
          draftMentions: restored.mentions,
          references: this.options.references.mergeAndValidate(intent.references, state.references),
          error: formatAgentError(error),
        });
        this.options.writeDraft(restored.prompt, restored.mentions);
        return false;
      }
      const state = this.options.readState();
      const restored = mergeFailedDraft(intent, state.draft, state.draftMentions);
      this.options.patch({
        pendingPrompt: null,
        pendingIntent: null,
        ...(accepted ? {} : {
          draft: restored.prompt,
          draftMentions: restored.mentions,
          references: this.options.references.mergeAndValidate(intent.references, state.references),
        }),
        error: formatAgentError(error),
      });
      if (!accepted) this.options.writeDraft(restored.prompt, restored.mentions);
      return false;
    } finally {
      if (this.options.readState().pendingIntent?.id === intent.id) {
        this.options.patch({ submitting: false, pendingIntent: null, pendingPrompt: null });
      }
    }
  }

  private restorePreparationFailure(intent: AgentSubmissionIntent, captureCurrentDraft: boolean) {
    const state = this.options.readState();
    const preparationError = state.error ?? createAgentError("session-prepare-failed");
    if (!captureCurrentDraft) {
      const restored = mergeFailedDraft(intent, state.draft, state.draftMentions);
      this.options.patch({
        pendingPrompt: null,
        pendingIntent: null,
        draft: restored.prompt,
        draftMentions: restored.mentions,
        references: this.options.references.mergeAndValidate(intent.references, state.references),
        error: preparationError,
      });
      this.options.writeDraft(restored.prompt, restored.mentions);
      return false;
    }
    const restored = mergeFailedDraft(intent, state.draft, state.draftMentions);
    this.options.patch({
      pendingPrompt: null,
      pendingIntent: null,
      draft: restored.prompt,
      draftMentions: restored.mentions,
      references: this.options.references.mergeAndValidate(intent.references, state.references),
      error: preparationError,
    });
    this.options.writeDraft(restored.prompt, restored.mentions);
    return false;
  }

  private requireBridge<K extends keyof AgentClientPort>(...methods: K[]): AgentClientPort {
    const bridge = this.options.bridgeProvider();
    if (!bridge || methods.some((method) => typeof bridge[method] !== "function")) {
      throw new AgentKnownError("native-bridge-unavailable");
    }
    return bridge;
  }
}

function commandPreconditions(state: AgentControllerState) {
  const control = state.control;
  if (!control) return {};
  return {
    expectedSessionEpoch: control.sessionEpoch,
    expectedAdapterGeneration: control.adapterGeneration,
    expectedRunGeneration: control.runGeneration,
  };
}

function createSubmissionIntent({
  referenceEpoch,
  prompt,
  model,
  effort,
  mode,
  references,
  promptMentions,
}: Omit<AgentSubmissionIntent, "id">): AgentSubmissionIntent {
  const identity = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return {
    id: `intent-${identity}`,
    referenceEpoch,
    prompt,
    model,
    effort,
    mode,
    references: references.map((reference: AgentDraftReference) => ({
      ...reference,
      ...(reference.error ? { error: { ...reference.error } } : {}),
    })),
    promptMentions: promptMentions.map((mention) => ({ ...mention })),
  };
}

function normalizeSubmissionDraft(prompt: string, mentions: AgentPromptReferenceMention[]) {
  const leading = prompt.length - prompt.trimStart().length;
  const trailingBoundary = prompt.trimEnd().length;
  const normalizedPrompt = prompt.slice(leading, trailingBoundary);
  return {
    prompt: normalizedPrompt,
    mentions: mentions.flatMap((mention) => (
      mention.start >= leading && mention.end <= trailingBoundary
        ? [{ ...mention, start: mention.start - leading, end: mention.end - leading }]
        : []
    )),
  };
}

function mergeFailedDraft(
  failed: Pick<AgentSubmissionIntent, "prompt" | "promptMentions">,
  currentPrompt: string,
  currentMentions: AgentPromptReferenceMention[],
) {
  if (!currentPrompt) return { prompt: failed.prompt, mentions: failed.promptMentions.map((mention) => ({ ...mention })) };
  if (currentPrompt === failed.prompt) return { prompt: currentPrompt, mentions: currentMentions };
  const separator = "\n\n";
  const offset = failed.prompt.length + separator.length;
  return {
    prompt: `${failed.prompt}${separator}${currentPrompt}`,
    mentions: [
      ...failed.promptMentions.map((mention) => ({ ...mention })),
      ...currentMentions.map((mention) => ({
        ...mention,
        start: mention.start + offset,
        end: mention.end + offset,
      })),
    ],
  };
}
