import { AGENT_ICONS } from './constants';

/** Coarse human-readable timestamp ("3 hours ago", "5 days ago"). */
export function formatRelative(isoString: string | null | undefined): string {
  if (!isoString) return '';
  const diffMs = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diffMs / 60000);
  const hours = Math.floor(diffMs / 3600000);
  const days = Math.floor(diffMs / 86400000);
  const weeks = Math.floor(days / 7);
  const months = Math.floor(days / 30);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} minutes ago`;
  if (hours < 24) return `${hours} hours ago`;
  if (days < 7) return `${days} days ago`;
  if (weeks < 5) return `${weeks} weeks ago`;
  return `${months} months ago`;
}

/** Resolve the icon string stored on an agent into an emoji to render.
 *  Numeric inputs are mapped through `AGENT_ICONS`; everything else is
 *  treated as already-rendered emoji text. Falls back to 🤖. */
export function parseAgentIcon(icon: string | null) {
  if (!icon) return '🤖';
  if (/^\d+$/.test(icon)) return AGENT_ICONS[parseInt(icon, 10) % AGENT_ICONS.length];
  return icon;
}
