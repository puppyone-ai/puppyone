'use client';

import { useRouter } from 'next/navigation';
import { useOnboarding } from '@/lib/hooks/useOnboarding';
import type { OnboardingStep } from '@/lib/hooks/useOnboarding';
import {
  ACTIVITY_BG,
  ACTIVITY_BORDER,
  ACTIVITY_RADIUS,
  ACTIVITY_SHADOW,
  ACTIVITY_WIDTH,
  activityCardStyle,
  activityHeaderStyle,
  activitySubtleTextStyle,
  activityTitleStyle,
} from '../activityStyles';
import { ActivityIconButton } from '../ActivityIconButton';

interface StepDef {
  id: OnboardingStep;
  label: string;
  description: string;
  actionLabel?: string;
  getHref?: (projectId?: string) => string;
}

// English-only by product policy — copy lives inline rather than under
// `onboarding.steps` in messages/<locale>.json.  If multi-language support
// is reintroduced, lift label/description/actionLabel back into i18n.
const STEP_DEFS: StepDef[] = [
  {
    id: 'project',
    label: 'Create your first project',
    description: "Projects are containers for your data. Click '+ New Project' to get started.",
    actionLabel: 'Create project',
    getHref: () => '/home',
  },
  {
    id: 'file',
    label: 'Upload your first file',
    description: 'Go to the Context page, drag files or use mut push to sync a local folder.',
    actionLabel: 'Upload files',
    getHref: (pid) => (pid ? `/projects/${pid}/data` : '/home'),
  },
  {
    id: 'access_point',
    label: 'Add an integration',
    description: 'Integrations let Claude, Cursor, and other tools access your data.',
    actionLabel: 'Add integration',
    getHref: (pid) => (pid ? `/projects/${pid}/access` : '/home'),
  },
  {
    id: 'local_sync',
    label: 'Sync with mut CLI',
    description: 'Install mut CLI and run mut push for bidirectional real-time sync with PuppyOne.',
    actionLabel: 'View guide',
    getHref: (pid) => (pid ? `/projects/${pid}/access` : '/home'),
  },
  {
    id: 'agent',
    label: 'Create an AI Agent',
    description: "Click '+ New Agent' in the right panel of the Context page, then bind data resources.",
    actionLabel: 'Create Agent',
    getHref: (pid) => (pid ? `/projects/${pid}/data` : '/home'),
  },
  {
    id: 'chat',
    label: 'Chat with your Agent',
    description: 'Select an Agent and start chatting to let AI help you process data.',
    actionLabel: 'Start chatting',
    getHref: (pid) => (pid ? `/projects/${pid}/data` : '/home'),
  },
  {
    id: 'invite',
    label: 'Invite team members',
    description: 'Invite members on the team page to manage projects and Agents together.',
    actionLabel: 'Invite',
    getHref: () => '/team',
  },
];

interface Props {
  projectId?: string;
  inline?: boolean;
}

