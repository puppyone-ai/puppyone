import { Tooltip } from "@puppyone/shared-ui";
import { Plus } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { useLocalization } from "@puppyone/localization/react";
import { DesktopDialogCloseButton, DesktopDialogRoot, DesktopDialogSurface } from "../../../../components/DesktopDialog";
import { DesktopOverlayLayer } from "../../../app-shell/DesktopOverlayPortal";
import type {
  DesktopCloudConnector,
  DesktopCloudMcpEndpoint,
  DesktopCloudRepositoryView,
  DesktopCloudSession,
} from "../../../../lib/cloudApi";
import { scopeMatchesMcpEndpoint } from "../../utils";
import { repositoryTargetKey } from "../../repositoryTarget";
import { cloudMessage, formatCloudMessage, type CloudMessageDescriptor } from "../../cloudPresentation";
import { CreateAccessFolderTree, TreeDisclosureMarker } from "./CreateAccessFolderTree";
import { CreateAccessIntentPicker } from "./CreateAccessIntentPicker";
import { CreateAccessMethodRow } from "./CreateAccessMethodRow";
import { createDesktopCloudAccess } from "./createAccessFlow";
import {
  defaultScopeName,
  formatAccessPath,
  normalizeAccessPath,
  normalizeAccessProviderKey,
  OPTIONAL_ACCESS_METHODS,
  type CreateAccessIntent,
  type OptionalAccessProvider,
} from "./createAccessModel";

export type DesktopCloudCreateAccessCreated = {
  scope: DesktopCloudRepositoryView;
  preferredRowId: string;
};

