'use client';

import { useState } from 'react';
import {
  ArrowRight,
  Bot,
  Check,
  Cloud,
  Database,
  FileText,
  Folder,
  GitBranch,
  KeyRound,
  Link2,
  LockKeyhole,
  ShieldCheck,
} from 'lucide-react';
import type { CSSProperties } from 'react';
import type { LucideIcon } from 'lucide-react';

interface Props {
  onDone: () => void;
}

// English-only by product policy — Puppyone does not ship UI in any other
// language right now, so the welcome modal hardcodes its copy directly
// instead of going through next-intl.  When/if multi-language support is
// reintroduced, lift these strings back into messages/<locale>.json under
// `onboarding.welcome`.
const SLIDES = [
  {
    id: 'workspace',
    title: 'One workspace for every agent',
    subtitle:
      'Keep files, versions, tools, and agent context in one shared place.',
    caption: 'Context stays organized as work moves between people and agents',
  },
  {
    id: 'connect',
    title: 'Connect sources into live context',
    subtitle:
      'Sync GitHub, Drive, docs, URLs, and local folders into a versioned workspace.',
    caption: 'Every import lands as structured, searchable project context',
  },
  {
    id: 'access',
    title: 'Give agents the right scope',
    subtitle:
      'Authorize only the folders, files, and tools each agent should use.',
    caption: 'Permissions stay explicit, auditable, and easy to review',
  },
] as const;

type SlideId = typeof SLIDES[number]['id'];

export function WelcomeModal({ onDone }: Readonly<Props>) {
  const [slide, setSlide] = useState(0);

  const isLast = slide === SLIDES.length - 1;
  const current = SLIDES[slide];

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'var(--po-backdrop-strong)', backdropFilter: 'blur(12px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24,
    }}>
      <div style={{
        width: 'min(760px, calc(100vw - 48px))',
        background: 'var(--po-overlay)', borderRadius: 16,
        border: '1px solid var(--po-active)',
        boxShadow: '0 24px 80px var(--po-shadow)',
        overflow: 'hidden', display: 'flex', flexDirection: 'column',
      }}>
        {/* Visual area */}
        <div style={{
          position: 'relative', width: '100%', height: 350,
          background: 'var(--po-inset)', overflow: 'hidden',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <SlideVisual id={current.id} caption={current.caption} />
        </div>

        {/* Content */}
        <div style={{ padding: '26px 40px 32px' }}>
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
                  background: i === slide ? 'var(--po-accent)' : 'color-mix(in srgb, var(--po-text) 22%, transparent)',
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
              color: 'var(--po-text)',
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
              color: 'var(--po-text-muted)',
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
                height: 34, padding: '0 22px', fontSize: 13, color: 'var(--po-text-subtle)',
                background: 'none', border: '1px solid var(--po-border-strong)',
                borderRadius: 8, cursor: 'pointer',
              }}
            >
              Skip
            </button>
            <button
              onClick={() => { if (isLast) onDone(); else setSlide(s => s + 1); }}
              style={{
                height: 34, padding: '0 30px', fontSize: 13, fontWeight: 600,
                color: 'var(--po-text-inverse)', background: 'var(--po-accent)',
                border: 'none', borderRadius: 8, cursor: 'pointer',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--po-accent-text)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'var(--po-accent)')}
            >
              {isLast ? 'Get started' : 'Next →'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SlideVisual({ id, caption }: { id: SlideId; caption: string }) {
  return (
    <div style={visualStageStyle}>
      <div style={visualGridStyle} />
      <div style={visualContentStyle}>
        {id === 'workspace' && <WorkspaceVisual />}
        {id === 'connect' && <ConnectVisual />}
        {id === 'access' && <AccessVisual />}
      </div>
      <div style={captionStyle}>{caption}</div>
    </div>
  );
}

function WorkspaceVisual() {
  return (
    <div style={{ ...visualLayoutStyle, gridTemplateColumns: '150px 1fr 150px' }}>
      <div style={sideStackStyle}>
        <SourceTile icon={GitBranch} label="GitHub" value="repo" tone="blue" />
        <SourceTile icon={Cloud} label="Drive" value="docs" tone="green" />
        <SourceTile icon={Database} label="DB" value="records" tone="amber" />
      </div>

      <div style={workspacePanelStyle}>
        <div style={panelChromeStyle}>
          <span style={chromeDotStyle} />
          <span style={chromeDotStyle} />
          <span style={chromeDotStyle} />
          <span style={chromeTitleStyle}>Context Space</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '116px 1fr', minHeight: 184 }}>
          <div style={sidebarMiniStyle}>
            <MiniNav icon={Folder} label="Files" active />
            <MiniNav icon={GitBranch} label="History" />
            <MiniNav icon={ShieldCheck} label="Access" />
          </div>
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <FileRow icon={Folder} name="product-research" meta="12 files" accent="var(--po-accent)" />
            <FileRow icon={FileText} name="meeting-notes.md" meta="updated now" accent="var(--po-success)" />
            <FileRow icon={FileText} name="agent-plan.json" meta="v24" accent="var(--po-file-accent-json)" />
            <div style={commitStripStyle}>
              <GitBranch size={14} />
              <span>commit 1e0a754</span>
              <span style={{ marginLeft: 'auto' }}>synced</span>
            </div>
          </div>
        </div>
      </div>

      <div style={sideStackStyle}>
        <AgentTile label="Research" status="read" />
        <AgentTile label="Writer" status="write" />
        <AgentTile label="Ops" status="tools" />
      </div>
    </div>
  );
}

