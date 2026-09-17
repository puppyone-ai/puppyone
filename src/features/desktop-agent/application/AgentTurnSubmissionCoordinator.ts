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
  private activeIntentId: string | null = null;
  private disposed = false;

  constructor(private readonly options: AgentTurnSubmissionCoordinatorOptions) {}

  /** Detach local receipts when the owning conversation is replaced. */
  invalidate() {
    this.activeIntentId = null;
    this.options.patch({ submitting: false, pendingIntent: null, pendingPrompt: null });
  }

  dispose() {
    this.disposed = true;
    this.activeIntentId = null;
  }

  async submit(prompt: string) {
    if (this.disposed || this.activeIntentId) return false;
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
      return this.dispatchIntent(intent, async (sessionId) => {
        await bridge.steerAgentTurn!({
          rootPath: this.options.workspaceRoot,
          sessionId,
          commandId: intent.id,
          turnId: activeTurnId,
          ...commandPreconditions(state),
          message: text,
          referenceEpoch: intent.referenceEpoch,
          references: intent.references,
          promptMentions: intent.promptMentions,
        });
      });
    }
    if (activeTurnId && !state.inspection?.capabilities?.queue) return false;
    return this.dispatchIntent(intent, async (sessionId) => {
      await bridge.startAgentTurn({
        rootPath: this.options.workspaceRoot,
        sessionId,
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
    });
  }

  /** Starts an explicit follow-up without consuming the user's independent draft or references. */
  async continueFromRecovery(turnId: string, prompt: string) {
    if (this.disposed || this.activeIntentId) return false;
    const bridge = this.requireBridge("startAgentTurn");
    const state = this.options.readState();
    const latestTurn = state.projection.turns.at(-1);
    const text = prompt.trim();
    if (!text || !state.session || state.submitting || state.pendingIntent || state.projection.runningTurnId) return false;
    if (latestTurn?.id !== turnId || latestTurn.status !== "completed"
      || latestTurn.completionQuality !== "degraded"
      || latestTurn.recovery?.kind !== "degraded-completion") return false;
    if (state.inspection?.capabilities?.modelSelection && !state.selectedModel) {
      this.options.patch({ error: createAgentError("model-required") });
      return false;
    }
    const intent = createSubmissionIntent({
      recoveryOfTurnId: turnId,
      referenceEpoch: this.options.references.referenceEpoch,
      prompt: text,
      model: state.selectedModel,
      effort: state.selectedEffort,
      mode: state.selectedMode,
      references: [],
      promptMentions: [],
    });
    return this.dispatchIntent(intent, async (sessionId) => {
      await bridge.startAgentTurn({
        rootPath: this.options.workspaceRoot,
        sessionId,
        commandId: intent.id,
        recoveryOfTurnId: turnId,
        ...commandPreconditions(this.options.readState()),
        prompt: intent.prompt,
        model: intent.model,
        effort: intent.effort,
        mode: intent.mode,
        referenceEpoch: intent.referenceEpoch,
        references: [],
        promptMentions: [],
      });
    }, { preserveDraft: true });
  }

  private async dispatchIntent(
    intent: AgentSubmissionIntent,
    dispatch: (sessionId: string) => Promise<void>,
    { preserveDraft = false }: { preserveDraft?: boolean } = {},
  ) {
    this.activeIntentId = intent.id;
    let sessionId = this.options.readState().session?.id ?? null;
    const isCurrent = () => !this.disposed && this.activeIntentId === intent.id
      && this.options.references.referenceEpoch === intent.referenceEpoch
      && (!sessionId || this.options.readState().session?.id === sessionId);
    this.options.patch({
      submitting: true,
      pendingPrompt: intent.prompt,
      pendingIntent: intent,
      ...(!preserveDraft ? { draft: "", draftMentions: [], references: [] } : {}),
      error: null,
    });
    if (!preserveDraft) this.options.writeDraft("", []);
    try {
      if (!sessionId) {
        const prepared = await this.options.prepareSession();
        if (!isCurrent()) return false;
        sessionId = this.options.readState().session?.id ?? null;
        if (!prepared || !sessionId) {
          this.restoreDraft(intent, this.options.readState().error ?? createAgentError("session-prepare-failed"));
          return false;
        }
      }
      await dispatch(sessionId);
      if (!isCurrent()) return false;
      this.releaseSubmittedPreviews(intent);
      // The request result is a delivery acknowledgement, not execution
      // authority. turn.started/terminal facts alone drive the visible phase.
      return true;
    } catch (error) {
      if (!isCurrent()) return false;
      const observed = this.options.readState();
      const command = observed.control?.commands.find(entry => entry.commandId === intent.id);
      // A visible input proves local admission, not native delivery. Only Main's
      // delivery state determines whether a failed request may restore the draft.
      const accepted = Boolean(command && ["queued", "dispatching", "accepted", "outcome-unknown"].includes(command.status));
      if (accepted) {
        this.releaseSubmittedPreviews(intent);
        this.options.patch({ error: formatAgentError(error) });
      } else if (!preserveDraft) {
        this.restoreDraft(intent, formatAgentError(error));
      } else {
        this.options.patch({ error: formatAgentError(error) });
      }
      return false;
    } finally {
      // Local ownership, rather than the optional presentation field, releases
      // the lock even after preparation fails without creating a Main session.
      if (!this.disposed && this.activeIntentId === intent.id) {
        this.activeIntentId = null;
        this.options.patch({ submitting: false, pendingIntent: null, pendingPrompt: null });
      }
    }
  }

  private releaseSubmittedPreviews(intent: AgentSubmissionIntent) {
    const retainedIds = new Set(this.options.readState().references.map(reference => reference.id));
    this.options.references.releasePreviews(intent.references.filter(reference => !retainedIds.has(reference.id)));
  }

  private restoreDraft(intent: AgentSubmissionIntent, error: AgentControllerState["error"]) {
    const state = this.options.readState();
    const restored = mergeFailedDraft(intent, state.draft, state.draftMentions);
    this.options.patch({
      draft: restored.prompt,
      draftMentions: restored.mentions,
      references: this.options.references.mergeAndValidate(intent.references, state.references),
      error,
    });
    this.options.writeDraft(restored.prompt, restored.mentions);
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
  if (!failed.prompt) return { prompt: currentPrompt, mentions: currentMentions };
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
