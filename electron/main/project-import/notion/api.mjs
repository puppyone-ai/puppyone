import { setTimeout as delay } from 'node:timers/promises';

export const NOTION_VERSION = '2026-03-11';
export function checkCancelled(signal) {
  if (signal?.aborted) throw new Error('Notion import cancelled.');
}
export async function readBounded(response, limit, signal) {
  if (!response.body || Number(response.headers.get('content-length') || 0) > limit) throw new Error('Notion response exceeds the size limit.');
  const chunks = []; let size = 0;
  try {
    for await (const chunk of response.body) {
      checkCancelled(signal);
      size += chunk.length;
      if (size > limit) throw new Error('Notion response exceeds the size limit.');
      chunks.push(Buffer.from(chunk));
    }
  } catch (error) { await response.body.cancel().catch(() => {}); throw error; }
  return Buffer.concat(chunks);
}
export function createNotionApi({ accessToken, fetchImpl = globalThis.fetch, signal }) {
  if (typeof accessToken !== 'string' || !accessToken) throw new Error('Reconnect Notion and try again.');
  return async function request(route, body) {
    if (!/^\/(pages|blocks|databases|data_sources|search)(\/|\?|$)/.test(route)) throw new Error('Invalid Notion API route.');
    for (let attempt = 0; attempt < 4; attempt++) {
      checkCancelled(signal);
      const response = await fetchImpl('https://api.notion.com/v1' + route, {
        method: body === undefined ? 'GET' : 'POST', redirect: 'error',
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000),
        headers: { Authorization: 'Bearer ' + accessToken, 'Notion-Version': NOTION_VERSION, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if ((response.status === 429 || response.status >= 500) && attempt < 3) {
        const retry = Number(response.headers.get('retry-after') || 1);
        await response.body?.cancel();
        await delay(Math.min(30, Math.max(1, Number.isFinite(retry) ? retry : 1)) * 1000, undefined, { signal });
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        const error = new Error(response.status === 401 ? 'Notion authorization expired. Reconnect Notion.' : 'Notion could not read this resource (HTTP ' + response.status + ').');
        error.status = response.status;
        throw error;
      }
      return JSON.parse((await readBounded(response, 16 * 1024 * 1024, signal)).toString('utf8'));
    }
  };
}
export async function* paginate(request, route, body) {
  let cursor = null; const seen = new Set();
  do {
    const page = body === undefined
      ? await request(route + '?page_size=100' + (cursor ? '&start_cursor=' + encodeURIComponent(cursor) : ''))
      : await request(route, { ...body, page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) });
    if (!Array.isArray(page.results)) throw new Error('Notion returned an invalid resource list.');
    yield page;
    cursor = page.has_more ? page.next_cursor : null;
    if (page.has_more && (typeof cursor !== 'string' || !cursor || seen.has(cursor))) throw new Error('Notion returned an invalid pagination cursor.');
    seen.add(cursor);
  } while (cursor);
}
export function requireNotionId(id) {
  if (typeof id !== 'string' || !/^(?:[0-9a-f]{32}|[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})$/i.test(id)) throw new Error('Invalid Notion resource ID.');
  return id;
}
export function notionTitle(object) {
  const title = object.title ?? Object.values(object.properties ?? {}).find(p => p.type === 'title')?.title ?? [];
  return title.map(item => item.plain_text ?? item.text?.content ?? '').join('') || 'Untitled';
}
export function portableTitle(title) {
  let name = title.normalize('NFC').replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '_').replace(/[. ]+$/g, '').slice(0, 64).trim();
  if (!name || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = 'Notion ' + name;
  return name;
}
