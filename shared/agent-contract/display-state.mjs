/** Process-neutral display data operations. They never interpret Harness events. */
export const DISPLAY_COLLECTION_KEYS = Object.freeze({
  messages: 'id', activities: 'id', approvals: 'requestId', questions: 'requestId',
  turns: 'id', parts: 'id', rows: 'id',
});
export const DISPLAY_VALUE_KEYS = Object.freeze([
  'sessionState', 'lastSequence', 'history', 'displayWindow', 'missingRanges',
  'connectionStatus', 'runningTurnId', 'terminalState', 'usage', 'presentation',
]);

export function createEmptyAgentDisplay() {
  return {
    schemaVersion: 1, sessionState: 'empty', lastSequence: 0,
    history: { coverage: 'not-requested', reason: null }, displayWindow: { truncated: false },
    missingRanges: [], messages: [], activities: [], approvals: [], questions: [],
    turns: [], parts: [], rows: [], connectionStatus: null, runningTurnId: null,
    terminalState: null, usage: null,
    presentation: { phase: "ready", terminalState: "idle", pendingPrompt: null, submitting: false, stopping: false },
  };
}

/** Main computes structural changes; a replica only applies these committed changes. */
export function createAgentDisplayPatch(previous, next) {
  const values = {};
  for (const key of DISPLAY_VALUE_KEYS) if (!equal(previous[key], next[key])) values[key] = next[key];
  const collections = {};
  for (const [key, identity] of Object.entries(DISPLAY_COLLECTION_KEYS)) {
    const before = new Map(previous[key].map(entry => [entry[identity], entry]));
    const after = new Set(next[key].map(entry => entry[identity]));
    const remove = previous[key].filter(entry => !after.has(entry[identity])).map(entry => entry[identity]);
    const upsert = [];
    const update = [];
    for (const entry of next[key]) {
      const old = before.get(entry[identity]);
      if (!old) { upsert.push(entry); continue; }
      if (equal(old, entry)) continue;
      const changes = {};
      const append = {};
      for (const field of Object.keys(entry)) {
        if (equal(old[field], entry[field])) continue;
        if (['text', 'output', 'label'].includes(field) && typeof old[field] === 'string' && typeof entry[field] === 'string'
          && old[field].length > 128 && entry[field].startsWith(old[field])) {
          append[field] = { offset: old[field].length, text: entry[field].slice(old[field].length) };
        } else changes[field] = entry[field];
      }
      const unset = Object.keys(old).filter(field => !(field in entry));
      update.push({ id: entry[identity], changes, append, unset });
    }
    if (remove.length || upsert.length || update.length) {
      const oldOrder = previous[key].map(entry => entry[identity]);
      const newOrder = next[key].map(entry => entry[identity]);
      collections[key] = { remove, upsert, update, ...(equal(oldOrder, newOrder) ? {} : { order: newOrder }) };
    }
  }
  return { schemaVersion: 1, values, collections };
}

export function applyAgentDisplayPatch(previous, patch) {
  const next = { ...previous, ...patch.values };
  for (const [key, delta] of Object.entries(patch.collections)) {
    const identity = DISPLAY_COLLECTION_KEYS[key];
    if (!identity) throw new TypeError('Unknown Agent display collection.');
    const entries = new Map(previous[key].map(entry => [entry[identity], entry]));
    for (const id of delta.remove) entries.delete(id);
    for (const entry of delta.upsert) entries.set(entry[identity], entry);
    for (const update of delta.update) {
      const old = entries.get(update.id);
      if (!old) throw new TypeError('Agent display update target is missing.');
      const entry = { ...old, ...update.changes };
      for (const field of update.unset) delete entry[field];
      for (const [field, suffix] of Object.entries(update.append)) {
        if (typeof old[field] !== 'string' || old[field].length !== suffix.offset) {
          throw new TypeError('Agent display text revision is stale.');
        }
        entry[field] = old[field] + suffix.text;
      }
      entries.set(update.id, entry);
    }
    if (delta.order) {
      if (delta.order.length !== entries.size || new Set(delta.order).size !== entries.size) throw new TypeError('Invalid Agent display order.');
      next[key] = delta.order.map(id => {
        if (!entries.has(id)) throw new TypeError('Agent display order target is missing.');
        return entries.get(id);
      });
    } else next[key] = [...entries.values()];
  }
  return next;
}

function equal(a, b) { return a === b || JSON.stringify(a) === JSON.stringify(b); }
