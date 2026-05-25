'use client';

import { ThemeToggle } from '@/components/theme/ThemeToggle';
import { CHROME_LABEL_TYPOGRAPHY, FONT_SANS } from '@/lib/uiTypography';

export default function AppearanceSettingsPage() {
  return (
    <div
      style={{
        minHeight: '100%',
        background: 'var(--po-canvas)',
        color: 'var(--po-text)',
        fontFamily: FONT_SANS,
      }}
    >
      <header
        style={{
          height: 46,
          display: 'flex',
          alignItems: 'center',
          padding: '0 24px',
          borderBottom: '1px solid var(--po-border)',
          background: 'var(--po-header)',
        }}
      >
        <h1 style={{ ...CHROME_LABEL_TYPOGRAPHY, margin: 0, color: 'var(--po-text)' }}>
          Appearance
        </h1>
      </header>

      <main style={{ maxWidth: 760, padding: '28px 32px 48px' }}>
        <section
          style={{
            display: 'grid',
            gap: 16,
          }}
        >
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 650, letterSpacing: 0, color: 'var(--po-text)' }}>
              Color mode
            </h2>
            <p style={{ margin: '8px 0 0', maxWidth: 560, fontSize: 13, lineHeight: 1.55, color: 'var(--po-text-muted)' }}>
              Choose how Puppyone appears on this device. System follows your operating system and updates automatically.
            </p>
          </div>

          <ThemeToggle />
        </section>
      </main>
    </div>
  );
}
