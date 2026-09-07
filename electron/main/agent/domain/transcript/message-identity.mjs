/** Bind protocol identities to a Main-owned submission before content is materialized. */
export function associateAgentUserMessage(event, control) {
  if (!['turn.started', 'user.message'].includes(event.type) || event.payload?.restored) return event;
  const clientId = event.payload?.clientUserMessageId ?? event.payload?.userMessageId;
  let command = clientId
    ? control.commands.find(entry => entry.kind === 'start' && entry.userMessageId === clientId)
    : null;
  if (!command && event.type === 'turn.started' && control.pendingSubmission) {
    command = control.commands.find(entry => entry.commandId === control.pendingSubmission.commandId);
  }
  if (!command?.intent) return event;
  return {
    ...event,
    payload: {
      ...event.payload,
      userMessageId: command.userMessageId,
      submissionId: command.commandId,
      ...(event.type === 'turn.started' ? { prompt: command.intent.prompt } : { text: command.intent.prompt }),
      referenceDisplays: command.intent.referenceDisplays,
      promptMentions: command.intent.promptMentions,
    },
  };
}

/** A client id confirms a submission; a native item id identifies the echoed object. */
export function findAgentUserMessage(messages, event) {
  const clientId = event.payload?.userMessageId ?? event.payload?.clientUserMessageId;
  const submissionId = event.payload?.submissionId;
  return messages.findIndex(message => message.role === 'user' && (
    (submissionId && message.submissionId === submissionId)
    || (clientId && (message.clientUserMessageId === clientId || message.id === `user:${clientId}`))
    || (event.itemId && message.itemId === event.itemId)
  ));
}
