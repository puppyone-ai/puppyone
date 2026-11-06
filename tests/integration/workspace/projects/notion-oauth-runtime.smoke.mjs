import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { createNotionConnector } from '../../../../electron/main/project-import/notion/oauth.mjs';
import assert from 'node:assert/strict';
import path from 'node:path';

const origin = 'https://notion-connect.puppyone.ai';
let exchanges = 0;
const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{
  modules: true,
  scriptPath: path.resolve('cloudflare/notion-oauth/worker.mjs'),
  compatibilityDate: '2026-09-02',
  durableObjects: { SESSIONS: { className: 'NotionOAuthSession', useSQLite: true } },
  bindings: { PUBLIC_ORIGIN: origin, NOTION_CLIENT_ID: 'test-client', NOTION_CLIENT_SECRET: 'test-secret' },
  outboundService: async request => {
    assert.equal(request.url, 'https://api.notion.com/v1/oauth/token');
    assert.equal(request.headers.get('authorization'), 'Basic ' + btoa('test-client:test-secret'));
    exchanges++;
    return Response.json({ access_token: 'synthetic-worker-access', workspace_id: 'synthetic-workspace' });
  },
}] }));
try {
  const result = await createNotionConnector({ origin, timeoutMs: 15000, fetchImpl: (url, init) => mf.dispatchFetch(url, init) })({
    shell: { openExternal: async value => {
      const authorization = new URL(value);
      const callback = await mf.dispatchFetch(origin + '/callback?code=synthetic&state=' + encodeURIComponent(authorization.searchParams.get('state')), { redirect: 'manual' });
      assert.equal(callback.status, 302);
      const location = callback.headers.get('location');
      assert.equal(new URL(location).hostname, '127.0.0.1');
      const browser = await fetch(location, { redirect: 'manual' });
      assert.equal(browser.status, 200);
      assert.ok(!(await browser.text()).includes('synthetic-worker-access'));
    } },
  });
  assert.equal(result.accessToken, 'synthetic-worker-access');
  assert.equal(exchanges, 1);
  console.log('PASS: actual workerd + SQLite Durable Object + native loopback + one-time Desktop redemption. Synthetic Notion token exchange only.');
} finally { console.log('Synthetic exchange calls:', exchanges); await mf.dispose(); }
