'use client';

import { useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Check, ChevronRight, Plus } from 'lucide-react';
import { DialogBody, DialogFooter, DialogHeader, DialogRoot, DialogSurface } from '@/components/ui/Dialog';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { useContentNodes } from '@/lib/hooks/useData';
import {
  createConnector,
  createScope,
  type Connector,
  type ConnectorDirection,
  type RepoScope,
} from '@/lib/repoApi';
import { sortNodes, type NodeInfo } from '@/lib/contentTreeApi';
import { T } from '../lib/tokens';
import { PROVIDER_LABELS } from '../lib/constants';
import { FileGlyph, FolderGlyph, ProviderIcon } from './icons';

type OptionalProvider = 'mcp' | 'sandbox';

const OPTIONAL_METHODS: Array<{
  readonly provider: OptionalProvider;
  readonly direction: ConnectorDirection;
  readonly description: string;
}> = [
  {
    provider: 'mcp',
    direction: 'inbound',
    description: 'Let external AI tools connect to this folder through MCP.',
  },
  {
    provider: 'sandbox',
    direction: 'inbound',
    description: 'Run tools in a sandbox with this folder mounted.',
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
  const [browsePath, setBrowsePath] = useState(normalizedInitialPath);
  const [selectedPath, setSelectedPath] = useState<string | null>(initialSelectedPath);
  const [name, setName] = useState(
    initialSelectedPath === null ? '' : defaultScopeName(initialSelectedPath),
  );
  const [nameTouched, setNameTouched] = useState(initialSelectedPath !== null);
  const [optionalProviders, setOptionalProviders] = useState<ReadonlySet<OptionalProvider>>(() => new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { nodes, isLoading, error: treeError } = useContentNodes(projectId, browsePath);
  const entries = useMemo(
    () => sortNodes(nodes),
    [nodes],
  );
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
    () => Array.from(optionalProviders).filter((provider) => !existingProviders.has(provider)),
    [existingProviders, optionalProviders],
  );
  const canCreate = !saving && normalizedSelected !== null && normalizedSelected !== '';
  const selectedLabel = normalizedSelected === null ? 'Choose a folder' : formatPath(normalizedSelected);
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
      <DialogSurface width={720} ariaLabel="Create access">
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
            <PathPicker
              browsePath={browsePath}
              selectedPath={normalizedSelected}
              entries={entries}
              loading={isLoading}
              errored={!!treeError}
              existingPathSet={existingPathSet}
              onBrowse={setBrowsePath}
              onSelect={selectPath}
            />

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
              <FieldLabel label="Folder">
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
                    fontFamily: T.fontMono,
                    fontSize: 12,
                    overflow: 'hidden',
                  }}
                >
                  <span style={{ flexShrink: 0, color: selectedExistingScope ? 'var(--po-success)' : T.text3 }}>
                    <FolderGlyph size={14} />
                  </span>
                  <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {selectedLabel}
                  </span>
                </div>
                {selectedExistingScope ? (
                  <div style={{ marginTop: 6, fontSize: 11, lineHeight: 1.5, color: T.text3 }}>
                    This folder already has access. You can add share methods or open it.
                  </div>
                ) : null}
              </FieldLabel>

              <FieldLabel label="Access name">
                <input
                  value={name}
                  onChange={(event) => {
                    setNameTouched(true);
                    setName(event.target.value);
                  }}
                  placeholder={normalizedSelected === null ? 'Choose a folder first' : defaultScopeName(normalizedSelected)}
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
                    fontSize: 12,
                    fontFamily: T.fontSans,
                    outline: 'none',
                  }}
                />
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
                      checked={optionalProviders.has(method.provider) || existingProviders.has(method.provider)}
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
                fontSize: 12,
                lineHeight: 1.5,
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

