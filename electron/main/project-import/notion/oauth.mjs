import { randomBytes } from 'node:crypto';
import { startLoopbackCallbackServer } from '../../auth/loopback-callback-server.mjs';
import { setTimeout as delay } from 'node:timers/promises';
import { readBounded } from './api.mjs';

export const NOTION_OAUTH_ORIGIN = 'https://notion-connect.puppyone.ai';
export function createNotionConnector({ origin = NOTION_OAUTH_ORIGIN, fetchImpl = globalThis.fetch, startCallback = startLoopbackCallbackServer, pollIntervalMs = 2000, timeoutMs = 5 * 60 * 1000 } = {}) {
  const broker = new URL(origin);
  if (broker.origin !== origin || (broker.protocol !== 'https:' && !(broker.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(broker.hostname)))) throw new Error('Invalid Notion authorization service origin.');
  return async function connect({ openExternal, ownerWindow, signal: outerSignal } = {}) {
    if (typeof openExternal !== 'function') throw new Error('Open Notion authorization from the Desktop app.');
    const controller = new AbortController();
    const closed = () => controller.abort();
    ownerWindow?.once('closed', closed);
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(timeoutMs), ...(outerSignal ? [outerSignal] : [])]);
    let session = null; let loopback = null; let proof = null;
    const clientState = randomBytes(32).toString('hex');
    let acceptCallback; let rejectCallback;
    const receivedCallback = new Promise((resolve, reject) => { acceptCallback = resolve; rejectCallback = reject; });
    receivedCallback.catch(() => {});
    const cancelled = () => rejectCallback(new Error('Notion authorization cancelled.'));
    signal.addEventListener('abort', cancelled, { once: true });
    const headers = () => ({ Authorization: 'Bearer ' + session.pollToken, ...(proof ? { 'X-Notion-Handoff': proof } : {}) });
    const fetchSession = (route, init = {}) => fetchImpl(origin + route, { ...init, redirect: 'error', signal });
    async function redeem() {
      for (;;) {
        const response = await fetchSession('/sessions/' + session.sessionId, { headers: headers() });
        if (response.status === 202) { await response.body?.cancel(); await delay(pollIntervalMs, undefined, { signal }); continue; }
        const value = JSON.parse((await readBounded(response, 16384, signal)).toString('utf8'));
        if (!response.ok) throw new Error(typeof value.error === 'string' ? value.error.slice(0, 200) : 'Notion authorization failed. Reconnect and try again.');
        if (typeof value.accessToken !== 'string' || !value.accessToken || value.accessToken.length > 4096) throw new Error('Invalid Notion authorization response.');
        return { accessToken: value.accessToken, workspaceId: value.workspaceId ?? null };
      }
    }
    try {
      loopback = await startCallback({
        isExpectedCallback: value => {
          const url = new URL(value);
          return url.searchParams.getAll('state').length === 1 && url.searchParams.get('state') === clientState
            && url.searchParams.getAll('proof').length === 1 && /^[a-f0-9]{64}$/.test(url.searchParams.get('proof'));
        },
        onCallback: async value => {
          try {
            proof = new URL(value).searchParams.get('proof');
            const result = await redeem(); acceptCallback(result); return {};
          } catch (error) { rejectCallback(error); throw error; }
        },
      });
      let response;
      try { response = await fetchSession('/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ callbackUri: loopback.redirectUri + '?state=' + clientState }) }); }
      catch { throw new Error('Notion authorization service is unavailable. Configure the service before connecting.'); }
      if (!response.ok) { await response.body?.cancel(); throw new Error('Notion authorization service is not configured or is unavailable.'); }
      session = JSON.parse((await readBounded(response, 16384, signal)).toString('utf8'));
      if (!/^[a-f0-9-]{36}$/.test(session.sessionId) || !/^[a-f0-9]{64}$/.test(session.pollToken)) throw new Error('Invalid Notion authorization session.');
      const authorize = new URL(session.authorizationUrl);
      if (authorize.origin !== 'https://api.notion.com' || authorize.pathname !== '/v1/oauth/authorize' || authorize.username || authorize.password
        || authorize.searchParams.get('redirect_uri') !== origin + '/callback' || !authorize.searchParams.get('state')?.startsWith(session.sessionId + '.')) throw new Error('Invalid Notion authorization destination.');
      await openExternal(authorize.href);
      if (signal.aborted) throw new Error("Notion authorization cancelled.");
      return await receivedCallback;
    } catch (error) {
      if (signal.aborted) throw new Error('Notion authorization cancelled or timed out. Connect again when ready.');
      throw error;
    } finally {
      ownerWindow?.removeListener('closed', closed);
      signal.removeEventListener('abort', cancelled);
      await loopback?.close().catch(() => {});
      if (session && /^[a-f0-9-]{36}$/.test(session.sessionId)) {
        await fetchImpl(origin + '/sessions/' + session.sessionId, { method: 'DELETE', headers: headers(), redirect: 'error', signal: AbortSignal.timeout(5000) }).then(response => response.body?.cancel()).catch(() => {});
      }
    }
  };
}
