import { assertArray, assertRecord, contractError, enumValue, nonNegativeInteger, requiredString } from './validation.mjs';
import { DISPLAY_COLLECTION_KEYS, DISPLAY_VALUE_KEYS } from './display-state.mjs';

export const agentDisplayLimits = Object.freeze({ maxEntries: 2_000, maxNodes: 100_000, maxBytes: 8 * 1024 * 1024, maxText: 128 * 1024 });
const PART_KINDS = ['user', 'assistant', 'turn-summary', 'tool', 'command', 'file-change', 'plan', 'reasoning', 'warning', 'error', 'usage', 'permission', 'question', 'unknown'];
const ACTIVITY_STATUSES = ['queued', 'running', 'pending', 'in-progress', 'waiting-for-user', 'completed', 'succeeded', 'failed', 'warning', 'blocked', 'cancelled', 'interrupted', 'unknown'];
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function assertAgentDisplay(value) {
  const display = assertRecord(value, 'Agent display');
  if (display.schemaVersion !== 1) throw contractError('Agent display.schemaVersion', 'must equal 1');
  validateValues(display, true);
  for (const [key, identity] of Object.entries(DISPLAY_COLLECTION_KEYS)) {
    const entries = boundedArray(display[key], key);
    const ids = new Set();
    for (const entry of entries) {
      validateEntry(key, entry);
      const id = entry[identity];
      if (ids.has(id)) throw contractError(key, 'contains duplicate identities');
      ids.add(id);
    }
  }
  const partIds = new Set(display.parts.map(part => part.id));
  for (const row of display.rows) if (!partIds.has(row.partId)) throw contractError('rows.partId', 'must reference a retained part');
  assertSafeJson(display);
  return value;
}

export function assertAgentDisplayPatch(value) {
  const patch = assertRecord(value, 'Agent display patch');
  if (patch.schemaVersion !== 1) throw contractError('Agent display patch.schemaVersion', 'must equal 1');
  const values = assertRecord(patch.values, 'display patch values');
  for (const key of Object.keys(values)) if (!DISPLAY_VALUE_KEYS.includes(key)) throw contractError(key, 'is not a display value');
  validateValues(values, false);
  for (const [key, delta] of Object.entries(assertRecord(patch.collections, 'display collections'))) {
    if (!Object.hasOwn(DISPLAY_COLLECTION_KEYS, key)) throw contractError(key, 'is not a display collection');
    assertRecord(delta, key);
    for (const id of boundedArray(delta.remove, key)) idValue(id);
    for (const entry of boundedArray(delta.upsert, key)) validateEntry(key, entry);
    for (const update of boundedArray(delta.update, key)) {
      assertRecord(update, key); idValue(update.id);
      const changes = assertRecord(update.changes, key);
      if (Object.hasOwn(changes, DISPLAY_COLLECTION_KEYS[key])) throw contractError(key, 'cannot change an identity');
      for (const field of boundedArray(update.unset, key)) {
        idValue(field);
        if (field === DISPLAY_COLLECTION_KEYS[key]) throw contractError(key, 'cannot remove an identity');
      }
      for (const [field, append] of Object.entries(assertRecord(update.append, key))) {
        if (!['text', 'output', 'label'].includes(field)) throw contractError(field, 'is not an appendable display field');
        assertRecord(append, field); nonNegativeInteger(append.offset, field); textValue(append.text, field);
      }
    }
    if (delta.order !== undefined) for (const id of boundedArray(delta.order, key)) idValue(id);
  }
  assertSafeJson(patch);
  return value;
}

function validateValues(value, complete) {
  const has = key => complete || Object.hasOwn(value, key);
  if (has('presentation')) {
    const view = assertRecord(value.presentation, 'presentation');
    enumValue(view.phase, 'presentation.phase', ['ready', 'creating', 'running', 'waiting', 'runtime-exited']);
    enumValue(view.terminalState, 'presentation.terminalState', ['idle', 'running', 'outcome-unknown', 'provider-exited', 'completed', 'failed', 'interrupted']);
    if (view.pendingPrompt !== null) textValue(view.pendingPrompt, 'presentation.pendingPrompt');
    for (const key of ['submitting', 'stopping']) if (typeof view[key] !== 'boolean') throw contractError(key, 'must be boolean');
  }
  if (has('sessionState')) enumValue(value.sessionState, 'sessionState', ['empty', 'active', 'closed']);
  if (has('lastSequence')) nonNegativeInteger(value.lastSequence, 'lastSequence');
  if (has('history')) {
    const history = assertRecord(value.history, 'history');
    enumValue(history.coverage, 'history.coverage', ['not-requested', 'complete', 'partial', 'unknown']);
    if (history.reason !== null) enumValue(history.reason, 'history.reason', ['read-limit', 'replay-unverified', 'unsupported', 'unverified']);
    if (['not-requested', 'complete'].includes(history.coverage) && history.reason !== null) {
      throw contractError('history.reason', 'must be null for complete or unrequested history');
    }
  }
  if (has('displayWindow')) {
    const window = assertRecord(value.displayWindow, 'displayWindow');
    if (typeof window.truncated !== 'boolean') throw contractError('displayWindow.truncated', 'must be boolean');
  }
  if (has('runningTurnId') && value.runningTurnId !== null) idValue(value.runningTurnId);
  if (has('terminalState') && value.terminalState !== null) enumValue(value.terminalState, 'terminalState', ['completed', 'failed', 'interrupted']);
  if (has('missingRanges')) for (const range of boundedArray(value.missingRanges, 'missingRanges')) {
    nonNegativeInteger(range.from, 'missingRanges.from'); nonNegativeInteger(range.to, 'missingRanges.to');
    if (range.to < range.from) throw contractError('missingRanges', 'must be ordered');
  }
  if (has('connectionStatus') && value.connectionStatus !== null) {
    assertRecord(value.connectionStatus, 'connectionStatus');
    enumValue(value.connectionStatus.state, 'connectionStatus.state', ['reconnecting', 'fallback']);
    textValue(value.connectionStatus.message, 'connectionStatus.message');
  }
}

