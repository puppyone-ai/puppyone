'use client';

import {
  forwardRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';

type FieldProps = {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  style?: CSSProperties;
};

export function Field({ label, hint, error, children, style }: FieldProps) {
  return (
    <div style={{ display: 'block', ...style }}>
      {label && <FieldLabel>{label}</FieldLabel>}
      {children}
      {(error || hint) && (
        <div
          style={{
            marginTop: 6,
            fontSize: 12,
            lineHeight: '17px',
            color: error ? 'var(--po-danger)' : 'var(--po-text-subtle)',
          }}
        >
          {error ?? hint}
        </div>
      )}
    </div>
  );
}

type FieldLabelProps = {
  children: ReactNode;
  style?: CSSProperties;
};

export function FieldLabel({ children, style }: FieldLabelProps) {
  return (
    <div
      style={{
        marginBottom: 8,
        fontSize: 11,
        lineHeight: '14px',
        fontWeight: 600,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        color: 'var(--po-text-subtle)',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

type FocusableInputProps = {
  invalid?: boolean;
  style?: CSSProperties;
};

function inputBaseStyle(
  focused: boolean,
  disabled: boolean | undefined,
  invalid: boolean | undefined,
): CSSProperties {
  return {
    width: '100%',
    minWidth: 0,
    background: disabled ? 'var(--po-control)' : 'var(--po-panel-raised)',
    border: `1px solid ${
      invalid
        ? 'var(--po-danger)'
        : focused
          ? 'var(--po-focus-ring)'
          : 'var(--po-border-strong)'
    }`,
    borderRadius: 6,
    color: disabled ? 'var(--po-text-disabled)' : 'var(--po-text)',
    fontFamily: 'inherit',
    fontSize: 13,
    lineHeight: '18px',
    outline: 'none',
    boxSizing: 'border-box',
    transition: 'border-color 0.12s ease, background 0.12s ease',
  };
}

export type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'style'> &
  FocusableInputProps;

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(
  function TextField(
    { invalid, disabled, style, onFocus, onBlur, ...props },
    ref,
  ) {
    const [focused, setFocused] = useState(false);

    const handleFocus = (event: FocusEvent<HTMLInputElement>) => {
      setFocused(true);
      onFocus?.(event);
    };

    const handleBlur = (event: FocusEvent<HTMLInputElement>) => {
      setFocused(false);
      onBlur?.(event);
    };

    return (
      <input
        {...props}
        ref={ref}
        disabled={disabled}
        onFocus={handleFocus}
        onBlur={handleBlur}
        style={{
          ...inputBaseStyle(focused, disabled, invalid),
          height: 32,
          padding: '0 10px',
          ...style,
        }}
      />
    );
  },
);

export type TextAreaFieldProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'style'> &
  FocusableInputProps;

export const TextAreaField = forwardRef<HTMLTextAreaElement, TextAreaFieldProps>(
  function TextAreaField(
    { invalid, disabled, style, onFocus, onBlur, ...props },
    ref,
  ) {
    const [focused, setFocused] = useState(false);

    const handleFocus = (event: FocusEvent<HTMLTextAreaElement>) => {
      setFocused(true);
      onFocus?.(event);
    };

    const handleBlur = (event: FocusEvent<HTMLTextAreaElement>) => {
      setFocused(false);
      onBlur?.(event);
    };

    return (
      <textarea
        {...props}
        ref={ref}
        disabled={disabled}
        onFocus={handleFocus}
        onBlur={handleBlur}
        style={{
          ...inputBaseStyle(focused, disabled, invalid),
          minHeight: 76,
          padding: '8px 10px',
          resize: 'vertical',
          ...style,
        }}
      />
    );
  },
);

export type SelectFieldProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'style'> &
  FocusableInputProps;

export const SelectField = forwardRef<HTMLSelectElement, SelectFieldProps>(
  function SelectField(
    { invalid, disabled, style, onFocus, onBlur, children, ...props },
    ref,
  ) {
    const [focused, setFocused] = useState(false);

    const handleFocus = (event: FocusEvent<HTMLSelectElement>) => {
      setFocused(true);
      onFocus?.(event);
    };

    const handleBlur = (event: FocusEvent<HTMLSelectElement>) => {
      setFocused(false);
      onBlur?.(event);
    };

    return (
      <select
        {...props}
        ref={ref}
        disabled={disabled}
        onFocus={handleFocus}
        onBlur={handleBlur}
        style={{
          ...inputBaseStyle(focused, disabled, invalid),
          height: 32,
          padding: '0 10px',
          appearance: 'auto',
          ...style,
        }}
      >
        {children}
      </select>
    );
  },
);
