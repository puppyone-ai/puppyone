import { parseTemplateLink, requireTemplateId, templateShareLink } from '../../shared/desktop/template-link.mjs';
import { parseTemplatePackage, TEMPLATE_MAX_BYTES, validateDownloadDescriptor } from '../../local-api/templates/package.mjs';
import { resolveProjectTemplate } from '../../local-api/templates/project-catalog.mjs';

const R2_HOST = '13db2d16c6f86490873850f62fff5741.r2.cloudflarestorage.com';
const signedOut = () => new Error('Sign in to Puppyone before creating a project from this template.');
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
      shareUrl: templateShareLink({ id: ref.id, releaseId: detail.release_id }, origin) };
  }
  async function resolveTemplate(source, locale) {
    if (source?.kind !== 'template' || source.ref?.sourceId !== 'marketplace') return resolveProjectTemplate(source, locale);
    const id = requireTemplateId(source.ref.id); const releaseId = requireTemplateId(source.ref.releaseId);
    const session = await cloudAuthService.readSession();
    if (!session?.user_id || !session.session_generation) throw signedOut();
    const descriptor = validateDownloadDescriptor(await cloudAuthService.requestTemplateDownload({ id, releaseId }), { id, releaseId });
    const url = new URL(descriptor.download_url, origin);
    const local = allowLocalDownloads && url.origin === origin && url.pathname === '/api/template-packages';
    if (url.username || url.password || (!local && (url.protocol !== 'https:' || url.hostname !== R2_HOST || url.port
      || !url.pathname.startsWith('/puppyone-template-packages/')))) throw new Error('Invalid template download destination.');
    const response = await fetchImpl(url.href, { redirect: 'error', signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw new Error('Template download failed. Please retry.');
    const bytes = await readBounded(response, Math.min(descriptor.bundle_bytes, TEMPLATE_MAX_BYTES));
    const plan = await parseTemplatePackage(bytes, descriptor);
    sessions.set(plan, { userId: session.user_id, generation: session.session_generation });
    await validateSource(plan);
    return plan;
  }
  async function validateSource(plan) {
    if (plan.template?.sourceId !== 'marketplace') return;
    const captured = sessions.get(plan); const current = await cloudAuthService.readSession();
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