function PathPicker({
  browsePath,
  selectedPath,
  entries,
  loading,
  errored,
  existingPathSet,
  onBrowse,
  onSelect,
}: {
  readonly browsePath: string;
  readonly selectedPath: string | null;
  readonly entries: readonly NodeInfo[];
  readonly loading: boolean;
  readonly errored: boolean;
  readonly existingPathSet: ReadonlySet<string>;
  readonly onBrowse: (path: string) => void;
  readonly onSelect: (path: string) => void;
}) {
  const isProjectRoot = browsePath === '';

  return (
    <div
      style={{
        minWidth: 0,
        borderRadius: 8,
        border: `1px solid ${T.cardBorder}`,
        background: T.cardBg,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          minHeight: 42,
          padding: '8px 10px',
          borderBottom: `1px solid ${T.cardBorder}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
        }}
      >
        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
          <div style={{ color: T.text4, fontSize: 10, fontWeight: 600, fontFamily: T.fontSans }}>
            Choose from Files
          </div>
          <Breadcrumb path={browsePath} onBrowse={onBrowse} />
        </div>
        {isProjectRoot ? (
          <span
            style={{
              flexShrink: 0,
              height: 28,
              display: 'inline-flex',
              alignItems: 'center',
              padding: '0 9px',
              borderRadius: 6,
              border: `1px solid ${T.cardBorder}`,
              color: T.text4,
              fontSize: 12,
              fontWeight: 500,
              fontFamily: T.fontSans,
            }}
          >
            Choose a folder
          </span>
        ) : (
          <button
            type="button"
            onClick={() => onSelect(browsePath)}
            title={`Choose ${formatPath(browsePath)}`}
            style={{
              flexShrink: 0,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              height: 28,
              padding: '0 9px',
              borderRadius: 6,
              border: `1px solid ${selectedPath === browsePath ? 'var(--po-accent)' : T.border}`,
              background: selectedPath === browsePath ? 'color-mix(in srgb, var(--po-accent) 13%, transparent)' : 'transparent',
              color: selectedPath === browsePath ? T.text1 : T.text2,
              fontSize: 12,
              fontWeight: 500,
              fontFamily: T.fontSans,
              cursor: 'pointer',
            }}
          >
            {selectedPath === browsePath ? <Check size={13} strokeWidth={2.4} /> : null}
            {selectedPath === browsePath ? 'Chosen folder' : 'Choose this folder'}
          </button>
        )}
      </div>

      <div style={{ height: 326, overflow: 'auto', padding: 6 }}>
        {loading ? (
          <PathPickerMessage>Loading...</PathPickerMessage>
        ) : errored ? (
          <PathPickerMessage>Could not load this folder.</PathPickerMessage>
        ) : entries.length === 0 ? (
          <PathPickerMessage>This folder is empty.</PathPickerMessage>
        ) : (
          entries.map((entry) => (
            <PickerEntryRow
              key={entry.path}
              entry={entry}
              selected={entry.type === 'folder' && selectedPath === normalizePath(entry.path)}
              alreadyExists={entry.type === 'folder' && existingPathSet.has(normalizePath(entry.path))}
              onBrowse={() => onBrowse(normalizePath(entry.path))}
              onSelect={() => onSelect(entry.path)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function Breadcrumb({
  path,
  onBrowse,
}: {
  readonly path: string;
  readonly onBrowse: (path: string) => void;
}) {
  const parts = path.split('/').filter(Boolean);

  return (
    <div
      style={{
        minWidth: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        color: T.text3,
        fontSize: 12,
        fontFamily: T.fontSans,
        overflow: 'hidden',
      }}
    >
      <button type="button" onClick={() => onBrowse('')} style={breadcrumbButtonStyle}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <FolderGlyph size={15} />
          Files
        </span>
      </button>
      {parts.map((part, index) => {
        const nextPath = parts.slice(0, index + 1).join('/');
        return (
          <span key={nextPath} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
            <ChevronRight size={12} strokeWidth={2} style={{ flexShrink: 0, color: T.text4 }} />
            <button
              type="button"
              onClick={() => onBrowse(nextPath)}
              title={part}
              style={{
                ...breadcrumbButtonStyle,
                maxWidth: 96,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {part}
            </button>
          </span>
        );
      })}
    </div>
  );
}

function PickerEntryRow({
  entry,
  selected,
  alreadyExists,
  onBrowse,
  onSelect,
}: {
  readonly entry: NodeInfo;
  readonly selected: boolean;
  readonly alreadyExists: boolean;
  readonly onBrowse: () => void;
  readonly onSelect: () => void;
}) {
  const isFolder = entry.type === 'folder';

  return (
    <div
      style={{
        height: 36,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '0 6px 0 8px',
        borderRadius: 6,
        background: selected ? 'var(--po-selected)' : 'transparent',
        color: selected ? T.text1 : isFolder ? T.text2 : T.text4,
        fontFamily: T.fontSans,
        opacity: isFolder ? 1 : 0.78,
      }}
    >
      {isFolder ? (
        <button
          type="button"
          onClick={onBrowse}
          title={`Open ${formatPath(entry.path)}`}
          style={{
            flex: 1,
            minWidth: 0,
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            border: 'none',
            background: 'transparent',
            color: 'inherit',
            padding: 0,
            cursor: 'pointer',
            textAlign: 'left',
            font: 'inherit',
          }}
        >
          <FolderGlyph size={16} />
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {entry.name}
          </span>
        </button>
      ) : (
        <div
          title={formatPath(entry.path)}
          aria-disabled="true"
          style={{
            flex: 1,
            minWidth: 0,
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <FileGlyph size={15} />
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {entry.name}
          </span>
        </div>
      )}
      {isFolder ? (
        <>
          {alreadyExists ? (
            <span style={{ flexShrink: 0, fontSize: 11, color: T.text4 }}>Has access</span>
          ) : null}
          <button
            type="button"
            onClick={onSelect}
            style={{
              flexShrink: 0,
              height: 24,
              padding: '0 8px',
              borderRadius: 5,
              border: `1px solid ${selected ? 'var(--po-border-strong)' : T.border}`,
              background: selected ? 'color-mix(in srgb, var(--po-accent) 12%, transparent)' : 'transparent',
              color: selected ? T.text1 : T.text3,
              fontSize: 11,
              fontWeight: 500,
              fontFamily: T.fontSans,
              cursor: 'pointer',
            }}
          >
            {selected ? 'Chosen' : 'Choose'}
          </button>
        </>
      ) : (
        <span style={{ flexShrink: 0, fontSize: 11, color: T.text4 }}>File</span>
      )}
    </div>
  );
}

function MethodRow({
  provider,
  description,
  locked = false,
  checked = false,
  onCheckedChange,
}: {
  readonly provider: string;
  readonly description: string;
  readonly locked?: boolean;
  readonly checked?: boolean;
  readonly onCheckedChange?: (checked: boolean) => void;
}) {
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
        background: enabled ? 'var(--po-control)' : 'transparent',
        boxSizing: 'border-box',
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
          color: T.text2,
        }}
      >
        <ProviderIcon provider={provider} size={16} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: T.text2, fontFamily: T.fontSans }}>
          {PROVIDER_LABELS[provider] ?? provider}
        </div>
        <div style={{ marginTop: 2, fontSize: 11, lineHeight: 1.35, color: T.text3, fontFamily: T.fontSans }}>
          {description}
        </div>
      </div>
      <ToggleSwitch
        checked={enabled}
        onCheckedChange={locked ? undefined : onCheckedChange}
        ariaLabel={`${PROVIDER_LABELS[provider] ?? provider} ${enabled ? 'on' : 'off'}`}
        title={locked ? 'Already enabled' : undefined}
        size="xs"
      />
    </div>
  );
}

function FieldLabel({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <label style={{ display: 'block', minWidth: 0 }}>
      <div style={{ marginBottom: 6, fontSize: 11, fontWeight: 600, color: T.text3, fontFamily: T.fontSans }}>
        {label}
      </div>
      {children}
    </label>
  );
}

function SectionHeading({ children }: { readonly children: ReactNode }) {
  return (
    <div style={{ marginBottom: 7, fontSize: 11, fontWeight: 600, color: T.text3, fontFamily: T.fontSans }}>
      {children}
    </div>
  );
}

function PathPickerMessage({ children }: { readonly children: ReactNode }) {
  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: T.text4,
        fontSize: 12,
        fontFamily: T.fontSans,
      }}
    >
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
  return path === '' ? 'Project files' : `/${path}`;
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

const breadcrumbButtonStyle: CSSProperties = {
  border: 'none',
  background: 'transparent',
  color: T.text2,
  padding: '2px 3px',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: 12,
  fontFamily: T.fontSans,
};

const secondaryButtonStyle: CSSProperties = {
  height: 32,
  padding: '0 12px',
  borderRadius: 6,
  border: `1px solid ${T.border}`,
  background: 'transparent',
  color: T.text2,
  fontSize: 12,
  fontWeight: 500,
  fontFamily: T.fontSans,
  cursor: 'pointer',
};

const primaryButtonStyle: CSSProperties = {
  height: 32,
  padding: '0 13px',
  borderRadius: 6,
  border: '1px solid var(--po-accent)',
  background: 'var(--po-accent)',
  color: 'var(--po-text-inverse)',
  fontSize: 12,
  fontWeight: 600,
  fontFamily: T.fontSans,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
};