export function GettingStartedPanel({ projectId, inline = false }: Readonly<Props>) {
  const router = useRouter();
  const { completedSteps, collapsedChecklist, dismissedChecklist, dismissChecklist, openChecklist, collapseChecklist, resetWelcome } = useOnboarding();

  const done = completedSteps.length;
  const total = STEP_DEFS.length;
  const pct = Math.round((done / total) * 100);
  const nextIdx = STEP_DEFS.findIndex(s => !completedSteps.includes(s.id));

  if (collapsedChecklist || dismissedChecklist) {
    return (
      <button
        onClick={openChecklist}
        style={{
          ...(inline
            ? {}
            : { position: 'fixed' as const, bottom: 24, right: 24, zIndex: 100 }),
          display: 'flex', alignItems: 'center', gap: 8,
          width: ACTIVITY_WIDTH,
          minHeight: 44,
          padding: '8px 12px', borderRadius: ACTIVITY_RADIUS,
          background: ACTIVITY_BG, border: ACTIVITY_BORDER,
          color: '#e4e4e7', fontSize: 13, fontWeight: 600, cursor: 'pointer',
          boxShadow: ACTIVITY_SHADOW,
          boxSizing: 'border-box',
        }}
      >
        <div style={{
          width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
          background: `conic-gradient(#3b82f6 ${pct}%, rgba(255,255,255,0.1) 0)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: ACTIVITY_BG }} />
        </div>
        <span style={{ ...activityTitleStyle, flex: 1, textAlign: 'left' }}>
          Getting started
        </span>
        <span style={{ ...activitySubtleTextStyle, whiteSpace: 'nowrap' }}>{done}/{total}</span>
      </button>
    );
  }

  return (
    <div style={{
      ...(inline
        ? {}
        : { position: 'fixed' as const, bottom: 24, right: 24, zIndex: 100 }),
      ...activityCardStyle,
    }}>
      {/* Header */}
      <div style={activityHeaderStyle}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ ...activityTitleStyle, marginBottom: 8 }}>
            Getting started
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ flex: 1, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.08)' }}>
              <div style={{ height: '100%', borderRadius: 2, background: '#3b82f6', width: `${pct}%`, transition: 'width 0.4s ease' }} />
            </div>
            <span style={{ ...activitySubtleTextStyle, whiteSpace: 'nowrap' }}>{done}/{total}</span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
          <ActivityIconButton
            kind="collapse"
            title="Collapse"
            onClick={collapseChecklist}
          />
          <ActivityIconButton
            kind="close"
            title="Already familiar, don't show again"
            onClick={dismissChecklist}
          />
        </div>
      </div>

      {/* Steps */}
      <div style={{ maxHeight: 360, overflowY: 'auto' }}>
        {STEP_DEFS.map((step, i) => {
          const completed = completedSteps.includes(step.id);
          const isNext = i === nextIdx;
          const circleAccent = isNext ? '#3b82f6' : 'rgba(255,255,255,0.15)';
          const circleBorder = completed ? 'none' : `1.5px solid ${circleAccent}`;
          const labelColorActive = isNext ? '#f4f4f5' : '#71717a';
          const labelColor = completed ? '#3f3f46' : labelColorActive;
          const href = step.getHref?.(projectId);
          return (
            <div
              key={step.id}
              style={{
                padding: isNext ? '10px 12px' : '8px 12px',
                borderBottom: i < STEP_DEFS.length - 1 ? '1px solid rgba(255,255,255,0.06)' : 'none',
                background: isNext ? 'rgba(59,130,246,0.06)' : 'transparent',
                display: 'flex', gap: 10, alignItems: 'flex-start',
              }}
            >
              <div style={{
                width: 18, height: 18, borderRadius: '50%', flexShrink: 0, marginTop: 1,
                border: circleBorder, background: completed ? '#3b82f6' : 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {completed && (
                  <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                    <path d="M2 6l3 3 5-5" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
                {!completed && isNext && (
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#3b82f6' }} />
                )}
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 13, lineHeight: '18px', fontWeight: isNext ? 600 : 400,
                  color: labelColor,
                  textDecoration: completed ? 'line-through' : 'none',
                  marginBottom: isNext ? 4 : 0,
                }}>
                  {step.label}
                </div>
                {isNext && !completed && (
                  <>
                    <div style={{ ...activitySubtleTextStyle, color: '#a1a1aa', marginBottom: 8 }}>
                      {step.description}
                    </div>
                    {step.actionLabel && href && (
                      <button
                        onClick={() => router.push(href)}
                        style={{
                          height: 28, fontSize: 12, fontWeight: 500, color: '#fff',
                          background: '#2563eb', border: 'none',
                          borderRadius: 6, padding: '0 12px', cursor: 'pointer',
                        }}
                        onMouseEnter={e => (e.currentTarget.style.background = '#1d4ed8')}
                        onMouseLeave={e => (e.currentTarget.style.background = '#2563eb')}
                      >
                        {step.actionLabel} →
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div style={{ padding: '9px 12px', borderTop: '1px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <button
          onClick={dismissChecklist}
          style={{ ...activitySubtleTextStyle, color: '#52525b', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
        >
          Already familiar, don&apos;t show again
        </button>
        <button
          onClick={resetWelcome}
          style={{ ...activitySubtleTextStyle, color: '#52525b', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
        >
          Watch intro again
        </button>
      </div>
    </div>
  );
}
