const LIFETIME_MS = 10 * 60 * 1000;
const ID = /^[a-f0-9-]{36}$/;
const token = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
const json = (value, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
const hash = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2, '0')).join('');
async function smallJson(message, limit = 16384) {
  if (!message.body) throw new Error('Missing JSON body.');
  let size = 0; const chunks = [];
  for await (const chunk of message.body) { size += chunk.length; if (size > limit) throw new Error('JSON body too large.'); chunks.push(chunk); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder().decode(bytes));
}
function requireLoopback(value) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || Number(url.port) < 1024 || !url.port || url.username || url.password || url.hash
    || url.pathname !== '/auth/callback' || url.searchParams.getAll('state').length !== 1
    || [...url.searchParams.keys()].some(key => key !== 'state') || !/^[a-f0-9]{64}$/.test(url.searchParams.get('state'))) throw new Error('Invalid loopback callback.');
  return url.href;
}

/** No content proxy: this broker exchanges OAuth codes only. */
export default {
  async fetch(request, env) {
    if (!env.NOTION_CLIENT_ID || env.NOTION_CLIENT_ID === 'CONFIGURE_BEFORE_DEPLOYMENT' || !env.NOTION_CLIENT_SECRET || !env.PUBLIC_ORIGIN) return json({ error: 'Notion authorization is not configured.' }, 503);
    const url = new URL(request.url);
    const origin = new URL(env.PUBLIC_ORIGIN);
    if (origin.origin !== env.PUBLIC_ORIGIN || origin.protocol !== 'https:' || url.origin !== origin.origin) return json({ error: 'Invalid authorization origin.' }, 400);
    if (url.pathname === '/sessions' && request.method === 'POST') {
      let callbackUri;
      try { callbackUri = requireLoopback((await smallJson(request, 2048)).callbackUri); } catch { return json({ error: 'Invalid Desktop callback.' }, 400); }
      const id = crypto.randomUUID();
      return env.SESSIONS.get(env.SESSIONS.idFromName(id)).fetch(new Request('https://session.internal/create', { method: 'POST', body: JSON.stringify({ id, callbackUri }) }));
    }
    const poll = /^\/sessions\/([a-f0-9-]{36})$/.exec(url.pathname);
    const state = url.searchParams.get('state') ?? '';
    const id = poll?.[1] ?? (url.pathname === '/callback' && request.method === 'GET' ? state.split('.')[0] : null);
    if (!id || !ID.test(id) || (!poll && !/^[a-f0-9-]{36}\.[a-f0-9]{64}$/.test(state))) return json({ error: 'Invalid authorization request.' }, 400);
    return env.SESSIONS.get(env.SESSIONS.idFromName(id)).fetch(request);
  },
};

