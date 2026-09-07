import { agentDisplayLimits } from '../../../../../shared/agent-contract/display-schema.mjs';
const COLLECTIONS = ['parts', 'rows', 'messages', 'activities', 'turns', 'approvals', 'questions'];
const byteSizes = new WeakMap();
const nodeSizes = new WeakMap();
const encoder = new TextEncoder();

/** Retain a bounded display window independently of unresolved control records. */
export function boundAgentDisplay(display, control) {
  const protectedTurns = new Set([control.execution.activeTurnId, control.execution.uncertainTurnId].filter(Boolean));
  const protectedIds = new Set();
  const pendingInputs = new Set(control.commands.filter(command => ["queued", "dispatching", "outcome-unknown"].includes(command.status)).map(command => command.commandId));
  for (const part of display.parts) if (part.kind === 'user' && pendingInputs.has(part.submissionId)) protectedIds.add(part.id);
  // Keep the current input, rather than every historical follow-up in a long turn.
  for (const turnId of protectedTurns) {
    const input = display.parts.findLast(part => part.kind === 'user' && part.turnId === turnId);
    if (input) protectedIds.add(input.id);
  }
  const requests = new Set([...control.interaction.approvals, ...control.interaction.questions].map(entry => entry.requestId));
  for (const part of display.parts) if ((part.kind === 'permission' || part.kind === 'question') && requests.has(part.requestId)) protectedIds.add(part.id);

  const counts = Object.fromEntries(COLLECTIONS.map(key => [key, display[key].length]));
  let bytes = 0; let nodes = 0;
  for (const key of COLLECTIONS) for (const entry of display[key]) { bytes += size(entry); nodes += nodeCount(entry); }
  const overBudget = () => Object.values(counts).some(count => count > agentDisplayLimits.maxEntries - 32)
    // Leave transport room for control metadata, patch identities and envelope.
    || bytes > agentDisplayLimits.maxBytes - 2 * 1024 * 1024 || nodes > agentDisplayLimits.maxNodes - 8_000;
  if (!overBudget()) return display;

  const mirrors = Object.fromEntries(['messages', 'activities'].map(key => [key, new Map(display[key].map(entry => [entry.id, entry]))]));
  const rows = new Map(display.rows.map(row => [row.partId, row]));
  const turns = new Map(display.turns.map(turn => [turn.id, turn]));
  const turnPartCounts = new Map();
  for (const part of display.parts) turnPartCounts.set(part.turnId, (turnPartCounts.get(part.turnId) ?? 0) + 1);
  const removed = new Set(); const removedTurns = new Set();
  const discard = (key, entry) => { if (entry) { counts[key]--; bytes -= size(entry); nodes -= nodeCount(entry); } };
  for (const turn of display.turns) {
    if (!turnPartCounts.has(turn.id) && !protectedTurns.has(turn.id)) { removedTurns.add(turn.id); discard('turns', turn); }
  }
  for (const part of [...display.parts].sort((a, b) => a.sequence - b.sequence)) {
    if (!overBudget()) break;
    if (protectedIds.has(part.id)) continue;
    removed.add(part.id); discard('parts', part); discard('rows', rows.get(part.id));
    for (const key of ['messages', 'activities']) discard(key, mirrors[key].get(part.id));
    const remaining = (turnPartCounts.get(part.turnId) ?? 1) - 1;
    turnPartCounts.set(part.turnId, remaining);
    if (!remaining && !protectedTurns.has(part.turnId) && turns.has(part.turnId)) {
      removedTurns.add(part.turnId); discard('turns', turns.get(part.turnId));
    }
  }
  if (!removed.size && !removedTurns.size) return display;
  return {
    ...display, displayWindow: { truncated: true },
    parts: display.parts.filter(part => !removed.has(part.id)),
    rows: display.rows.filter(row => !removed.has(row.partId)),
    messages: display.messages.filter(entry => !removed.has(entry.id)),
    activities: display.activities.filter(entry => !removed.has(entry.id)),
    turns: display.turns.filter(turn => !removedTurns.has(turn.id)).map(turn => ({...turn, partIds: turn.partIds.filter(id => !removed.has(id))})),
  };
}

function size(value) {
  let bytes = byteSizes.get(value);
  if (bytes === undefined) { bytes = encoder.encode(JSON.stringify(value)).byteLength; byteSizes.set(value, bytes); }
  return bytes;
}
function nodeCount(value) {
  if (!value || typeof value !== 'object') return 1;
  let count = nodeSizes.get(value);
  if (count === undefined) { count = 1 + Object.values(value).reduce((sum, entry) => sum + nodeCount(entry), 0); nodeSizes.set(value, count); }
  return count;
}
