'use client';

import { useTransition } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { setLocale } from '@/lib/actions/setLocale';

const LOCALES = [
  { code: 'en', label: 'English' },
  { code: 'zh-CN', label: '中文' },
] as const;

export function LocaleSwitcher() {
  const locale = useLocale();
  const t = useTranslations('userMenu');
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleSwitch = (code: string) => {
    if (code === locale) return;
    startTransition(async () => {
      await setLocale(code);
      router.refresh();
    });
  };

  return (
    <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--po-panel-raised)' }}>
      <div style={{ fontSize: 11, color: 'var(--po-text-subtle)', marginBottom: 8 }}>{t('language')}</div>
      <div style={{ display: 'flex', gap: 6 }}>
        {LOCALES.map(({ code, label }) => {
          const isActive = locale === code;
          return (
            <button
              key={code}
              type="button"
              disabled={isPending}
              onClick={() => handleSwitch(code)}
              style={{
                height: 30, padding: '0 12px', fontSize: 12, borderRadius: 6, cursor: 'pointer',
                background: isActive ? 'var(--po-accent)' : 'var(--po-panel-raised)',
                color: isActive ? 'var(--po-text-inverse)' : 'var(--po-text-muted)',
                border: `1px solid ${isActive ? 'var(--po-accent)' : 'var(--po-border-strong)'}`,
                fontWeight: isActive ? 600 : 400,
                opacity: isPending ? 0.6 : 1,
                transition: 'all 0.15s',
              }}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