function ConnectVisual() {
  return (
    <div style={{ ...visualLayoutStyle, gridTemplateColumns: '170px 1fr 170px' }}>
      <div style={sourceColumnStyle}>
        <SourceTile icon={GitBranch} label="GitHub" value="main" tone="blue" />
        <SourceTile icon={Cloud} label="Drive" value="shared" tone="green" />
        <SourceTile icon={Link2} label="URLs" value="crawl" tone="violet" />
      </div>

      <div style={pipelineStyle}>
        <PipelineStep icon={ArrowRight} label="Import" />
        <PipelineStep icon={FileText} label="Normalize" />
        <PipelineStep icon={GitBranch} label="Version" />
      </div>

      <div style={versionStackStyle}>
        <div style={stackHeaderStyle}>
          <Folder size={16} />
          <span>Workspace</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <FileRow icon={FileText} name="repo-notes.md" meta="v18" accent="var(--po-accent)" compact />
          <FileRow icon={FileText} name="drive-summary.md" meta="v7" accent="var(--po-success)" compact />
          <FileRow icon={FileText} name="web-research.json" meta="v3" accent="var(--po-file-accent-json)" compact />
        </div>
        <div style={versionBadgeStyle}>versioned context</div>
      </div>
    </div>
  );
}

function AccessVisual() {
  return (
    <div style={{ ...visualLayoutStyle, gridTemplateColumns: '190px 1fr 190px' }}>
      <div style={scopeTreeStyle}>
        <div style={stackHeaderStyle}>
          <Folder size={16} />
          <span>Project scope</span>
        </div>
        <ScopeRow label="/docs" active />
        <ScopeRow label="/customer-notes" />
        <ScopeRow label="/private" locked />
        <ScopeRow label="/tools/search" active />
      </div>

      <div style={policyPanelStyle}>
        <div style={shieldBadgeStyle}>
          <ShieldCheck size={22} />
        </div>
        <div style={{ textAlign: 'center', fontSize: 13, fontWeight: 700, color: 'var(--po-text)' }}>
          Access policy
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
          <PolicyLine icon={Check} label="Read project docs" />
          <PolicyLine icon={Check} label="Write drafts" />
          <PolicyLine icon={LockKeyhole} label="Block private files" muted />
        </div>
      </div>

      <div style={agentColumnStyle}>
        <AccessAgent label="Research agent" access="read/write" allowed />
        <AccessAgent label="Support agent" access="read only" allowed />
        <AccessAgent label="External tool" access="blocked" />
      </div>
    </div>
  );
}

