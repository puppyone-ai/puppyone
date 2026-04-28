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
    <div style={{ padding: '12px 16px', borderBottom: '1px solid #1a1a1a' }}>
      <div style={{ fontSize: 11, color: '#555', marginBottom: 8 }}>{t('language')}</div>
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
                padding: '4px 12px', fontSize: 12, borderRadius: 6, cursor: 'pointer',
                background: isActive ? '#2563eb' : '#1a1a1a',
                color: isActive ? '#fff' : '#888',
                border: `1px solid ${isActive ? '#2563eb' : '#333'}`,
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
