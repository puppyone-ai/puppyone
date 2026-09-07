/** IPC control metadata. Input bodies and native blocker payloads belong to Main. */
export function projectAgentControlView(control) {
  const blocker = ({ event, questions, ...identity }) => identity;
  const { prompt, promptMentions, referenceDisplays, ...pending } = control.pendingSubmission ?? {};
  return {
    schemaVersion: control.schemaVersion,
    streamId: control.streamId,
    revision: control.revision,
    sessionEpoch: control.sessionEpoch,
    adapterGeneration: control.adapterGeneration,
    runGeneration: control.runGeneration,
    connection: control.connection,
    execution: control.execution,
    recoveries: control.recoveries,
    queue: control.queue,
    terminalTurns: control.terminalTurns,
    commands: control.commands.map(({ intent, ...record }) => ({ ...record, error: record.error?.slice(0, 1024) ?? null })),
    interaction: {
      approvals: control.interaction.approvals.map(blocker),
      questions: control.interaction.questions.map(blocker),
    },
    pendingSubmission: control.pendingSubmission ? pending : null,
  };
}
