import { describe, it, expect, vi } from 'vitest';

async function brokerFixture() {
  const module = await import('../../../../cloudflare/notion-oauth/worker.mjs').catch(() => ({}));
  expect(module.default?.fetch, 'A deployable Notion OAuth broker must exist').toBeTypeOf('function');
  const objects = new Map();
  const env = { NOTION_CLIENT_ID: 'client-id', NOTION_CLIENT_SECRET: 'private-client-secret', PUBLIC_ORIGIN: 'https://notion-connect.puppyone.ai' };
  env.SESSIONS = { idFromName: id => id, get(id) {
    if (!objects.has(id)) {
      const values = new Map();
      const tx = { get: async key => structuredClone(values.get(key)), put: async (key, value) => values.set(key, structuredClone(value)), delete: async key => values.delete(key) };
      let transactionQueue = Promise.resolve();
      const storage = { ...tx, deleteAll: async () => values.clear(), setAlarm: async () => {}, transaction: run => { const next = transactionQueue.then(() => run(tx)); transactionQueue = next.catch(() => {}); return next; } };
      objects.set(id, new module.NotionOAuthSession({ storage }, env, { fetchImpl: async (url, init) => {
        expect(url).toBe('https://api.notion.com/v1/oauth/token');
        expect(JSON.parse(init.body).redirect_uri).toBe(env.PUBLIC_ORIGIN + '/callback');
        expect(new Headers(init.headers).get('Authorization')).toBe('Basic ' + btoa('client-id:private-client-secret'));
        return Response.json({ access_token: 'notion-test-token', refresh_token: 'notion-refresh', workspace_id: 'workspace' });
      } }));
    }
    return { fetch: request => objects.get(id).fetch(request) };
  } };
  const fetch = (route, init) => module.default.fetch(new Request(env.PUBLIC_ORIGIN + route, init), env);
  const callbackUri = 'http://127.0.0.1:49152/auth/callback?state=' + 'a'.repeat(64);
  const session = await (await fetch('/sessions', { method: 'POST', body: JSON.stringify({ callbackUri }) })).json();
  return { fetch, session, env, objects };
}

describe('Notion OAuth broker', () => {
  it('validates state and hands credentials to the initiating poller exactly once', async () => {
    const { fetch, session } = await brokerFixture();
    const auth = new URL(session.authorizationUrl);
    expect(auth.origin).toBe('https://api.notion.com');
    expect(auth.searchParams.get('client_id')).toBe('client-id');
    expect(JSON.stringify(session)).not.toContain('private-client-secret');
    expect(JSON.stringify(session)).not.toContain('notion-test-token');
    expect((await fetch('/sessions/' + session.sessionId)).status).toBe(401);
    const headers = { Authorization: 'Bearer ' + session.pollToken };
    expect((await fetch('/sessions/' + session.sessionId, { headers })).status).toBe(202);
    expect((await fetch('/callback?code=one&state=' + session.sessionId + '.invalid')).status).toBe(400);
    const callback = await fetch('/callback?code=one&state=' + encodeURIComponent(auth.searchParams.get('state')));
    expect(callback.status).toBe(302);
    const proof = new URL(callback.headers.get('location')).searchParams.get('proof');
    expect((await fetch('/sessions/' + session.sessionId, { headers })).status).toBe(401);
    headers['X-Notion-Handoff'] = proof;
    expect(await callback.text()).not.toContain('notion-test-token');
    const token = await fetch('/sessions/' + session.sessionId, { headers });
    expect(token.headers.get('cache-control')).toBe('no-store');
    expect((await token.json()).accessToken).toBe('notion-test-token');
    expect((await fetch('/sessions/' + session.sessionId, { headers })).status).toBe(410);
    expect((await fetch('/callback?code=again&state=' + encodeURIComponent(auth.searchParams.get('state')))).status).toBe(400);
  });
  it('handles denied authorization and cancellation without exchanging a code', async () => {
    const { fetch, session } = await brokerFixture();
    const state = new URL(session.authorizationUrl).searchParams.get('state');
    const callback = await fetch('/callback?error=access_denied&state=' + encodeURIComponent(state));
    expect(callback.status).toBe(302);
    const response = await fetch('/sessions/' + session.sessionId, { headers: { Authorization: 'Bearer ' + session.pollToken, 'X-Notion-Handoff': new URL(callback.headers.get('location')).searchParams.get('proof') } });
    expect(response.status).toBe(403);
    expect((await response.json()).error).toContain('declined');
  });
  it('rejects remote callback destinations and expires abandoned sessions', async () => {
    const { fetch, session } = await brokerFixture();
    const bad = await fetch('/sessions', { method: 'POST', body: JSON.stringify({ callbackUri: 'https://attacker.example/callback' }) });
    expect(bad.status).toBe(400);
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 11 * 60 * 1000);
    try { expect((await fetch('/sessions/' + session.sessionId, { headers: { Authorization: 'Bearer ' + session.pollToken } })).status).toBe(410); }
    finally { clock.mockRestore(); }
  });

  it('deletes pending sessions when cancelled', async () => {
    const { fetch, session } = await brokerFixture();
    const headers = { Authorization: 'Bearer ' + session.pollToken };
    expect((await fetch('/sessions/' + session.sessionId, { headers, method: 'DELETE' })).status).toBe(204);
    expect((await fetch('/sessions/' + session.sessionId, { headers })).status).toBe(410);
  });
});

