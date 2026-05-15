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
    label: 'Create a project',
    description: 'Start with an empty workspace so real context can land in the right place.',
    actionLabel: 'Create project',
    getHref: () => '/home?create=true',
  },
  {
    id: 'file',
    label: 'Bring in existing context',
    description: 'Import files, GitHub, Notion, a local folder, URLs, or docs from the empty project screen.',
    actionLabel: 'Import context',
    getHref: (pid) => (pid ? `/projects/${pid}/data` : '/home'),
  },
  {
    id: 'access_point',
    label: 'Give a tool access',
    description: 'Create an access point so Claude, Cursor, MCP clients, or Git remotes can use this project.',
    actionLabel: 'Open Access',
    getHref: (pid) => (pid ? `/projects/${pid}/access` : '/home'),
  },
  {
    id: 'agent',
    label: 'Create an AI Agent',
    description: 'Bind an agent to the context it should read and write.',
    actionLabel: 'Create Agent',
    getHref: (pid) => (pid ? `/projects/${pid}/data` : '/home'),
  },
  {
    id: 'chat',
    label: 'Chat with your Agent',
    description: 'Send one message so the loop closes: context in, agent work out.',
    actionLabel: 'Start chatting',
    getHref: (pid) => (pid ? `/projects/${pid}/data` : '/home'),
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
const ACCENT = 'var(--po-accent)';
const PROGRESS_FILL = ACCENT;
const PROGRESS_TRACK = 'var(--po-border-subtle)';
const NEXT_RING = 'var(--po-border-strong)';
const PENDING_RING = 'var(--po-border)';

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

  if (total > 0 && done >= total) {
    return null;
  }

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
          color: 'var(--po-text)',
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
          e.currentTarget.style.background = 'var(--po-panel-raised)';
          e.currentTarget.style.borderColor = 'var(--po-border-strong)';
        }}
        onMouseLeave={e => {
          e.currentTarget.style.background = ACTIVITY_BG;
          e.currentTarget.style.borderColor = 'var(--po-border-subtle)';
        }}
      >
        <div style={{
          width: 14, height: 14, borderRadius: '50%', flexShrink: 0,
          background: `conic-gradient(${PROGRESS_FILL} ${pct}%, ${PROGRESS_TRACK} 0)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--po-overlay)' }} />
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
            ? 'var(--po-text-disabled)'
            : isNext
              ? 'var(--po-text)'
              : 'var(--po-text-muted)';
          const href = step.getHref?.(projectId);
          return (
            <div
              key={step.id}
              style={{
                padding: isNext ? '10px 14px 12px' : '7px 14px',
                background: isNext ? 'var(--po-control)' : 'transparent',
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
                    <path d="M2.5 6l2.5 2.5L9.5 4" stroke="var(--po-text-inverse)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
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
                  textDecorationColor: 'var(--po-text-disabled)',
                  marginBottom: isNext ? 4 : 0,
                }}>
                  {step.label}
                </div>
                {isNext && !completed && (
                  <>
                    <div style={{
                      ...activitySubtleTextStyle,
                      color: 'var(--po-text-muted)',
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
                          color: 'var(--po-text)',
                          background: 'var(--po-border-subtle)',
                          border: '1px solid var(--po-border-strong)',
                          borderRadius: 6,
                          padding: '0 10px',
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          transition: 'background 0.12s ease, border-color 0.12s ease',
                        }}
                        onMouseEnter={e => {
                          e.currentTarget.style.background = 'var(--po-border-strong)';
                          e.currentTarget.style.borderColor = 'var(--po-focus-ring)';
                        }}
                        onMouseLeave={e => {
                          e.currentTarget.style.background = 'var(--po-border-subtle)';
                          e.currentTarget.style.borderColor = 'var(--po-border-strong)';
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
        borderTop: '1px solid var(--po-hover)',
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
  color: 'var(--po-text-subtle)',
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  padding: '2px 4px',
  borderRadius: 4,
  transition: 'color 0.12s ease',
};

function onFooterLinkEnter(e: MouseEvent<HTMLButtonElement>) {
  e.currentTarget.style.color = 'var(--po-text-muted)';
}

function onFooterLinkLeave(e: MouseEvent<HTMLButtonElement>) {
  e.currentTarget.style.color = 'var(--po-text-subtle)';
}