function SourceTile({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  tone: 'blue' | 'green' | 'amber' | 'violet';
}) {
  const color = toneColors[tone];
  return (
    <div style={{ ...tileStyle, borderColor: color.border, background: color.bg }}>
      <div style={{ ...tileIconStyle, color: color.fg }}>
        <Icon size={16} />
      </div>
      <div>
        <div style={tileLabelStyle}>{label}</div>
        <div style={tileValueStyle}>{value}</div>
      </div>
    </div>
  );
}

function AgentTile({ label, status }: { label: string; status: string }) {
  return (
    <div style={agentTileStyle}>
      <div style={agentIconStyle}>
        <Bot size={15} />
      </div>
      <div>
        <div style={tileLabelStyle}>{label}</div>
        <div style={tileValueStyle}>{status}</div>
      </div>
    </div>
  );
}

function MiniNav({ icon: Icon, label, active = false }: { icon: LucideIcon; label: string; active?: boolean }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 7,
      height: 28,
      padding: '0 8px',
      borderRadius: 7,
      color: active ? 'var(--po-text)' : 'var(--po-text-subtle)',
      background: active ? 'var(--po-control)' : 'transparent',
      fontSize: 11,
      fontWeight: active ? 700 : 500,
    }}>
      <Icon size={13} />
      <span>{label}</span>
    </div>
  );
}

function FileRow({
  icon: Icon,
  name,
  meta,
  accent,
  compact = false,
}: {
  icon: LucideIcon;
  name: string;
  meta: string;
  accent: string;
  compact?: boolean;
}) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 9,
      minHeight: compact ? 30 : 34,
      padding: compact ? '5px 8px' : '6px 10px',
      border: '1px solid var(--po-border-subtle)',
      borderRadius: 8,
      background: 'var(--po-panel)',
    }}>
      <div style={{
        width: 22,
        height: 22,
        borderRadius: 6,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'color-mix(in srgb, var(--po-text) 5%, transparent)',
        color: accent,
        flexShrink: 0,
      }}>
        <Icon size={14} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: compact ? 10 : 11, fontWeight: 700, color: 'var(--po-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {name}
        </div>
        <div style={{ fontSize: 9, color: 'var(--po-text-subtle)' }}>{meta}</div>
      </div>
    </div>
  );
}

function PipelineStep({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <div style={pipelineStepStyle}>
      <div style={pipelineIconStyle}>
        <Icon size={15} />
      </div>
      <span>{label}</span>
    </div>
  );
}

function ScopeRow({ label, active = false, locked = false }: { label: string; active?: boolean; locked?: boolean }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '8px 10px',
      borderRadius: 8,
      border: `1px solid ${active ? 'var(--po-active)' : 'var(--po-border-subtle)'}`,
      background: active ? 'var(--po-control)' : 'var(--po-panel)',
      color: locked ? 'var(--po-text-subtle)' : 'var(--po-text)',
      fontSize: 11,
      fontWeight: 650,
    }}>
      {locked ? <LockKeyhole size={14} /> : <Folder size={14} />}
      <span>{label}</span>
    </div>
  );
}

function PolicyLine({ icon: Icon, label, muted = false }: { icon: LucideIcon; label: string; muted?: boolean }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      fontSize: 11,
      color: muted ? 'var(--po-text-subtle)' : 'var(--po-text)',
      fontWeight: 600,
    }}>
      <span style={{
        width: 20,
        height: 20,
        borderRadius: 999,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: muted
          ? 'color-mix(in srgb, var(--po-text) 6%, transparent)'
          : 'color-mix(in srgb, var(--po-success) 14%, transparent)',
        color: muted ? 'var(--po-text-subtle)' : 'var(--po-success)',
      }}>
        <Icon size={12} />
      </span>
      {label}
    </div>
  );
}

