import { getDesktopReturnScheme } from './return-to-app-link.mjs';

export const TEMPLATE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const TEMPLATE_STORE_ORIGIN = 'https://www.puppyone.ai';
export function requireTemplateId(value) {
  if (typeof value !== 'string' || !TEMPLATE_ID_PATTERN.test(value)) throw new Error('Invalid template link.');
  return value;
}
export function resolveTemplateStoreOrigin({ isPackaged = true, override } = {}) {
  if (isPackaged || !override) return TEMPLATE_STORE_ORIGIN;
  const url = new URL(override);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/'
    || !(url.origin === TEMPLATE_STORE_ORIGIN || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) throw new Error('Invalid template development origin.');
  return url.origin;
}
export function parseTemplateLink(value, { origin = TEMPLATE_STORE_ORIGIN, channel = 'stable' } = {}) {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('Paste a Puppyone template store link.');
  let url;
  try { url = new URL(value.trim()); } catch { throw new Error('Paste a Puppyone template store link.'); }
  if (hasInvalidLinkParts(url)) throw new Error('Invalid template link.');
  let id;
  if (url.protocol === `${getDesktopReturnScheme(channel)}:` && url.hostname === 'templates' && url.pathname === '/import' && !url.port) {
    if (url.searchParams.getAll('id').length !== 1 || [...url.searchParams.keys()].some(k => !['id', 'release'].includes(k))) throw new Error('Invalid template link.');
    id = requireTemplateId(url.searchParams.get('id'));
  } else {
    if (![TEMPLATE_STORE_ORIGIN, origin].includes(url.origin) || [...url.searchParams.keys()].some(k => k !== 'release')) throw new Error('Use a Puppyone template store link. GitHub repositories must be published to the store first.');
    const match = /^\/t\/([a-f0-9-]{36})$/.exec(url.pathname);
    if (!match) throw new Error('Paste a Puppyone template store link.');
    id = requireTemplateId(match[1]);
  }
  const releaseId = url.searchParams.has('release') ? requireTemplateId(url.searchParams.get('release')) : null;
  return { id, releaseId };
}
export function templateShareLink({ id, releaseId }, origin = TEMPLATE_STORE_ORIGIN) {
  return `${origin}/t/${requireTemplateId(id)}${releaseId ? `?release=${requireTemplateId(releaseId)}` : ''}`;
}

/**
 * A cheap test for pasted text. It opens no link and proves nothing: the Main
 * process still parses whatever this lets through.
 */
export function looksLikeTemplateLink(value) {
  if (typeof value !== 'string' || value.length > 2048) return false;
  return /^(?:https?:\/\/[^\s/]+\/t\/[a-f0-9-]{36}(?:\?release=[a-f0-9-]{36})?|[a-z-]+:\/\/templates\/import\?\S+)$/i.test(value.trim());
}

function hasInvalidLinkParts(url) {
  return Boolean(url.username || url.password || url.hash || url.searchParams.getAll('release').length > 1);
}
