'use client';

import { useState } from 'react';
import Image from 'next/image';
import { useTranslations } from 'next-intl';

interface Props {
  onDone: () => void;
}

export function WelcomeModal({ onDone }: Readonly<Props>) {
  const t = useTranslations('onboarding.welcome');
  const [slide, setSlide] = useState(0);

  const SLIDES = [
    { title: t('slide0Title'), subtitle: t('slide0Subtitle'), image: '/old-vs-new-world.png', imageAlt: t('slide0Title'), imageCaption: t('slide0Caption') },
    { title: t('slide1Title'), subtitle: t('slide1Subtitle'), image: '/connect-demo.gif',      imageAlt: t('slide1Title'), imageCaption: t('slide1Caption') },
    { title: t('slide2Title'), subtitle: t('slide2Subtitle'), image: '/auth-demo.gif',         imageAlt: t('slide2Title'), imageCaption: t('slide2Caption') },
  ];

  const isLast = slide === SLIDES.length - 1;
  const current = SLIDES[slide];

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(12px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        width: '100%', maxWidth: 700,
        background: '#111', borderRadius: 16,
        border: '1px solid rgba(255,255,255,0.1)',
        boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
        overflow: 'hidden', display: 'flex', flexDirection: 'column',
      }}>
        {/* Image area */}
        <div style={{
          position: 'relative', width: '100%', height: 340,
          background: '#0a0a0a', overflow: 'hidden',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Image
            src={current.image}
            alt={current.imageAlt}
            fill
            style={{ objectFit: 'contain', padding: 24 }}
            priority
            unoptimized={current.image.endsWith('.gif')}
          />
          <div style={{
            position: 'absolute', bottom: 12, left: 0, right: 0,
            textAlign: 'center', fontSize: 11, color: 'rgba(255,255,255,0.35)',
            letterSpacing: '0.05em',
          }}>
            {current.imageCaption}
          </div>
        </div>

        {/* Content */}
        <div style={{ padding: '28px 36px 32px' }}>
          {/* Dots */}
          <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginBottom: 20 }}>
            {SLIDES.map((s, i) => (
              <button
                key={s.title}
                type="button"
                onClick={() => setSlide(i)}
                aria-label={s.title}
                style={{
                  width: i === slide ? 20 : 6, height: 6, borderRadius: 3,
                  background: i === slide ? '#3b82f6' : 'rgba(255,255,255,0.2)',
                  cursor: 'pointer', transition: 'all 0.25s',
                  border: 'none', padding: 0,
                }}
              />
            ))}
          </div>

          <h2 style={{ fontSize: 22, fontWeight: 700, color: '#f4f4f5', marginBottom: 10, textAlign: 'center' }}>
            {current.title}
          </h2>
          <p style={{ fontSize: 14, color: '#a1a1aa', lineHeight: 1.7, textAlign: 'center', marginBottom: 28 }}>
            {current.subtitle}
          </p>

          <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
            <button
              onClick={onDone}
              style={{
                padding: '8px 20px', fontSize: 13, color: '#71717a',
                background: 'none', border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 8, cursor: 'pointer',
              }}
            >
              {t('skip')}
            </button>
            <button
              onClick={() => { if (isLast) onDone(); else setSlide(s => s + 1); }}
              style={{
                padding: '8px 28px', fontSize: 13, fontWeight: 600,
                color: '#fff', background: '#3b82f6',
                border: 'none', borderRadius: 8, cursor: 'pointer',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = '#2563eb')}
              onMouseLeave={e => (e.currentTarget.style.background = '#3b82f6')}
            >
              {isLast ? t('start') : t('next')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
