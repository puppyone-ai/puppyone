const TURN_PAGE_SIZE = 40;
const ITEM_PAGE_SIZE = 100;
const MAX_TURNS = 200;
const MAX_ITEMS_PER_TURN = 300;
const MAX_PROJECTED_EVENTS = 900;

/**
 * Reads the newest bounded, complete-turn window through Codex's paginated
 * history contract. The returned turns are chronological for presentation.
 */
export async function readCodexPaginatedHistory({ request, threadId }) {
  assertRequest(request);
  const id = requiredId(threadId, "Codex history requires a thread id.");
  const descendingTurns = await readTurnPages(request, id);
  const hydratedDescending = [];
  for (const turn of descendingTurns) {
    hydratedDescending.push(await hydrateTurnItems(request, id, turn));
  }
  return {
    id,
    turns: selectCompleteTurnWindow(hydratedDescending).reverse(),
  };
}

/** Compatibility boundary for Codex releases predating paginated history. */
export async function readCodexHistory({ request, threadId }) {
  try {
    return await readCodexPaginatedHistory({ request, threadId });
  } catch (error) {
    if (!isPaginationMethodUnavailable(error)) throw error;
    const result = await request("thread/read", { threadId, includeTurns: true });
    return result?.thread ?? { id: threadId, turns: [] };
  }
}

/**
 * New Codex versions require resume/fork to avoid eager full-history loading.
 * Retry without the optional field only when an older server rejects that
 * exact field, not for arbitrary resume failures.
 */
export async function requestCodexMetadataOnlyThread({ request, method, params }) {
  assertRequest(request);
  try {
    return await request(method, { ...params, excludeTurns: true });
  } catch (error) {
    if (!isExcludeTurnsUnsupported(error)) throw error;
    return request(method, params);
  }
}

async function readTurnPages(request, threadId) {
  const turns = [];
  const seenTurnIds = new Set();
  const seenCursors = new Set();
  let cursor = null;
  while (turns.length < MAX_TURNS) {
    const result = await request("thread/turns/list", {
      threadId,
      cursor,
      limit: Math.min(TURN_PAGE_SIZE, MAX_TURNS - turns.length),
      sortDirection: "desc",
      itemsView: "full",
    });
    for (const turn of Array.isArray(result?.data) ? result.data : []) {
      const turnId = optionalId(turn?.id);
      if (!turnId || seenTurnIds.has(turnId)) continue;
      seenTurnIds.add(turnId);
      turns.push({ ...turn, id: turnId });
      if (turns.length >= MAX_TURNS) break;
    }
    const nextCursor = optionalId(result?.nextCursor);
    if (!nextCursor) break;
    if (seenCursors.has(nextCursor)) {
      throw new Error("Codex turn history returned a repeated pagination cursor.");
    }
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }
  return turns;
}

async function hydrateTurnItems(request, threadId, turn) {
  if (turn.itemsView === "full") {
    return { ...turn, items: boundedItems(turn.items) };
  }
  const summaryPrompt = Array.isArray(turn.items)
    ? turn.items.find((item) => item?.type === "userMessage") ?? null
    : null;
  const items = [];
  const seenItemIds = new Set();
  const seenCursors = new Set();
  let cursor = null;
  while (items.length < MAX_ITEMS_PER_TURN) {
    const result = await request("thread/items/list", {
      threadId,
      turnId: turn.id,
      cursor,
      limit: Math.min(ITEM_PAGE_SIZE, MAX_ITEMS_PER_TURN - items.length),
      sortDirection: "desc",
    });
    for (const entry of Array.isArray(result?.data) ? result.data : []) {
      if (optionalId(entry?.turnId) !== turn.id || !entry?.item || typeof entry.item !== "object") continue;
      const itemId = optionalId(entry.item.id);
      if (itemId && seenItemIds.has(itemId)) continue;
      if (itemId) seenItemIds.add(itemId);
      items.push(entry.item);
      if (items.length >= MAX_ITEMS_PER_TURN) break;
    }
    const nextCursor = optionalId(result?.nextCursor);
    if (!nextCursor) break;
    if (seenCursors.has(nextCursor)) {
      throw new Error("Codex item history returned a repeated pagination cursor.");
    }
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }
  const chronologicalItems = items.reverse();
  if (summaryPrompt && !chronologicalItems.some((item) => sameItem(item, summaryPrompt))) {
    chronologicalItems.unshift(summaryPrompt);
  }
  return { ...turn, items: boundedItems(chronologicalItems), itemsView: "full" };
}

function boundedItems(value) {
  const items = Array.isArray(value) ? value.filter((item) => item && typeof item === "object") : [];
  if (items.length <= MAX_ITEMS_PER_TURN) return items;
  const recent = items.slice(-(MAX_ITEMS_PER_TURN - 1));
  const firstPrompt = items.find((item) => item.type === "userMessage");
  return firstPrompt && !recent.includes(firstPrompt) ? [firstPrompt, ...recent] : items.slice(-MAX_ITEMS_PER_TURN);
}

function selectCompleteTurnWindow(descendingTurns) {
  const selected = [];
  let projectedEvents = 0;
  for (const turn of descendingTurns) {
    const cost = estimatedProjectedEventCount(turn);
    if (selected.length > 0 && projectedEvents + cost > MAX_PROJECTED_EVENTS) break;
    selected.push(turn);
    projectedEvents += cost;
  }
  return selected;
}

function estimatedProjectedEventCount(turn) {
  return 2 + (Array.isArray(turn?.items) ? turn.items.reduce((count, item) => (
    count + (item?.type === "fileChange" ? 2 : 1)
  ), 0) : 0);
}

function isPaginationMethodUnavailable(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /(?:-32601|method not found|unknown method|unsupported method)/i.test(message)
    && /thread\/(?:turns|items)\/list/i.test(message);
}

function isExcludeTurnsUnsupported(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /excludeTurns/i.test(message) && /(?:unknown|unexpected|unsupported|invalid)/i.test(message);
}

function assertRequest(request) {
  if (typeof request !== "function") throw new TypeError("Codex history reader requires a request function.");
}

function requiredId(value, message) {
  const id = optionalId(value);
  if (!id) throw new Error(message);
  return id;
}

function optionalId(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function sameItem(left, right) {
  const leftId = optionalId(left?.id);
  const rightId = optionalId(right?.id);
  return leftId && rightId ? leftId === rightId : left === right;
}

export const codexHistoryReaderLimits = Object.freeze({
  turnPageSize: TURN_PAGE_SIZE,
  itemPageSize: ITEM_PAGE_SIZE,
  maxTurns: MAX_TURNS,
  maxItemsPerTurn: MAX_ITEMS_PER_TURN,
  maxProjectedEvents: MAX_PROJECTED_EVENTS,
});
