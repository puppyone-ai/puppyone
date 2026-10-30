import { parseTemplateLink, requireTemplateId, templateShareLink } from '../../shared/desktop/template-link.mjs';
import { parseTemplatePackage, TEMPLATE_MAX_BYTES, validateDownloadDescriptor } from '../../local-api/templates/package.mjs';
import { resolveProjectTemplate } from '../../local-api/templates/project-catalog.mjs';

const R2_HOST = '13db2d16c6f86490873850f62fff5741.r2.cloudflarestorage.com';
const signedOut = () => new Error('Sign in to Puppyone before creating a project from this template.');
// A public template owes nothing to an account, so a change of account cannot
// cancel it. Every other plan stays bound to the session that downloaded it.
const PUBLIC_DOWNLOAD = Object.freeze({ public: true });
export function createTemplateMarketplaceService({ origin, channel, cloudAuthService, fetchImpl = globalThis.fetch, allowLocalDownloads = false }) {
  const sessions = new WeakMap();
  async function readJson(response) {
    const bytes = await readBounded(response, 1024 * 1024);
    const result = JSON.parse(bytes.toString('utf8'));
    if (!response.ok) throw new Error(result?.error?.message || 'The template store is temporarily unavailable.');
    return result;
  }
  async function resolveLink(value, locale = 'en') {
    const ref = parseTemplateLink(value, { origin, channel });
    const query = new URLSearchParams({ locale: ({ 'zh-Hans': 'zh', 'pt-BR': 'pt' })[locale] || locale });
    if (ref.releaseId) query.set('release', ref.releaseId);
    const detail = await readJson(await fetchImpl(`${origin}/api/templates/${ref.id}?${query}`, { redirect: 'error', signal: AbortSignal.timeout(20000) }));
    if (detail.id !== ref.id || (ref.releaseId && detail.release_id !== ref.releaseId) || typeof detail.name !== 'string' || typeof detail.description !== 'string') throw new Error('Invalid template details.');
    requireTemplateId(detail.release_id);
    return { id: ref.id, releaseId: detail.release_id, name: detail.name.slice(0, 200), description: detail.description.slice(0, 1000),
      version: String(detail.version).slice(0, 80), author: String(detail.author).slice(0, 200), locale: String(detail.locale).slice(0, 20),
      fileCount: Number.isSafeInteger(detail.file_count) && detail.file_count >= 0 ? detail.file_count : null,
      icon: typeof detail.icon === 'string' ? detail.icon.slice(0, 16) : null,
      requiresSignIn: detail.delivery !== 'github',
      shareUrl: templateShareLink({ id: ref.id, releaseId: detail.release_id }, origin) };
  }
  // The store answers for a public template without an account. Only a template
  // it will not hand out anonymously goes through the signed-in path.
  async function requestPublicDownload(id, releaseId) {
    const response = await fetchImpl(`${origin}/api/templates/${id}/download`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(60000),
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ release_id: releaseId }),
    });
    if (response.status === 401) { await response.body?.cancel(); return null; }
    return readJson(response);
  }
  // A package comes from the store's own route for this template, or from the
  // managed bucket. A descriptor cannot point the Desktop anywhere else.
  function requireDownloadUrl(value, id) {
    const url = new URL(value, origin);
    const fromStore = url.origin === origin;
    const allowed = (fromStore && url.pathname === `/api/templates/${id}/package`)
      || (fromStore && allowLocalDownloads && url.pathname === '/api/template-packages')
      || (url.protocol === 'https:' && url.hostname === R2_HOST && !url.port && url.pathname.startsWith('/puppyone-template-packages/'));
    if (!allowed || url.username || url.password) throw new Error('Invalid template download destination.');
    return url;
  }
  async function resolveTemplate(source, locale) {
    if (source?.kind !== 'template' || source.ref?.sourceId !== 'marketplace') return resolveProjectTemplate(source, locale);
    const id = requireTemplateId(source.ref.id); const releaseId = requireTemplateId(source.ref.releaseId);
    let owner = PUBLIC_DOWNLOAD;
    let authorized = await requestPublicDownload(id, releaseId);
    if (!authorized) {
      const session = await cloudAuthService.readSession();
      if (!session?.user_id || !session.session_generation) throw signedOut();
      owner = { userId: session.user_id, generation: session.session_generation };
      authorized = await cloudAuthService.requestTemplateDownload({ id, releaseId });
    }
    const descriptor = validateDownloadDescriptor(authorized, { id, releaseId });
    const url = requireDownloadUrl(descriptor.download_url, id);
    const response = await fetchImpl(url.href, { redirect: 'error', signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw new Error('Template download failed. Please retry.');
    const bytes = await readBounded(response, Math.min(descriptor.bundle_bytes, TEMPLATE_MAX_BYTES));
    const plan = await parseTemplatePackage(bytes, descriptor);
    sessions.set(plan, owner);
    await validateSource(plan);
    return plan;
  }
  async function validateSource(plan) {
    if (plan.template?.sourceId !== 'marketplace') return;
    const captured = sessions.get(plan);
    if (captured === PUBLIC_DOWNLOAD) return;
    const current = await cloudAuthService.readSession();
    if (!captured || !current || current.user_id !== captured.userId || current.session_generation !== captured.generation
      || ['signed-out', 'signing-out', 'signing-in'].includes(current.status)) throw signedOut();
  }
  return { resolveLink, resolveTemplate, validateSource };
}
async function readBounded(response, max) {
  if (!response.body || Number(response.headers.get('content-length') || 0) > max) throw new Error('Template response exceeds its size limit.');
  const reader = response.body.getReader(); const chunks = []; let size = 0;
  try {
    for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length;
      if (size > max) throw new Error('Template response exceeds its size limit.'); chunks.push(Buffer.from(value)); }
    return Buffer.concat(chunks);
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
