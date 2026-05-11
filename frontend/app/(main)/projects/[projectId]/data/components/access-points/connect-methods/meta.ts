/**
 * Per-method metadata used by MethodCard / MethodIcon.
 *
 * The single-source accent colour drives the icon tile + prompt button so
 * each method gets a consistent identity colour.
 */

export type MethodId = 'terminal' | 'sync' | 'agent';

export interface MethodMeta {
  id: MethodId;
  title: string;
  subtitle: string;
  /** Single-source accent for this method — used by icon + prompt button. */
  accent: string;
  accentBg: string;
  accentBorder: string;
}

export const METHOD_META: Record<MethodId, MethodMeta> = {
  terminal: {
    id: 'terminal',
    title: 'Terminal CLI',
    subtitle: 'Direct terminal access',
    accent: '#93c5fd',
    accentBg: 'rgba(96,165,250,0.12)',
    accentBorder: 'rgba(96,165,250,0.22)',
  },
  sync: {
    id: 'sync',
    title: 'Local Sync',
    subtitle: 'Two-way folder sync',
    accent: '#34d399',
    accentBg: 'rgba(52,211,153,0.12)',
    accentBorder: 'rgba(52,211,153,0.22)',
  },
  agent: {
    id: 'agent',
    title: 'AI Agent',
    subtitle: 'Scoped chat agent',
    accent: '#c4b5fd',
    accentBg: 'rgba(167,139,250,0.12)',
    accentBorder: 'rgba(167,139,250,0.22)',
  },
};