function AccessAgent({ label, access, allowed = false }: { label: string; access: string; allowed?: boolean }) {
  return (
    <div style={{
      ...agentTileStyle,
      borderColor: allowed ? 'var(--po-active)' : 'var(--po-border-subtle)',
      background: allowed ? 'color-mix(in srgb, var(--po-success) 8%, var(--po-panel))' : 'var(--po-panel)',
    }}>
      <div style={{ ...agentIconStyle, color: allowed ? 'var(--po-success)' : 'var(--po-text-subtle)' }}>
        {allowed ? <Bot size={15} /> : <KeyRound size={15} />}
      </div>
      <div>
        <div style={tileLabelStyle}>{label}</div>
        <div style={tileValueStyle}>{access}</div>
      </div>
    </div>
  );
}

const toneColors = {
  blue: {
    bg: 'color-mix(in srgb, var(--po-accent) 10%, var(--po-panel))',
    border: 'color-mix(in srgb, var(--po-accent) 38%, var(--po-border))',
    fg: 'var(--po-accent)',
  },
  green: {
    bg: 'color-mix(in srgb, var(--po-success) 10%, var(--po-panel))',
    border: 'color-mix(in srgb, var(--po-success) 38%, var(--po-border))',
    fg: 'var(--po-success)',
  },
  amber: {
    bg: 'color-mix(in srgb, var(--po-warning) 12%, var(--po-panel))',
    border: 'color-mix(in srgb, var(--po-warning) 38%, var(--po-border))',
    fg: 'var(--po-warning)',
  },
  violet: {
    bg: 'color-mix(in srgb, var(--po-file-accent-image) 10%, var(--po-panel))',
    border: 'color-mix(in srgb, var(--po-file-accent-image) 34%, var(--po-border))',
    fg: 'var(--po-file-accent-image)',
  },
};

const visualStageStyle: CSSProperties = {
  position: 'relative',
  width: '100%',
  height: '100%',
  padding: 28,
  boxSizing: 'border-box',
};

const visualGridStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  opacity: 0.45,
  backgroundImage: 'radial-gradient(color-mix(in srgb, var(--po-text) 14%, transparent) 1px, transparent 1px)',
  backgroundSize: '22px 22px',
};

const visualContentStyle: CSSProperties = {
  position: 'relative',
  height: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const visualLayoutStyle: CSSProperties = {
  width: 'min(640px, 100%)',
  display: 'grid',
  gap: 16,
  alignItems: 'center',
};

const captionStyle: CSSProperties = {
  position: 'absolute',
  left: 0,
  right: 0,
  bottom: 14,
  textAlign: 'center',
  color: 'var(--po-text-subtle)',
  fontSize: 11,
  fontWeight: 600,
};

const sideStackStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
};

const sourceColumnStyle: CSSProperties = {
  ...sideStackStyle,
};

const tileStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 9,
  minHeight: 46,
  padding: '8px 10px',
  border: '1px solid var(--po-border)',
  borderRadius: 10,
  boxSizing: 'border-box',
  boxShadow: '0 8px 20px color-mix(in srgb, var(--po-shadow) 20%, transparent)',
};

const tileIconStyle: CSSProperties = {
  width: 28,
  height: 28,
  borderRadius: 8,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'color-mix(in srgb, var(--po-panel) 72%, transparent)',
  flexShrink: 0,
};

const tileLabelStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 750,
  color: 'var(--po-text)',
  lineHeight: 1.2,
};

const tileValueStyle: CSSProperties = {
  fontSize: 9,
  fontWeight: 650,
  color: 'var(--po-text-subtle)',
  lineHeight: 1.2,
  marginTop: 2,
};