/** Each authorization uses its own durable object and expires after ten minutes. */
export class NotionOAuthSession {
  constructor(state, env, { fetchImpl = (...args) => globalThis.fetch(...args) } = {}) {
    this.storage = state.storage;
    this.env = env;
    this.fetchImpl = fetchImpl;
  }
  async fetch(request) {
    const url = new URL(request.url);
    if (url.origin === 'https://session.internal' && url.pathname === '/create' && request.method === 'POST') {
      const { id, callbackUri } = await smallJson(request, 2048);
      requireLoopback(callbackUri);
      if (!ID.test(id)) return json({ error: 'Invalid session.' }, 400);
      const pollToken = token(); const state = id + '.' + token();
      await this.storage.put('session', { state, callbackUri, pollHash: await hash(pollToken), expiresAt: Date.now() + LIFETIME_MS, status: 'pending' });
      await this.storage.setAlarm(Date.now() + LIFETIME_MS);
      const authorize = new URL('https://api.notion.com/v1/oauth/authorize');
      authorize.search = new URLSearchParams({ client_id: this.env.NOTION_CLIENT_ID, response_type: 'code', owner: 'user', redirect_uri: this.env.PUBLIC_ORIGIN + '/callback', state }).toString();
      return json({ sessionId: id, pollToken, authorizationUrl: authorize.href });
    }
    if (url.pathname === '/callback' && request.method === 'GET') return this.callback(url);
    if (!['GET', 'DELETE'].includes(request.method)) return json({ error: 'Method not allowed.' }, 405);
    const pollHash = await hash((request.headers.get('Authorization') ?? '').replace(/^Bearer /, ''));
    const handoffHash = await hash(request.headers.get('X-Notion-Handoff') ?? '');
    return this.storage.transaction(async storage => {
      const session = await storage.get('session');
      if (!session || session.expiresAt <= Date.now()) { await storage.delete('session'); return json({ error: 'Authorization expired. Connect Notion again.' }, 410); }
      if (pollHash !== session.pollHash) return json({ error: 'Invalid authorization handoff.' }, 401);
      if (request.method === 'DELETE') { await storage.delete('session'); return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } }); }
      if (session.status === 'pending' || session.status === 'exchanging') return json({ status: 'pending' }, 202);
      if (!session.handoffHash || handoffHash !== session.handoffHash) return json({ error: 'Return to the initiating Desktop app to finish authorization.' }, 401);
      // Single-use redemption, including failure. No bearer credential enters a redirect URL.
      await storage.delete('session');
      if (session.status === 'error') return json({ error: session.error }, 403);
      return json({ accessToken: session.accessToken, workspaceId: session.workspaceId });
    });
  }
  async callback(url) {
    const session = await this.storage.transaction(async storage => {
      const current = await storage.get('session');
      if (!current || current.status !== 'pending' || current.expiresAt <= Date.now() || url.searchParams.getAll('state').length !== 1 || url.searchParams.get('state') !== current.state) return null;
      current.status = 'exchanging'; await storage.put('session', current); return current;
    });
    if (!session) return json({ error: 'Invalid or expired OAuth state.' }, 400);
    if (url.searchParams.has('error')) { return this.finish(session, { status: 'error', error: 'Notion authorization was declined. Connect again when ready.' }); }
    const code = url.searchParams.get('code');
    if (!code || code.length > 4096 || url.searchParams.getAll('code').length !== 1) {
      await this.complete(session, { status: 'error', error: 'Notion did not return an authorization code. Please reconnect.' });
      return json({ error: 'Missing authorization code.' }, 400);
    }
    try {
      const response = await this.fetchImpl('https://api.notion.com/v1/oauth/token', {
        method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(20000),
        headers: { Authorization: 'Basic ' + btoa(this.env.NOTION_CLIENT_ID + ':' + this.env.NOTION_CLIENT_SECRET), 'Content-Type': 'application/json' },
        body: JSON.stringify({ grant_type: 'authorization_code', code, redirect_uri: this.env.PUBLIC_ORIGIN + '/callback' }),
      });
      if (!response.ok) { await response.body?.cancel(); throw new Error('Token exchange failed.'); }
      const value = await smallJson(response);
      if (typeof value.access_token !== 'string' || !value.access_token || value.access_token.length > 4096) throw new Error('Invalid token response.');
      return this.finish(session, { status: 'ready', accessToken: value.access_token, workspaceId: typeof value.workspace_id === 'string' ? value.workspace_id : null });
    } catch {
      return this.finish(session, { status: 'error', error: 'Notion authorization could not finish. Please reconnect.' });
    }
  }
  async finish(session, result) {
    const proof = token();
    await this.complete(session, { ...result, handoffHash: await hash(proof) });
    const target = new URL(session.callbackUri); target.searchParams.set('proof', proof);
    return new Response(null, { status: 302, headers: { Location: target.href, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
  }
  async complete(previous, result) {
    await this.storage.transaction(async storage => {
      const current = await storage.get('session');
      if (current?.state === previous.state && current.expiresAt > Date.now()) await storage.put('session', { ...current, ...result });
    });
  }
  async alarm() { await this.storage.deleteAll(); }
}
