'use client';

import type { CSSProperties, MouseEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useOnboarding } from '@/lib/hooks/useOnboarding';
import type { OnboardingStep } from '@/lib/hooks/useOnboarding';
import { AI_AGENT_ENABLED } from '@/lib/featureFlags';
import {
  ACTIVITY_BG,
  ACTIVITY_BORDER,
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

// Brand blue — applied surgically (progress fill + completed checks +
// active "you are here" dot). Three small, contained surfaces is enough
// to feel like PuppyOne; a fourth (filled CTA) is what made the panel
// read as a marketing widget last time, so the CTA stays as a neutral
// ghost button on purpose.
const ACCENT = '#3b82f6';
const PROGRESS_FILL = ACCENT;
const PROGRESS_TRACK = 'rgba(255,255,255,0.06)';
const NEXT_RING = 'rgba(255,255,255,0.55)';
const PENDING_RING = 'rgba(255,255,255,0.18)';

export function GettingStartedPanel({ projectId, inline = false }: Readonly<Props>) {
  const router = useRouter();
  const { completedSteps, collapsedChecklist, dismissedChecklist, dismissChecklist, openChecklist, collapseChecklist, resetWelcome } = useOnboarding();

  // Filter out steps belonging to features that are currently hidden
  // by feature flag (see `frontend/lib/featureFlags.ts`). The
  // underlying step IDs in `useOnboarding` still exist and can be
  // marked complete server-side — we just don't show them in the
  // checklist while the feature is hidden, so progress and "next
  // step" arithmetic match what the user can actually do.
  const visibleSteps = STEP_DEFS.filter((step) => {
    if (!AI_AGENT_ENABLED && (step.id === 'agent' || step.id === 'chat')) {
      return false;
    }
    return true;
  });
  const visibleStepIds = new Set(visibleSteps.map((s) => s.id));
  // Re-scope progress to only-visible steps. If we counted hidden
  // completions we'd give the user "credit" for invisible work and
  // the bar would jump.
  const visibleCompletedCount = completedSteps.filter((id) =>
    visibleStepIds.has(id),
  ).length;
  const done = visibleCompletedCount;
  const total = visibleSteps.length;
  const pct = Math.round((done / total) * 100);
  const nextIdx = visibleSteps.findIndex(
    (s) => !completedSteps.includes(s.id),
  );

  if (collapsedChecklist || dismissedChecklist) {
    return (
      <button
        onClick={openChecklist}
        style={{
          ...(inline
            ? {}
            : { position: 'fixed' as const, bottom: 12, right: 12, zIndex: 100 }),
          display: 'flex', alignItems: 'center', gap: 10,
          width: ACTIVITY_WIDTH,
          minHeight: 38,
          padding: '8px 14px',
          borderRadius: 999,
          background: ACTIVITY_BG,
          border: ACTIVITY_BORDER,
          color: '#e4e4e7',
          fontSize: 12,
          fontWeight: 500,
          letterSpacing: '-0.01em',
          cursor: 'pointer',
          boxShadow: ACTIVITY_SHADOW,
          backdropFilter: 'blur(28px) saturate(160%)',
          WebkitBackdropFilter: 'blur(28px) saturate(160%)',
          boxSizing: 'border-box',
          transition: 'background 0.12s ease, border-color 0.12s ease',
        }}
        onMouseEnter={e => {
          e.currentTarget.style.background = 'rgba(30, 30, 34, 0.9)';
          e.currentTarget.style.borderColor = 'rgba(255,255,255,0.10)';
        }}
        onMouseLeave={e => {
          e.currentTarget.style.background = ACTIVITY_BG;
          e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)';
        }}
      >
        <div style={{
          width: 14, height: 14, borderRadius: '50%', flexShrink: 0,
          background: `conic-gradient(${PROGRESS_FILL} ${pct}%, ${PROGRESS_TRACK} 0)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'rgba(22,22,26,0.95)' }} />
        </div>
        <span style={{ flex: 1, textAlign: 'left' }}>
          Getting started
        </span>
        <span style={{ ...activitySubtleTextStyle, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
          {done}/{total}
        </span>
      </button>
    );
  }

  return (
    <div style={{
      ...(inline
        ? {}
        : { position: 'fixed' as const, bottom: 12, right: 12, zIndex: 100 }),
      ...activityCardStyle,
    }}>
      {/* Header */}
      <div style={activityHeaderStyle}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            ...activityTitleStyle,
            marginBottom: 8,
            display: 'flex', alignItems: 'baseline', gap: 8,
          }}>
            <span>Getting started</span>
            <span style={{
              ...activitySubtleTextStyle,
              fontVariantNumeric: 'tabular-nums',
            }}>
              {done}/{total}
            </span>
          </div>
          <div style={{
            height: 3, borderRadius: 2,
            background: PROGRESS_TRACK,
            overflow: 'hidden',
          }}>
            <div style={{
              height: '100%', borderRadius: 2,
              background: PROGRESS_FILL,
              width: `${pct}%`,
              transition: 'width 0.4s ease',
            }} />
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0, alignSelf: 'flex-start' }}>
          <ActivityIconButton
            kind="collapse"
            title="Collapse"
            onClick={collapseChecklist}
          />
        </div>
      </div>

      {/* Steps */}
      <div style={{ maxHeight: 360, overflowY: 'auto', padding: '4px 0' }}>
        {visibleSteps.map((step, i) => {
          const completed = completedSteps.includes(step.id);
          const isNext = i === nextIdx;
          const labelColor = completed
            ? '#52525b'
            : isNext
              ? '#fafafa'
              : '#a1a1aa';
          const href = step.getHref?.(projectId);
          return (
            <div
              key={step.id}
              style={{
                padding: isNext ? '10px 14px 12px' : '7px 14px',
                background: isNext ? 'rgba(255,255,255,0.035)' : 'transparent',
                display: 'flex', gap: 10, alignItems: 'flex-start',
                position: 'relative',
              }}
            >
              {/* Step indicator */}
              <div style={{
                width: 16, height: 16, borderRadius: '50%', flexShrink: 0, marginTop: 1,
                border: completed
                  ? 'none'
                  : `1.5px solid ${isNext ? NEXT_RING : PENDING_RING}`,
                background: completed ? ACCENT : 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'border-color 0.15s ease',
              }}>
                {completed && (
                  <svg width="9" height="9" viewBox="0 0 12 12" fill="none">
                    <path d="M2.5 6l2.5 2.5L9.5 4" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
                {!completed && isNext && (
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: ACCENT }} />
                )}
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 12.5,
                  lineHeight: '17px',
                  fontWeight: isNext ? 500 : 400,
                  letterSpacing: '-0.005em',
                  color: labelColor,
                  textDecoration: completed ? 'line-through' : 'none',
                  textDecorationColor: 'rgba(82, 82, 91, 0.6)',
                  marginBottom: isNext ? 4 : 0,
                }}>
                  {step.label}
                </div>
                {isNext && !completed && (
                  <>
                    <div style={{
                      ...activitySubtleTextStyle,
                      color: '#a1a1aa',
                      marginBottom: 10,
                      lineHeight: '15px',
                    }}>
                      {step.description}
                    </div>
                    {step.actionLabel && href && (
                      <button
                        onClick={() => router.push(href)}
                        style={{
                          height: 26,
                          fontSize: 11.5,
                          fontWeight: 500,
                          letterSpacing: '-0.005em',
                          color: '#fafafa',
                          background: 'rgba(255,255,255,0.06)',
                          border: '1px solid rgba(255,255,255,0.12)',
                          borderRadius: 6,
                          padding: '0 10px',
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          transition: 'background 0.12s ease, border-color 0.12s ease',
                        }}
                        onMouseEnter={e => {
                          e.currentTarget.style.background = 'rgba(255,255,255,0.10)';
                          e.currentTarget.style.borderColor = 'rgba(255,255,255,0.18)';
                        }}
                        onMouseLeave={e => {
                          e.currentTarget.style.background = 'rgba(255,255,255,0.06)';
                          e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)';
                        }}
                      >
                        {step.actionLabel}
                        <span style={{ opacity: 0.55 }}>→</span>
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer — two symmetrical low-priority actions both ending in
          "again" / "now". Header is now collapse-only, so dismiss lives
          here paired with the intro replay. */}
      <div style={{
        padding: '8px 12px',
        borderTop: '1px solid rgba(255,255,255,0.04)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 8,
      }}>
        <button
          onClick={resetWelcome}
          style={footerLinkStyle}
          onMouseEnter={onFooterLinkEnter}
          onMouseLeave={onFooterLinkLeave}
        >
          Watch intro again
        </button>
        <button
          onClick={dismissChecklist}
          style={footerLinkStyle}
          onMouseEnter={onFooterLinkEnter}
          onMouseLeave={onFooterLinkLeave}
        >
          Don&apos;t show again
        </button>
      </div>
    </div>
  );
}

const footerLinkStyle: CSSProperties = {
  fontSize: 11,
  lineHeight: '16px',
  letterSpacing: '-0.005em',
  color: '#71717a',
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  padding: '2px 4px',
  borderRadius: 4,
  transition: 'color 0.12s ease',
};

function onFooterLinkEnter(e: MouseEvent<HTMLButtonElement>) {
  e.currentTarget.style.color = '#d4d4d8';
}

function onFooterLinkLeave(e: MouseEvent<HTMLButtonElement>) {
  e.currentTarget.style.color = '#71717a';
}
