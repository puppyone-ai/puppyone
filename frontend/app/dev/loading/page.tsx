'use client';

/**
 * /dev/loading — visual showcase for the unified loading system.
 *
 * Renders every loader at every size × tone × variant on a single
 * page so designers and reviewers can pick the canonical defaults
 * without having to grep the codebase. Lives at /dev/loading
 * (outside the auth-gated `(main)` group) so it can be opened by
 * anyone with the URL, no Supabase session required.
 *
 * SAFE to delete once the loader system is locked in. Until then,
 * keep it under `/dev/*` so it doesn't appear in any public sitemap.
 */

import { useState, useEffect } from 'react';
import {
  PulseGrid,
  Dots,
  InlineLoading,
  PageLoading,
  Skeleton,
  ALL_SIZES,
  ALL_TONES,
  type LoaderSize,
  type LoaderTone,
} from '@/components/loading';

const PATTERNS = ['diagonal', 'row', 'radial'] as const;
type Pattern = (typeof PATTERNS)[number];

export default function LoadingShowcasePage() {
  // Lift global controls so the user can scrub all examples at once
  // — the easiest way to feel which combination "fits".
  const [pattern, setPattern] = useState<Pattern>('diagonal');
  const [tone, setTone] = useState<LoaderTone>('neutral');
  const [previewFullScreen, setPreviewFullScreen] = useState(false);

  // Auto-close the full-screen preview after 4s so a misclick doesn't
  // strand the user.
  useEffect(() => {
    if (!previewFullScreen) return;
    const t = setTimeout(() => setPreviewFullScreen(false), 4000);
    return () => clearTimeout(t);
  }, [previewFullScreen]);

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#0a0a0a',
        color: '#e4e4e7',
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Arial, sans-serif',
      }}
    >
      {/* ── Header ─────────────────────────────────────────────── */}
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 10,
          padding: '20px 32px',
          borderBottom: '1px solid #1f1f23',
          background: 'rgba(10,10,10,0.92)',
          backdropFilter: 'blur(8px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <div style={{ fontSize: 16, fontWeight: 600, color: '#fafafa' }}>
            Loading System
          </div>
          <div style={{ fontSize: 12, color: '#71717a', marginTop: 2 }}>
            <code>components/loading/</code> · live preview
          </div>
        </div>

        <div style={{ display: 'flex', gap: 24, alignItems: 'center' }}>
          <ControlGroup
            label="Pattern"
            value={pattern}
            options={PATTERNS as readonly string[]}
            onChange={v => setPattern(v as Pattern)}
          />
          <ControlGroup
            label="Tone"
            value={tone}
            options={ALL_TONES as readonly string[]}
            onChange={v => setTone(v as LoaderTone)}
          />
          <button
            onClick={() => setPreviewFullScreen(true)}
            style={{
              padding: '6px 12px',
              borderRadius: 6,
              background: '#27272a',
              border: '1px solid #3f3f46',
              color: '#e4e4e7',
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            Preview full-screen
          </button>
        </div>
      </header>

      <main
        style={{
          maxWidth: 1100,
          margin: '0 auto',
          padding: '40px 32px 96px',
          display: 'flex',
          flexDirection: 'column',
          gap: 56,
        }}
      >
        {/* ── 1. PulseGrid — every size × current tone × current pattern ── */}
        <Section
          title="PulseGrid"
          subtitle={
            'The canonical loader. 3×3 dots; pattern + tone above scrubs both sizes at once. After the 2026-05-08 round-2 collapse, only `xs` and `sm` remain — `sm` is the default for every region-filling state.'
          }
        >
          <SwatchRow>
            {ALL_SIZES.map(size => (
              <Swatch key={size} label={`size="${size}"`}>
                <PulseGrid size={size} tone={tone} pattern={pattern} />
              </Swatch>
            ))}
          </SwatchRow>
        </Section>

        {/* ── 2. PulseGrid — every tone at sm (default) ── */}
        <Section
          title="Tones"
          subtitle="sm size (default), diagonal pattern. Use neutral by default; reach for a coloured tone only when the colour itself communicates state."
        >
          <SwatchRow>
            {ALL_TONES.map(t => (
              <Swatch key={t} label={`tone="${t}"`}>
                <PulseGrid tone={t} />
              </Swatch>
            ))}
          </SwatchRow>
        </Section>

        {/* ── 3. PulseGrid — every pattern at sm neutral ── */}
        <Section
          title="Patterns"
          subtitle="The wave's stagger. Diagonal is the most fluid; row mimics Cursor's loader; radial pulses outward from the centre."
        >
          <SwatchRow>
            {PATTERNS.map(p => (
              <Swatch key={p} label={`pattern="${p}"`}>
                <PulseGrid tone={tone} pattern={p} />
              </Swatch>
            ))}
          </SwatchRow>
        </Section>

        {/* ── 4. Dots — for buttons ── */}
        <Section
          title="Dots"
          subtitle="Three horizontal dots. Use INSIDE buttons (where vertical room is tight)."
        >
          <SwatchRow>
            {ALL_SIZES.map(size => (
              <Swatch key={size} label={`size="${size}"`}>
                <Dots size={size} tone={tone} />
              </Swatch>
            ))}
          </SwatchRow>
          <div style={{ marginTop: 24, display: 'flex', gap: 12 }}>
            <button style={demoButtonStyle}>
              <Dots size="xs" tone="neutral" /> Saving…
            </button>
            <button style={{ ...demoButtonStyle, background: '#1e40af' }}>
              <Dots size="xs" tone="info" /> Connecting…
            </button>
            <button style={{ ...demoButtonStyle, background: '#3a1818' }}>
              <Dots size="xs" tone="danger" /> Retrying…
            </button>
          </div>
        </Section>

        {/* ── 5. InlineLoading — replaces "Loading…" text ── */}
        <Section
          title="InlineLoading"
          subtitle="Drop-in replacement for the bare “Loading…” text scattered across sidebars, table cells, dialogs."
        >
          <div
            style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
          >
            <DemoRow label="Default">
              <InlineLoading />
            </DemoRow>
            <DemoRow label="With label">
              <InlineLoading label="Loading…" />
            </DemoRow>
            <DemoRow label="With custom label, info tone">
              <InlineLoading label="Syncing from Notion…" tone="info" />
            </DemoRow>
            <DemoRow label="With contextual label">
              <InlineLoading label="Loading project history…" />
            </DemoRow>
          </div>
        </Section>

        {/* ── 6. PageLoading variants ── */}
        <Section
          title="PageLoading"
          subtitle="Full-bleed centred loader. variant='fill' fits any positioned parent; variant='screen' takes the whole viewport."
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 16,
            }}
          >
            <PreviewBox label='variant="fill"'>
              <PageLoading variant="fill" tone={tone} />
            </PreviewBox>
            <PreviewBox label='variant="fill" + label'>
              <PageLoading
                variant="fill"
                tone={tone}
                label="Signing you in…"
              />
            </PreviewBox>
          </div>
          <div style={{ marginTop: 12, fontSize: 12, color: '#71717a' }}>
            Tap <em>“Preview full-screen”</em> in the header to see{' '}
            <code>variant=&quot;screen&quot;</code> over the whole viewport
            (auto-closes after 4s).
          </div>
        </Section>

        {/* ── 7. Skeleton variants ── */}
        <Section
          title="Skeleton"
          subtitle="Predictable layouts → use a Skeleton, not a spinner. The user sees the eventual shape immediately."
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 16,
            }}
          >
            <PreviewBox label="<Skeleton.Text lines={3} />">
              <div style={{ padding: 16 }}>
                <Skeleton.Text lines={3} />
              </div>
            </PreviewBox>
            <PreviewBox label="<Skeleton.List rows={4} />">
              <div style={{ padding: 16 }}>
                <Skeleton.List rows={4} />
              </div>
            </PreviewBox>
            <PreviewBox label="<Skeleton.Card />">
              <div style={{ padding: 16 }}>
                <Skeleton.Card />
              </div>
            </PreviewBox>
            <PreviewBox label="<Skeleton.Editor />">
              <Skeleton.Editor />
            </PreviewBox>
          </div>

          <div style={{ marginTop: 16 }}>
            <div
              style={{
                fontSize: 11,
                color: '#71717a',
                marginBottom: 8,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
              }}
            >
              Skeleton.Dashboard
            </div>
            <PreviewBox style={{ height: 360 }}>
              <Skeleton.Dashboard />
            </PreviewBox>
          </div>
        </Section>

        {/* ── 8. Decision matrix ── */}
        <Section title="When to use what">
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: 13,
              color: '#d4d4d8',
            }}
          >
            <thead>
              <tr style={{ borderBottom: '1px solid #27272a' }}>
                <Th>Surface</Th>
                <Th>Component</Th>
                <Th>Replaces</Th>
              </tr>
            </thead>
            <tbody>
              <Row
                surface="Whole route / app shell"
                code='<PageLoading />'
                replaces="login post-auth, /home initial, OAuth callbacks"
              />
              <Row
                surface="Inside a panel / dialog"
                code='<PageLoading variant="fill" />'
                replaces="Right-rail PanelLoading, sandbox/mcp config"
              />
              <Row
                surface="Inline text replacement"
                code='<InlineLoading label="Loading…" />'
                replaces="30+ bare “Loading…” divs"
              />
              <Row
                surface="Single-line meta"
                code='<PulseGrid size="sm" />'
                replaces="NodeAccessPanel.LoadingIcon, history page spinner"
              />
              <Row
                surface="Inside a button"
                code='<Dots size="xs" /> Saving…'
                replaces="ChatInputArea spinner, every Saving/Creating button"
              />
              <Row
                surface="Predictable layout"
                code="<Skeleton.Editor /> etc."
                replaces="EditorSkeleton, home dashboard skeleton"
              />
            </tbody>
          </table>
        </Section>
      </main>

      {/* ── Full-screen preview overlay ────────────────────────── */}
      {previewFullScreen && (
        <div
          onClick={() => setPreviewFullScreen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 50,
            cursor: 'pointer',
          }}
        >
          <PageLoading
            tone={tone}
            label='click anywhere to dismiss · auto-closes in 4s'
          />
        </div>
      )}
    </div>
  );
}

