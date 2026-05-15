'use client';

import * as React from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useTheme } from 'next-themes';

type ThemeChoice = 'light' | 'dark' | 'system';

const OPTIONS: Array<{
  value: ThemeChoice;
  label: string;
  icon: LucideIcon;
}> = [
  {
    value: 'system',
    label: 'System',
    icon: Monitor,
  },
  {
    value: 'light',
    label: 'Light',
    icon: Sun,
  },
  {
    value: 'dark',
    label: 'Dark',
    icon: Moon,
  },
];

type ThemeToggleProps = {
  compact?: boolean;
};

export function ThemeToggle({ compact = false }: ThemeToggleProps) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  const selected = mounted ? (theme as ThemeChoice | undefined) ?? 'system' : null;
  return (
    <div
      role="radiogroup"
      aria-label="Appearance"
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
        gap: 3,
        padding: 3,
        borderRadius: 9,
        border: '1px solid var(--po-border-subtle)',
        background: 'var(--po-control)',
      }}
    >
      {OPTIONS.map(option => {
        const Icon = option.icon;
        const active = selected === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setTheme(option.value)}
            disabled={!mounted}
            style={{
              minHeight: compact ? 34 : 40,
              display: 'flex',
              alignItems: 'center',
              justifyContent: compact ? 'center' : 'flex-start',
              gap: compact ? 6 : 8,
              padding: compact ? '0 9px' : '0 11px',
              borderRadius: 7,
              border: active ? '1px solid var(--po-border-subtle)' : '1px solid transparent',
              background: active ? 'var(--po-panel-raised)' : 'transparent',
              color: active ? 'var(--po-text)' : 'var(--po-text-muted)',
              cursor: mounted ? 'pointer' : 'default',
              opacity: mounted ? 1 : 0.7,
              boxShadow: active ? '0 1px 2px var(--po-shadow)' : 'none',
              transition: 'background 120ms ease, border-color 120ms ease, color 120ms ease, box-shadow 120ms ease',
              textAlign: 'left',
            }}
            onMouseEnter={e => {
              if (!active && mounted) e.currentTarget.style.background = 'var(--po-hover)';
            }}
            onMouseLeave={e => {
              if (!active) e.currentTarget.style.background = 'transparent';
            }}
          >
            <span
              style={{
                width: compact ? 16 : 18,
                height: compact ? 16 : 18,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: active ? 'var(--po-text)' : 'var(--po-text-muted)',
                flexShrink: 0,
              }}
            >
              <Icon size={compact ? 14 : 16} strokeWidth={1.9} />
            </span>
            {!compact && (
              <span style={{ minWidth: 0, fontSize: 12.5, fontWeight: 500, color: active ? 'var(--po-text)' : 'var(--po-text-muted)', lineHeight: 1.2 }}>
                {option.label}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
