'use client';

import { useRouter } from 'next/navigation';
import { useOnboarding } from '@/lib/hooks/useOnboarding';
import type { OnboardingStep } from '@/lib/hooks/useOnboarding';

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
    label: 'Create an Access Point',
    description: 'Access Points let Claude, Cursor, and other tools access your data.',
    actionLabel: 'Create Access Point',
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
}

export function GettingStartedPanel({ projectId }: Readonly<Props>) {
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
          position: 'fixed', bottom: 24, right: 24, zIndex: 100,
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '9px 14px', borderRadius: 10,
          background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.12)',
          color: '#e4e4e7', fontSize: 13, fontWeight: 500, cursor: 'pointer',
          boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
        }}
      >
        <div style={{
          width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
          background: `conic-gradient(#3b82f6 ${pct}%, rgba(255,255,255,0.1) 0)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#1a1a1a' }} />
        </div>
        Getting started {done}/{total}
      </button>
    );
  }

  return (
    <div style={{
      position: 'fixed', bottom: 24, right: 24, zIndex: 100,
      width: 340, borderRadius: 12,
      background: '#111', border: '1px solid rgba(255,255,255,0.1)',
      boxShadow: '0 8px 32px rgba(0,0,0,0.5)', overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '14px 16px 12px',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12,
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#f4f4f5', marginBottom: 8 }}>
            Getting started
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ flex: 1, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.08)' }}>
              <div style={{ height: '100%', borderRadius: 2, background: '#3b82f6', width: `${pct}%`, transition: 'width 0.4s ease' }} />
            </div>
            <span style={{ fontSize: 11, color: '#71717a', whiteSpace: 'nowrap' }}>{done}/{total}</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 2, flexShrink: 0, marginTop: 2 }}>
          <button
            onClick={collapseChecklist}
            title="Collapse"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#71717a', padding: '2px 6px', borderRadius: 4 }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="19 15 12 22 5 15" />
            </svg>
          </button>
          <button
            onClick={dismissChecklist}
            title="Already familiar, don't show again"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#71717a', padding: '2px 6px', borderRadius: 4, fontSize: 14, lineHeight: 1 }}
          >
            ✕
          </button>
        </div>
      </div>

      {/* Steps */}
      <div style={{ maxHeight: 380, overflowY: 'auto' }}>
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
                padding: isNext ? '12px 16px' : '8px 16px',
                borderBottom: i < STEP_DEFS.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
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
                  fontSize: 12, fontWeight: isNext ? 600 : 400,
                  color: labelColor,
                  textDecoration: completed ? 'line-through' : 'none',
                  marginBottom: isNext ? 4 : 0,
                }}>
                  {step.label}
                </div>
                {isNext && !completed && (
                  <>
                    <div style={{ fontSize: 11, color: '#a1a1aa', lineHeight: 1.6, marginBottom: 8 }}>
                      {step.description}
                    </div>
                    {step.actionLabel && href && (
                      <button
                        onClick={() => router.push(href)}
                        style={{
                          fontSize: 12, fontWeight: 500, color: '#fff',
                          background: '#2563eb', border: 'none',
                          borderRadius: 6, padding: '5px 12px', cursor: 'pointer',
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
      <div style={{ padding: '10px 16px', borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <button
          onClick={dismissChecklist}
          style={{ fontSize: 11, color: '#3f3f46', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
        >
          Already familiar, don&apos;t show again
        </button>
        <button
          onClick={resetWelcome}
          style={{ fontSize: 11, color: '#3f3f46', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
        >
          Watch intro again
        </button>
      </div>
    </div>
  );
}