const workspacePanelStyle: CSSProperties = {
  border: '1px solid var(--po-active)',
  borderRadius: 14,
  overflow: 'hidden',
  background: 'var(--po-panel)',
  boxShadow: '0 18px 44px color-mix(in srgb, var(--po-shadow) 35%, transparent)',
};

const panelChromeStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  height: 34,
  padding: '0 12px',
  borderBottom: '1px solid var(--po-border-subtle)',
  background: 'color-mix(in srgb, var(--po-text) 4%, var(--po-panel))',
};

const chromeDotStyle: CSSProperties = {
  width: 7,
  height: 7,
  borderRadius: 999,
  background: 'color-mix(in srgb, var(--po-text) 20%, transparent)',
};

const chromeTitleStyle: CSSProperties = {
  marginLeft: 6,
  fontSize: 11,
  fontWeight: 800,
  color: 'var(--po-text)',
};

const sidebarMiniStyle: CSSProperties = {
  borderRight: '1px solid var(--po-border-subtle)',
  padding: 12,
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  background: 'color-mix(in srgb, var(--po-text) 3%, transparent)',
};

const commitStripStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 7,
  height: 28,
  padding: '0 10px',
  borderRadius: 8,
  background: 'color-mix(in srgb, var(--po-accent) 10%, transparent)',
  color: 'var(--po-accent)',
  fontSize: 10,
  fontWeight: 800,
};

const agentTileStyle: CSSProperties = {
  ...tileStyle,
  background: 'var(--po-panel)',
  borderColor: 'var(--po-border-subtle)',
};

const agentIconStyle: CSSProperties = {
  ...tileIconStyle,
  color: 'var(--po-accent)',
};

const pipelineStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 10,
  minHeight: 116,
  padding: 14,
  borderRadius: 14,
  border: '1px solid var(--po-border)',
  background: 'color-mix(in srgb, var(--po-panel) 78%, transparent)',
};

const pipelineStepStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 7,
  minWidth: 72,
  color: 'var(--po-text)',
  fontSize: 11,
  fontWeight: 800,
};

const pipelineIconStyle: CSSProperties = {
  width: 38,
  height: 38,
  borderRadius: 10,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: 'var(--po-accent)',
  background: 'color-mix(in srgb, var(--po-accent) 12%, var(--po-panel))',
  border: '1px solid color-mix(in srgb, var(--po-accent) 28%, var(--po-border))',
};

const versionStackStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  padding: 12,
  borderRadius: 14,
  border: '1px solid var(--po-active)',
  background: 'var(--po-panel)',
  boxShadow: '0 16px 36px color-mix(in srgb, var(--po-shadow) 28%, transparent)',
};

const stackHeaderStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 7,
  color: 'var(--po-text)',
  fontSize: 12,
  fontWeight: 800,
};

const versionBadgeStyle: CSSProperties = {
  height: 24,
  borderRadius: 999,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'color-mix(in srgb, var(--po-success) 12%, transparent)',
  color: 'var(--po-success)',
  fontSize: 10,
  fontWeight: 800,
};

const scopeTreeStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: 12,
  borderRadius: 14,
  background: 'var(--po-panel)',
  border: '1px solid var(--po-border)',
};

const policyPanelStyle: CSSProperties = {
  minHeight: 170,
  padding: 16,
  borderRadius: 16,
  border: '1px solid var(--po-active)',
  background: 'var(--po-panel)',
  boxShadow: '0 18px 44px color-mix(in srgb, var(--po-shadow) 32%, transparent)',
};

const shieldBadgeStyle: CSSProperties = {
  width: 46,
  height: 46,
  borderRadius: 14,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  margin: '0 auto 10px',
  color: 'var(--po-success)',
  background: 'color-mix(in srgb, var(--po-success) 12%, transparent)',
  border: '1px solid color-mix(in srgb, var(--po-success) 30%, var(--po-border))',
};

const agentColumnStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
};