describe('Desktop Notion OAuth client', () => {
  it('opens the provider browser and polls only the configured broker', async () => {
    const module = await import('../../../../electron/main/project-import/notion/oauth.mjs').catch(() => ({}));
    expect(module.createNotionConnector).toBeTypeOf('function');
    const { fetch: brokerFetch } = await brokerFixture();
    let completeLocalCallback;
    const startCallback = async options => { completeLocalCallback = async url => { expect(options.isExpectedCallback(url)).toBe(true); return options.onCallback(url); }; return { redirectUri: 'http://127.0.0.1:49152/auth/callback', close: async () => {} }; };
    const connector = module.createNotionConnector({ startCallback, origin: 'https://notion-connect.puppyone.ai', pollIntervalMs: 0,
      fetchImpl: async (url, init) => { expect(new URL(url).origin).toBe('https://notion-connect.puppyone.ai'); const u = new URL(url); return brokerFetch(u.pathname, init); } });
    let opened = false;
    const result = await connector({ shell: { openExternal: async url => {
      opened = true;
      const state = new URL(url).searchParams.get('state');
      const response = await brokerFetch('/callback?code=test&state=' + encodeURIComponent(state));
      await completeLocalCallback(response.headers.get('location'));
    } } });
    expect(opened).toBe(true);
    expect(result.accessToken).toBe('notion-test-token');
    expect(result.refreshToken).toBeUndefined();
  });
  it('does not show browser success when the provider denies authorization', async () => {
    const { createNotionConnector } = await import('../../../../electron/main/project-import/notion/oauth.mjs');
    const { fetch: brokerFetch } = await brokerFixture();
    let complete; let browserFailure;
    const connector = createNotionConnector({ origin: 'https://notion-connect.puppyone.ai', pollIntervalMs: 0,
      startCallback: async options => { complete = options.onCallback; return { redirectUri: 'http://127.0.0.1:49152/auth/callback', close: async () => {} }; },
      fetchImpl: (url, init) => brokerFetch(new URL(url).pathname, init),
    });
    await expect(connector({ shell: { openExternal: async url => {
      const callback = await brokerFetch('/callback?error=access_denied&state=' + encodeURIComponent(new URL(url).searchParams.get('state')));
      try { await complete(callback.headers.get('location')); } catch (error) { browserFailure = error; }
    } } })).rejects.toThrow(/declined/);
    expect(browserFailure, 'The browser callback must report denial too').toBeDefined();
  });

});