// ─── Local presentation primitives ─────────────────────────────────

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div style={{ marginBottom: 16 }}>
        <h2
          style={{
            margin: 0,
            fontSize: 15,
            fontWeight: 600,
            color: '#fafafa',
            letterSpacing: '-0.01em',
          }}
        >
          {title}
        </h2>
        {subtitle && (
          <p
            style={{
              margin: '4px 0 0',
              fontSize: 13,
              color: '#71717a',
              lineHeight: 1.5,
              maxWidth: 720,
            }}
          >
            {subtitle}
          </p>
        )}
      </div>
      {children}
    </section>
  );
}

function SwatchRow({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
        gap: 12,
      }}
    >
      {children}
    </div>
  );
}

function Swatch({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: '#111114',
        border: '1px solid #1f1f23',
        borderRadius: 8,
        padding: '24px 16px 12px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 16,
        minHeight: 100,
      }}
    >
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 32,
        }}
      >
        {children}
      </div>
      <code style={{ fontSize: 11, color: '#71717a' }}>{label}</code>
    </div>
  );
}

function DemoRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '220px 1fr',
        alignItems: 'center',
        gap: 16,
        padding: '12px 16px',
        background: '#111114',
        border: '1px solid #1f1f23',
        borderRadius: 6,
      }}
    >
      <code style={{ fontSize: 11, color: '#71717a' }}>{label}</code>
      <div>{children}</div>
    </div>
  );
}