function validateEntry(key, entry) {
  assertRecord(entry, key); idValue(entry[DISPLAY_COLLECTION_KEYS[key]]);
  if (key === 'messages' || key === 'parts') {
    if (entry.truncated !== undefined && typeof entry.truncated !== 'boolean') throw contractError(key+'.truncated', 'must be boolean');
    if (entry.deliveryStatus !== undefined) enumValue(entry.deliveryStatus, key+'.deliveryStatus', ['queued', 'dispatching', 'accepted', 'rejected', 'cancelled', 'outcome-unknown']);
  }
  if (key !== 'turns') nonNegativeInteger(entry.sequence, key+'.sequence');
  if (key === 'messages') {
    enumValue(entry.role, 'message.role', ['user', 'assistant']); textValue(entry.text, 'message.text');
    if (typeof entry.streaming !== 'boolean') throw contractError(key, 'requires streaming');
  } else if (key === 'parts' || key === 'rows') {
    enumValue(entry.kind, key+'.kind', PART_KINDS);
    if (key === 'rows') { idValue(entry.partId); if (!Number.isFinite(entry.estimatedHeight) || entry.estimatedHeight < 0) throw contractError(key, 'requires a valid height'); }
    else if (entry.kind === 'user' || entry.kind === 'assistant') textValue(entry.text, 'part.text');
  } else if (key === 'activities') {
    enumValue(entry.kind, 'activity.kind', ['tool', 'command', 'file-change', 'plan', 'reasoning', 'warning', 'error']);
    enumValue(entry.status, 'activity.status', ACTIVITY_STATUSES); textValue(entry.output, 'activity.output');
  } else if (key === 'approvals' || key === 'questions') {
    if (entry.replyStatus != null) enumValue(entry.replyStatus, key+'.replyStatus', ['queued', 'dispatching', 'accepted', 'rejected', 'cancelled', 'outcome-unknown']);
  } else if (key === 'turns') {
    enumValue(entry.status, 'turn.status', ['running', 'outcome-unknown', 'completed', 'failed', 'interrupted']);
    for (const id of boundedArray(entry.partIds, 'turn.partIds')) idValue(id);
  }
}

function idValue(value) { requiredString(value, 'display identity', 1_024); }
function textValue(value, label) { requiredString(value, label, agentDisplayLimits.maxText, {allowEmpty: true, preserveWhitespace: true}); }
function boundedArray(value, label) {
  const entries = assertArray(value, label);
  if (entries.length > agentDisplayLimits.maxEntries) throw contractError(label, 'exceeds the display window');
  return entries;
}
function assertSafeJson(value) {
  let nodes = 0;
  function walk(entry, depth) {
    if (++nodes > agentDisplayLimits.maxNodes || depth > 18) throw contractError('display', 'exceeds the structural budget');
    if (typeof entry === 'string') { textValue(entry, 'display text'); return; }
    if (entry === null || typeof entry === 'boolean') return;
    if (typeof entry === 'number' && Number.isFinite(entry)) return;
    if (Array.isArray(entry)) { for (const item of entry) walk(item, depth+1); return; }
    if (entry && typeof entry === 'object') {
      for (const [key, item] of Object.entries(entry)) {
        if (UNSAFE_KEYS.has(key)) throw contractError('display', 'contains an unsafe key');
        if (item !== undefined) walk(item, depth+1);
      }
      return;
    }
    throw contractError('display', 'must contain JSON data');
  }
  walk(value, 0);
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > agentDisplayLimits.maxBytes) throw contractError('display', 'exceeds the byte budget');
}
