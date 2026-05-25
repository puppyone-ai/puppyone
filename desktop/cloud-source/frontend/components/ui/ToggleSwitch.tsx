'use client';

import type { CSSProperties, KeyboardEvent, MouseEvent } from 'react';

type ToggleSwitchSize = 'xs' | 'sm' | 'md';
type ToggleSwitchElement = 'button' | 'span';

const SWITCH_SIZES: Record<
  ToggleSwitchSize,
  { width: number; height: number; thumb: number; inset: number }
> = {
  xs: { width: 32, height: 18, thumb: 14, inset: 2 },
  sm: { width: 36, height: 20, thumb: 16, inset: 2 },
  md: { width: 44, height: 24, thumb: 20, inset: 2 },
};

type ToggleSwitchProps = {
  readonly checked: boolean;
  readonly onCheckedChange?: (checked: boolean) => void;
  readonly disabled?: boolean;
  readonly pending?: boolean;
  readonly ariaLabel: string;
  readonly title?: string;
  readonly size?: ToggleSwitchSize;
  readonly as?: ToggleSwitchElement;
  readonly stopPropagation?: boolean;
  readonly style?: CSSProperties;
};

export function ToggleSwitch({
  checked,
  onCheckedChange,
  disabled = false,
  pending = false,
  ariaLabel,
  title,
  size = 'sm',
  as = 'button',
  stopPropagation = false,
  style,
}: ToggleSwitchProps) {
  const dims = SWITCH_SIZES[size];
  const disabledOrPending = disabled || pending || !onCheckedChange;
  const thumbTravel = dims.width - dims.thumb - dims.inset * 2;

  const trackStyle: CSSProperties = {
    width: dims.width,
    height: dims.height,
    borderRadius: 999,
    border: `1px solid ${checked ? 'var(--po-switch-border-on)' : 'var(--po-switch-border-off)'}`,
    background: checked ? 'var(--po-switch-track-on)' : 'var(--po-switch-track-off)',
    cursor: disabledOrPending ? (pending ? 'wait' : 'not-allowed') : 'pointer',
    opacity: disabled ? 0.5 : 1,
    position: 'relative',
    flexShrink: 0,
    display: 'inline-block',
    boxSizing: 'border-box',
    verticalAlign: 'middle',
    padding: 0,
    transition:
      'background 180ms ease, border-color 180ms ease, opacity 180ms ease',
    ...style,
  };

  const thumb = (
    <span
      aria-hidden
      style={{
        position: 'absolute',
        top: dims.inset - 1,
        left: dims.inset - 1,
        width: dims.thumb,
        height: dims.thumb,
        borderRadius: '50%',
        background: 'var(--po-switch-thumb)',
        boxShadow: '0 1px 2px var(--po-switch-thumb-shadow)',
        transform: checked ? `translateX(${thumbTravel}px)` : 'translateX(0)',
        transition: 'transform 180ms ease',
      }}
    />
  );

  const toggle = (event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>) => {
    if (stopPropagation) {
      event.stopPropagation();
    }
    if (disabledOrPending) {
      return;
    }
    onCheckedChange?.(!checked);
  };

  if (as === 'span') {
    return (
      <span
        role="switch"
        aria-checked={checked}
        aria-disabled={disabledOrPending || undefined}
        aria-busy={pending || undefined}
        aria-label={ariaLabel}
        title={title ?? ariaLabel}
        tabIndex={disabledOrPending ? -1 : 0}
        onClick={toggle}
        onKeyDown={(event) => {
          if (event.key === ' ' || event.key === 'Enter') {
            event.preventDefault();
            toggle(event);
          } else if (stopPropagation) {
            event.stopPropagation();
          }
        }}
        style={{
          ...trackStyle,
          outline: 'none',
        }}
      >
        {thumb}
      </span>
    );
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-busy={pending || undefined}
      aria-label={ariaLabel}
      title={title ?? ariaLabel}
      disabled={disabledOrPending}
      onClick={toggle}
      onKeyDown={(event) => {
        if (stopPropagation) {
          event.stopPropagation();
        }
      }}
      style={{
        ...trackStyle,
        appearance: 'none',
      }}
    >
      {thumb}
    </button>
  );
}