export function DesktopCloudCreateAccessDialog({
  projectId,
  cloudSession,
  apiBaseUrl,
  scopes,
  connectorsByTarget,
  mcpEndpointsByTarget,
  initialPath,
  onCloudSessionChange,
  onClose,
  onCreated,
}: {
  projectId: string;
  cloudSession: DesktopCloudSession;
  apiBaseUrl: string | null;
  scopes: DesktopCloudRepositoryView[];
  connectorsByTarget: Map<string, DesktopCloudConnector[]>;
  mcpEndpointsByTarget: Map<string, DesktopCloudMcpEndpoint[]>;
  initialPath?: string | null;
  onCloudSessionChange: (session: DesktopCloudSession | null) => void;
  onClose: () => void;
  onCreated: (created: DesktopCloudCreateAccessCreated) => Promise<void> | void;
}) {
  const { t } = useLocalization();
  const normalizedInitialPath = normalizeAccessPath(initialPath ?? "");
  const initialSelectedPath = normalizedInitialPath === "" ? null : normalizedInitialPath;
  const [selectedPath, setSelectedPath] = useState<string | null>(initialSelectedPath);
  const [name, setName] = useState(initialSelectedPath ? defaultScopeName(initialSelectedPath) : "");
  const [nameTouched, setNameTouched] = useState(Boolean(initialSelectedPath));
  const [optionalProviders, setOptionalProviders] = useState<ReadonlySet<OptionalAccessProvider>>(() => new Set());
  const [intent, setIntent] = useState<CreateAccessIntent>("remote_workspace");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<CloudMessageDescriptor | null>(null);

  const existingPathSet = useMemo(
    () => new Set(scopes.map((scope) => normalizeAccessPath(scope.path))),
    [scopes],
  );
  const normalizedSelected = selectedPath === null ? null : normalizeAccessPath(selectedPath);
  const selectedExistingScope = useMemo(() => (
    normalizedSelected === null
      ? null
      : scopes.find((scope) => normalizeAccessPath(scope.path) === normalizedSelected) ?? null
  ), [normalizedSelected, scopes]);
  const selectedMcpEndpoints = useMemo(
    () => (selectedExistingScope
      ? mcpEndpointsByTarget.get(repositoryTargetKey(selectedExistingScope.target)) ?? []
      : []),
    [mcpEndpointsByTarget, selectedExistingScope],
  );
  const existingProviders = useMemo(() => {
    if (!selectedExistingScope) return new Set<string>();
    const providers = new Set(
      (connectorsByTarget.get(repositoryTargetKey(selectedExistingScope.target)) ?? [])
        .map((connector) => normalizeAccessProviderKey(connector.provider)),
    );
    if (selectedMcpEndpoints.some((endpoint) => scopeMatchesMcpEndpoint(selectedExistingScope, endpoint))) {
      providers.add("mcp");
    }
    return providers;
  }, [connectorsByTarget, selectedExistingScope, selectedMcpEndpoints]);
  const optionalProvidersToCreate = useMemo(
    () => Array.from(optionalProviders).filter((provider) => {
      const method = OPTIONAL_ACCESS_METHODS.find((item) => item.provider === provider);
      return method?.supported === true && !existingProviders.has(provider);
    }),
    [existingProviders, optionalProviders],
  );
  const trimmedName = name.trim();
  const canCreate = !saving
    && normalizedSelected !== null
    && normalizedSelected !== ""
    && (selectedExistingScope !== null || trimmedName.length > 0);
  const actionLabel = saving
    ? t("cloud.common.saving")
    : selectedExistingScope
      ? optionalProvidersToCreate.length > 0
        ? t("cloud.access.create.update")
        : t("cloud.access.open")
      : t("cloud.access.create.action");
  const selectedLabel = normalizedSelected === null ? t("cloud.access.create.choosePath") : formatAccessPath(normalizedSelected, t);

  const selectPath = (path: string) => {
    const normalized = normalizeAccessPath(path);
    if (!normalized) return;
    setSelectedPath(normalized);
    setError(null);
    if (!nameTouched) setName(defaultScopeName(normalized));
  };

  const toggleOptionalProvider = (provider: OptionalAccessProvider, checked: boolean) => {
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
      const created = await createDesktopCloudAccess({
        projectId,
        cloudSession,
        apiBaseUrl,
        path: normalizedSelected,
        name: (trimmedName || defaultScopeName(normalizedSelected)).slice(0, 100),
        mode: "rw",
        existingScope: selectedExistingScope,
        optionalProvidersToCreate,
        intent,
        existingMcpEndpoints: selectedMcpEndpoints,
        onCloudSessionChange,
      });

      await onCreated(created);
      onClose();
    } catch (createError) {
      setError(cloudMessage("create-access-failed", undefined, createError instanceof Error ? createError.message : undefined));
    } finally {
      setSaving(false);
    }
  };

  return (
    <DesktopOverlayLayer>
      <DesktopDialogRoot
        className="desktop-cloud-create-access-backdrop"
        dismissOnBackdrop={!saving}
        onClose={saving ? undefined : onClose}
      >
        <DesktopDialogSurface className="desktop-cloud-create-access-dialog" width={760}>
        <header className="desktop-dialog-header desktop-cloud-create-access-header">
          <div className="desktop-dialog-title-row">
            <div>
              <h2>{t("cloud.access.create.title")}</h2>
              <p>{t("cloud.access.create.description")}</p>
            </div>
          </div>
          <DesktopDialogCloseButton disabled={saving} onClick={onClose} />
        </header>
        <div
          className="desktop-dialog-body desktop-cloud-create-access-body"
          data-po-scrollbar="content"
        >
          <CreateAccessIntentPicker value={intent} onChange={setIntent} />
          <div className="desktop-cloud-create-access-grid">
            <CreateAccessFolderTree
              projectId={projectId}
              cloudSession={cloudSession}
              apiBaseUrl={apiBaseUrl}
              selectedPath={normalizedSelected}
              existingPathSet={existingPathSet}
              initialExpandedPath={initialSelectedPath}
              onCloudSessionChange={onCloudSessionChange}
              onSelect={selectPath}
            />

            <div className="desktop-cloud-create-access-form">
              <FieldLabel label={t("cloud.access.create.name")} required>
                <input
                  className="desktop-cloud-create-access-input"
                  value={name}
                  disabled={saving}
                  placeholder={normalizedSelected === null ? t("cloud.access.create.choosePathFirst") : defaultScopeName(normalizedSelected)}
                  onChange={(event) => {
                    setNameTouched(true);
                    setName(event.target.value);
                  }}
                />
              </FieldLabel>

              <FieldLabel label={t("cloud.common.path")} required>
                <Tooltip content={selectedLabel} overflowOnly><div
                  className={`desktop-cloud-create-access-path-box ${selectedExistingScope ? "existing" : ""} ${normalizedSelected === null ? "empty" : ""}`}
                                                              >
                  <TreeDisclosureMarker expanded={normalizedSelected !== null} />
                  <span>{selectedLabel}</span>
                </div></Tooltip>
                {selectedExistingScope ? (
                  <div className="desktop-cloud-create-access-field-note">
                    {t("cloud.access.create.pathAlreadyHasAccess")}
                  </div>
                ) : null}
              </FieldLabel>

              <div>
                <SectionHeading>{t("cloud.access.create.alwaysIncluded")}</SectionHeading>
                <div className="desktop-cloud-create-access-method-stack">
                  <CreateAccessMethodRow provider="git_remote" description={t("cloud.access.create.method.gitDescription")} locked />
                  <CreateAccessMethodRow provider="cli" description={t("cloud.access.create.method.cliDescription")} locked />
                </div>
              </div>

              <div>
                <SectionHeading>{t("cloud.access.create.optionalMethods")}</SectionHeading>
                <div className="desktop-cloud-create-access-method-stack">
                  {OPTIONAL_ACCESS_METHODS.map((method) => (
                    <CreateAccessMethodRow
                      key={method.provider}
                      provider={method.provider}
                      description={t(method.descriptionId)}
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

          {error ? <div className="desktop-cloud-create-access-error">{formatCloudMessage(error, t)}</div> : null}
        </div>
        <footer className="desktop-dialog-footer desktop-cloud-create-access-footer">
          <button className="desktop-dialog-button" type="button" disabled={saving} onClick={onClose}>
            {t("cloud.common.cancel")}
          </button>
          <button className="desktop-dialog-button primary" type="button" disabled={!canCreate} onClick={handleCreate}>
            <Plus size={14} />
            <span>{actionLabel}</span>
          </button>
        </footer>
        </DesktopDialogSurface>
      </DesktopDialogRoot>
    </DesktopOverlayLayer>
  );
}

function FieldLabel({
  label,
  required = false,
  children,
}: {
  label: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="desktop-cloud-create-access-field">
      <span className="desktop-cloud-create-access-label">
        {label}
        {required ? <i aria-hidden="true" /> : null}
      </span>
      {children}
    </label>
  );
}

function SectionHeading({ children }: { children: ReactNode }) {
  return <div className="desktop-cloud-create-access-label">{children}</div>;
}
