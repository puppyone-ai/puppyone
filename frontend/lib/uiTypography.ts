import type { CSSProperties } from 'react';

export const FONT_SANS = 'var(--po-font-sans)';
export const FONT_MONO = 'var(--po-font-mono)';

export const CHROME_LABEL_TYPOGRAPHY: CSSProperties = {
  fontFamily: FONT_SANS,
  fontSize: 'var(--po-font-size-chrome)',
  fontWeight: 'var(--po-font-weight-chrome)',
  letterSpacing: 0,
};

export const SIDEBAR_ROW_TYPOGRAPHY: CSSProperties = {
  ...CHROME_LABEL_TYPOGRAPHY,
};

export const SIDEBAR_META_TYPOGRAPHY: CSSProperties = {
  fontFamily: FONT_SANS,
  fontSize: 12,
  fontWeight: 'var(--po-font-weight-chrome)',
  letterSpacing: 0,
};
