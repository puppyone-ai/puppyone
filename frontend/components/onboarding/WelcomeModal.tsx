'use client';

import { useState } from 'react';
import Image from 'next/image';

interface Props {
  onDone: () => void;
}

// English-only by product policy — PuppyOne does not ship UI in any other
// language right now, so the welcome modal hardcodes its copy directly
// instead of going through next-intl.  When/if multi-language support is
// reintroduced, lift these strings back into messages/<locale>.json under
// `onboarding.welcome`.
const SLIDES = [
  {
    title: 'The File Workspace for all your agents',
    subtitle:
      "Store your data in PuppyOne so AI Agents can access it anytime — always knowing what they're working on.",
    image: '/old-vs-new-world.png',
    imageCaption: 'From scattered files to unified context',
  },
  {
    title: 'Connect any data source',
    subtitle:
      'Local folders, Google Drive, GitHub, web pages… one-click sync with automatic versioning.',
    image: '/connect-demo.gif',
    imageCaption: 'Drag and drop to connect',
  },
  {
    title: 'Fine-grained access control',
    subtitle:
      'Every Agent and tool can only access the scope you authorize — secure and auditable.',
    image: '/auth-demo.gif',
    imageCaption: 'File-level security boundaries',
  },
];

export function WelcomeModal({ onDone }: Readonly<Props>) {
  const [slide, setSlide] = useState(0);

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
            alt={current.title}
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

          {/* Title row reserves single-line height so a slide whose title
              wraps doesn't bump the modal taller than its neighbors.  At
              the 700px modal width and fontSize 22 bold, the longest current
              title ("The File Workspace for all your agents", ~490px
              rendered) fits comfortably; minHeight 32 just locks the row. */}
          <h2
            style={{
              fontSize: 22,
              fontWeight: 700,
              color: '#f4f4f5',
              marginBottom: 10,
              textAlign: 'center',
              minHeight: 32,
            }}
          >
            {current.title}
          </h2>
          {/* Subtitle is the dominant source of slide-to-slide height
              jitter: at fontSize 14 / lineHeight 1.7 each line is 23.8px,
              and the three subtitles oscillate between 1 and 2 lines
              depending on the user's effective font + viewport width.
              Reserving 2 lines (48px) flat-lines that jitter so the modal
              stays a single height across all three slides; pairing that
              with flex centering keeps the 1-line case visually balanced
              instead of top-aligning inside an over-sized box (which
              would just shift the jitter into the gap above the buttons). */}
          <p
            style={{
              fontSize: 14,
              color: '#a1a1aa',
              lineHeight: 1.7,
              textAlign: 'center',
              marginBottom: 28,
              minHeight: 48,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
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
              Skip
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
              {isLast ? 'Get started' : 'Next →'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
