'use client';

import { useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Plus } from 'lucide-react';
import { DialogBody, DialogFooter, DialogHeader, DialogRoot, DialogSurface } from '@/components/ui/Dialog';
import { TreeDisclosureMarker } from '@/components/ui/TreeDisclosureMarker';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import {
  createConnector,
  createScope,
  type Connector,
  type ConnectorDirection,
  type RepoScope,
} from '@/lib/repoApi';
import { T } from '../lib/tokens';
import { PROVIDER_LABELS } from '../lib/constants';
import { ProviderIcon } from './icons';
import { FolderAccessTree } from './FolderAccessTree';

type OptionalProvider = 'mcp' | 'sandbox';

const ACCESS_MODAL_TYPE = {
  body: 13,
  meta: 12,
  label: 11,
} as const;

const OPTIONAL_METHODS: Array<{
  readonly provider: OptionalProvider;
  readonly direction: ConnectorDirection;
  readonly description: string;
  readonly supported: boolean;
}> = [
  {
    provider: 'mcp',
    direction: 'inbound',
    description: 'External AI tools connect through MCP.',
    supported: false,
  },
  {
    provider: 'sandbox',
    direction: 'inbound',
    description: 'Run tools with this folder mounted.',
    supported: false,
  },
];

export function CreateAccessModal({
  projectId,
  existingScopes,
  connectorsByScope,
  initialPath,
  onClose,
  onCreated,
}: {
  readonly projectId: string;
  readonly existingScopes: readonly RepoScope[];
  readonly connectorsByScope: ReadonlyMap<string, readonly Connector[]>;
  readonly initialPath?: string | null;
  readonly onClose: () => void;
  readonly onCreated: (scope: RepoScope) => Promise<void> | void;
}) {
  const normalizedInitialPath = normalizePath(initialPath ?? '');
  const initialSelectedPath = normalizedInitialPath === '' ? null : normalizedInitialPath;
  const [selectedPath, setSelectedPath] = useState<string | null>(initialSelectedPath);
  const [name, setName] = useState(
    initialSelectedPath === null ? '' : defaultScopeName(initialSelectedPath),
  );
  const [nameTouched, setNameTouched] = useState(initialSelectedPath !== null);
  const [optionalProviders, setOptionalProviders] = useState<ReadonlySet<OptionalProvider>>(() => new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const existingPathSet = useMemo(
    () => new Set(existingScopes.map((scope) => normalizePath(scope.path))),
    [existingScopes],
  );

  const normalizedSelected = selectedPath === null ? null : normalizePath(selectedPath);
  const selectedExistingScope = useMemo(
    () =>
      normalizedSelected === null
        ? null
        : existingScopes.find((scope) => normalizePath(scope.path) === normalizedSelected) ?? null,
    [existingScopes, normalizedSelected],
  );
  const existingProviders = useMemo(() => {
    if (!selectedExistingScope) return new Set<string>();
    return new Set(
      (connectorsByScope.get(selectedExistingScope.id) ?? []).map((connector) => connector.provider),
    );
  }, [connectorsByScope, selectedExistingScope]);
  const optionalProvidersToCreate = useMemo(
    () => Array.from(optionalProviders).filter((provider) => {
      const method = OPTIONAL_METHODS.find((item) => item.provider === provider);
      return method?.supported === true && !existingProviders.has(provider);
    }),
    [existingProviders, optionalProviders],
  );
  const trimmedName = name.trim();
  const canCreate =
    !saving
    && normalizedSelected !== null
    && normalizedSelected !== ''
    && (selectedExistingScope !== null || trimmedName.length > 0);
  const selectedLabel = normalizedSelected === null ? 'Choose a path' : formatPath(normalizedSelected);
  const actionLabel = saving
    ? 'Saving...'
    : selectedExistingScope
      ? optionalProvidersToCreate.length > 0
        ? 'Update access'
        : 'Open access'
      : 'Create access';

  const selectPath = (path: string) => {
    const normalized = normalizePath(path);
    if (normalized === '') return;
    setSelectedPath(normalized);
    setError(null);
    if (!nameTouched) {
      setName(defaultScopeName(normalized));
    }
  };

  const toggleOptionalProvider = (provider: OptionalProvider, checked: boolean) => {
    setOptionalProviders((current) => {
      const next = new Set(current);
      if (checked) next.add(provider);
      else next.delete(provider);
      return next;
    });
  };

  const handleCreate = async () => {
    if (!canCreate || normalizedSelected === null) return;
    setSaving(true);
    setError(null);
    try {
      const scope = selectedExistingScope ?? await createScope(projectId, {
        name: (name.trim() || defaultScopeName(normalizedSelected)).slice(0, 100),
        path: normalizedSelected,
        mode: 'rw',
        exclude: [],
      });

      await createOptionalConnectors(scope, optionalProvidersToCreate, projectId);

      await onCreated(scope);
      onClose();
    } catch (err) {
      console.error('[CreateAccessModal] Failed to create access:', err);
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <DialogRoot open onClose={saving ? undefined : onClose} backdrop="strong" dismissOnBackdrop={!saving}>
      <DialogSurface width={760} ariaLabel="Create access">
        <DialogHeader
          title="New folder access"
          description="Choose a folder from Files. Git Remote and Puppyone CLI are enabled for that folder; the top-level workspace stays managed by Puppyone."
          onClose={saving ? undefined : onClose}
        />
        <DialogBody style={{ padding: '12px 20px 16px' }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
              gap: 16,
              alignItems: 'start',
            }}
          >
            <FolderAccessTree
              projectId={projectId}
              selectedPath={normalizedSelected}
              existingPathSet={existingPathSet}
              initialExpandedPath={initialSelectedPath}
              onSelect={selectPath}
            />

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
              <FieldLabel label="Access name" required>
                <input
                  value={name}
                  onChange={(event) => {
                    setNameTouched(true);
                    setName(event.target.value);
                  }}
                  placeholder={normalizedSelected === null ? 'Choose a path first' : defaultScopeName(normalizedSelected)}
                  disabled={saving}
                  style={{
                    width: '100%',
                    height: 34,
                    boxSizing: 'border-box',
                    borderRadius: 7,
                    border: `1px solid ${T.border}`,
                    background: 'var(--po-control)',
                    color: T.text1,
                    padding: '0 10px',
                    fontSize: ACCESS_MODAL_TYPE.body,
                    fontFamily: T.fontSans,
                    lineHeight: '18px',
                    outline: 'none',
                  }}
                />
              </FieldLabel>

              <FieldLabel label="Path" required>
                <div
                  title={selectedLabel}
                  style={{
                    minHeight: 36,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '0 10px',
                    borderRadius: 7,
                    border: `1px solid ${selectedExistingScope ? 'var(--po-border-strong)' : T.border}`,
                    background: 'var(--po-inset)',
                    color: normalizedSelected === null ? T.text4 : T.text2,
                    fontFamily: T.fontSans,
                    fontSize: ACCESS_MODAL_TYPE.body,
                    lineHeight: '18px',
                    overflow: 'hidden',
                  }}
                >
                  <span style={{ flexShrink: 0, color: selectedExistingScope ? 'var(--po-success)' : T.text3 }}>
                    <TreeDisclosureMarker expanded={normalizedSelected !== null} />
                  </span>
                  <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {selectedLabel}
                  </span>
                </div>
                {selectedExistingScope ? (
                  <div style={{ marginTop: 6, fontSize: ACCESS_MODAL_TYPE.meta, lineHeight: '17px', color: T.text3 }}>
                    This path already has access. You can add share methods or open it.
                  </div>
                ) : null}
              </FieldLabel>

              <div>
                <SectionHeading>Always included</SectionHeading>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <MethodRow provider="filesystem" description="Versioned read/write for this folder." locked />
                  <MethodRow provider="cli" description="Scoped command-line access to this folder." locked />
                </div>
              </div>

              <div>
                <SectionHeading>Optional methods</SectionHeading>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {OPTIONAL_METHODS.map((method) => (
                    <MethodRow
                      key={method.provider}
                      provider={method.provider}
                      description={method.description}
                      checked={method.supported && (optionalProviders.has(method.provider) || existingProviders.has(method.provider))}
                      disabled={!method.supported}
                      locked={existingProviders.has(method.provider)}
                      onCheckedChange={(checked) => toggleOptionalProvider(method.provider, checked)}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>

          {error ? (
            <div
              style={{
                marginTop: 12,
                padding: '9px 10px',
                borderRadius: 7,
                border: '1px solid color-mix(in srgb, var(--po-danger) 30%, transparent)',
                background: 'color-mix(in srgb, var(--po-danger) 7%, transparent)',
                color: 'var(--po-danger)',
                fontSize: ACCESS_MODAL_TYPE.meta,
                lineHeight: '17px',
                fontFamily: T.fontSans,
              }}
            >
              {error}
            </div>
          ) : null}
        </DialogBody>
        <DialogFooter style={{ padding: '0 20px 20px' }}>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            style={secondaryButtonStyle}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleCreate}
            disabled={!canCreate}
            style={{
              ...primaryButtonStyle,
              opacity: canCreate ? 1 : 0.45,
              cursor: canCreate ? 'pointer' : 'not-allowed',
            }}
          >
            <Plus size={14} strokeWidth={2.1} />
            {actionLabel}
          </button>
        </DialogFooter>
      </DialogSurface>
    </DialogRoot>
  );
}

function MethodRow({
  provider,
  description,
  locked = false,
  disabled = false,
  checked = false,
  onCheckedChange,
}: {
  readonly provider: string;
  readonly description: string;
  readonly locked?: boolean;
  readonly disabled?: boolean;
  readonly checked?: boolean;
  readonly onCheckedChange?: (checked: boolean) => void;
}) {
  const inactive = disabled && !locked;
  const enabled = locked || checked;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        minHeight: 48,
        padding: '8px 10px',
        borderRadius: 8,
        border: `1px solid ${enabled ? 'var(--po-border-strong)' : T.cardBorder}`,
        background: enabled ? 'var(--po-control)' : inactive ? 'color-mix(in srgb, var(--po-panel) 72%, var(--po-canvas))' : 'transparent',
        boxSizing: 'border-box',
        opacity: inactive ? 0.58 : 1,
      }}
    >
      <span
        style={{
          width: 28,
          height: 28,
          flexShrink: 0,
          borderRadius: 7,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--po-hover)',
          color: inactive ? T.text4 : T.text2,
        }}
      >
        <ProviderIcon provider={provider} size={16} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span style={{ fontSize: ACCESS_MODAL_TYPE.body, fontWeight: 600, color: inactive ? T.text3 : T.text2, fontFamily: T.fontSans, lineHeight: '18px', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {PROVIDER_LABELS[provider] ?? provider}
          </span>
          {inactive ? (
            <span
              style={{
                flexShrink: 0,
                height: 18,
                padding: '0 6px',
                borderRadius: 999,
                border: `1px solid ${T.cardBorder}`,
                color: T.text4,
                fontSize: ACCESS_MODAL_TYPE.label,
                lineHeight: '16px',
                fontWeight: 600,
                fontFamily: T.fontSans,
              }}
            >
              Soon
            </span>
          ) : null}
        </div>
        <div style={{ marginTop: 2, fontSize: ACCESS_MODAL_TYPE.meta, lineHeight: '17px', color: inactive ? T.text4 : T.text3, fontFamily: T.fontSans, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {description}
        </div>
      </div>
      <ToggleSwitch
        checked={enabled}
        onCheckedChange={locked || disabled ? undefined : onCheckedChange}
        disabled={disabled}
        ariaLabel={`${PROVIDER_LABELS[provider] ?? provider} ${enabled ? 'on' : 'off'}`}
        title={locked ? 'Already enabled' : disabled ? 'Coming soon' : undefined}
        size="xs"
      />
    </div>
  );
}

function FieldLabel({
  label,
  required = false,
  children,
}: {
  readonly label: string;
  readonly required?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <label style={{ display: 'block', minWidth: 0 }}>
      <div style={{ marginBottom: 8, fontSize: ACCESS_MODAL_TYPE.label, lineHeight: '14px', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--po-text-subtle)', fontFamily: T.fontSans, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        {label}
        {required ? (
          <span
            aria-hidden
            style={{
              width: 5,
              height: 5,
              borderRadius: 999,
              background: 'var(--po-danger)',
              display: 'inline-block',
            }}
          />
        ) : null}
      </div>
      {children}
    </label>
  );
}

function SectionHeading({ children }: { readonly children: ReactNode }) {
  return (
    <div style={{ marginBottom: 8, fontSize: ACCESS_MODAL_TYPE.label, lineHeight: '14px', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--po-text-subtle)', fontFamily: T.fontSans }}>
      {children}
    </div>
  );
}

function normalizePath(path: string): string {
  return path.trim().replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/');
}

async function createOptionalConnectors(
  scope: RepoScope,
  providers: readonly OptionalProvider[],
  projectId: string,
) {
  await Promise.all(
    providers.map((provider) => {
      const method = OPTIONAL_METHODS.find((item) => item.provider === provider);
      if (!method) return Promise.resolve();
      return createConnector(projectId, {
        scope_id: scope.id,
        provider,
        direction: method.direction,
        name: PROVIDER_LABELS[provider] ?? provider,
        config: {},
        trigger: { type: 'manual' },
      });
    }),
  );
}

function formatPath(path: string): string {
  const parts = normalizePath(path).split('/').filter(Boolean);
  return parts.length === 0 ? 'Root' : ['Root', ...parts].join(' / ');
}

function defaultScopeName(path: string): string {
  if (!path) return 'Project files';
  const last = path.split('/').filter(Boolean).at(-1) ?? path;
  return last
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function errorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return 'Could not create access. Please try again.';
}

const secondaryButtonStyle: CSSProperties = {
  height: 32,
  padding: '0 12px',
  borderRadius: 6,
  border: `1px solid ${T.border}`,
  background: 'transparent',
  color: T.text2,
  fontSize: ACCESS_MODAL_TYPE.body,
  fontWeight: 500,
  fontFamily: T.fontSans,
  lineHeight: 1,
  cursor: 'pointer',
};

const primaryButtonStyle: CSSProperties = {
  height: 32,
  padding: '0 13px',
  borderRadius: 6,
  border: '1px solid var(--po-accent)',
  background: 'var(--po-accent)',
  color: 'var(--po-text-inverse)',
  fontSize: ACCESS_MODAL_TYPE.body,
  fontWeight: 600,
  fontFamily: T.fontSans,
  lineHeight: 1,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
};