function PreviewBox({
  label,
  children,
  style,
}: {
  label?: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        background: '#0e0e0e',
        border: '1px solid #1f1f23',
        borderRadius: 8,
        overflow: 'hidden',
        position: 'relative',
        minHeight: 180,
        ...style,
      }}
    >
      {label && (
        <div
          style={{
            position: 'absolute',
            top: 8,
            left: 12,
            fontSize: 10,
            color: '#52525b',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            zIndex: 1,
          }}
        >
          {label}
        </div>
      )}
      {children}
    </div>
  );
}

function ControlGroup({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (v: string) => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 11, color: '#52525b' }}>{label}</span>
      <div
        style={{
          display: 'inline-flex',
          background: '#111114',
          border: '1px solid #27272a',
          borderRadius: 6,
          padding: 2,
        }}
      >
        {options.map(opt => {
          const active = opt === value;
          return (
            <button
              key={opt}
              onClick={() => onChange(opt)}
              style={{
                padding: '4px 10px',
                fontSize: 11,
                lineHeight: 1.4,
                borderRadius: 4,
                border: 'none',
                background: active ? '#27272a' : 'transparent',
                color: active ? '#fafafa' : '#71717a',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {opt}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      style={{
        textAlign: 'left',
        padding: '10px 12px',
        fontSize: 11,
        fontWeight: 500,
        color: '#71717a',
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
      }}
    >
      {children}
    </th>
  );
}

function Row({
  surface,
  code,
  replaces,
}: {
  surface: string;
  code: string;
  replaces: string;
}) {
  return (
    <tr style={{ borderBottom: '1px solid #18181b' }}>
      <td style={{ padding: '10px 12px' }}>{surface}</td>
      <td style={{ padding: '10px 12px' }}>
        <code
          style={{
            fontSize: 12,
            color: '#22d3ee',
            background: 'rgba(34,211,238,0.08)',
            padding: '2px 6px',
            borderRadius: 3,
          }}
        >
          {code}
        </code>
      </td>
      <td style={{ padding: '10px 12px', color: '#71717a' }}>{replaces}</td>
    </tr>
  );
}

const demoButtonStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 14px',
  borderRadius: 6,
  background: '#27272a',
  border: '1px solid #3f3f46',
  color: '#e4e4e7',
  fontSize: 13,
  cursor: 'default',
};
