import {
  ArrowRight,
  Check,
  ExternalLink,
  LoaderCircle,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { bidiIsolate, type MessageFormatter } from "@puppyone/localization/core";
import { useLocalization } from "@puppyone/localization/react";
import {
  RENDERER_ASSET_PATHS,
  resolveRendererPublicAssetUrl,
} from "@puppyone/shared-ui";
import type {
  DesktopCloudAutomationOauthStatus,
  DesktopCloudAutomationProviderSpec,
  DesktopCloudCreateSynchronizeBindingResult,
  DesktopCloudSession,
} from "../../lib/cloudApi";
import {
  createSynchronizeBinding,
  getCloudAutomationOauthAuthorizeUrl,
  getCloudAutomationOauthStatus,
  openCloudAutomationAuthorizationUrl,
  supportsCloudAutomationOauth,
} from "../../lib/cloudApi";
import {
  DesktopDialogCloseButton,
  DesktopDialogRoot,
  DesktopDialogSurface,
} from "../../components/DesktopDialog";
import { DesktopOverlayLayer } from "../app-shell/DesktopOverlayPortal";
import {
  getCloudProviderIconUrl,
  providerIcon,
} from "../cloud/utils";
import {
  CloudAutomationDestinationEditor,
  CloudAutomationSourceEditor,
  CloudAutomationTriggerEditor,
} from "./AutomationControls";
import { AutomationTemplateCard } from "./AutomationTemplateCard";
import {
  buildDesktopCreateAutomationRequest,
  defaultAutomationConfigValues,
  defaultAutomationTargetPath,
  getAutomationTargetPathValidationError,
  getAutomationTriggerValidationError,
  getCloudAutomationUserConfigFields,
  getDefaultAutomationTriggerDraft,
  normalizeAutomationTargetPath,
  type AutomationSourceSelection,
} from "./automationRequest";
import { buildAutomationTemplates, type AutomationTemplate } from "./automationTemplates";
import {
  formatAutomationTemplateDescription,
  formatAutomationTemplateTitle,
  formatAutomationValidationError,
} from "./automationPresentation";

type WizardStep = "choose" | "resolving" | "connect" | "configure";
type OauthLookup = {
  state: "loading" | "connected" | "disconnected" | "error";
  status?: DesktopCloudAutomationOauthStatus;
  error?: string;
};
type AutomationCreateFailure = Readonly<{
  code: "queue-unavailable" | "authorization" | "generic";
  detail: string;
  providerLabel: string;
}>;
type OauthConnectFailure = Readonly<{
  code: "provider-unavailable" | "retryable";
  detail: string;
}>;

export type CloudAutomationCreationEcho = {
  synchronizeBindingId: string;
  synchronizeRunId: string | null;
  provider: string;
  targetPath: string;
  status: string;
  summary: string | null;
  error: string | null;
};

type CloudNewAutomationDialogProps = {
  projectId: string;
  cloudSession: DesktopCloudSession;
  apiBaseUrl: string | null;
  providers: DesktopCloudAutomationProviderSpec[];
  providersLoading: boolean;
  providersError: string | null;
  template: AutomationTemplate | null;
  onCloudSessionChange: (session: DesktopCloudSession | null) => void;
  onRefresh: () => Promise<void>;
  onCreated: (echo: CloudAutomationCreationEcho) => void;
  onClose: () => void;
};

export function CloudNewAutomationDialog(props: CloudNewAutomationDialogProps) {
  const { t } = useLocalization();
  const wizard = useAutomationCreateWizard(props);
  const { step, provider, activeTemplate, saving } = wizard;
  const { onClose } = props;
  const title = getWizardTitle(step, provider, activeTemplate, t);
  return (
    <DesktopOverlayLayer>
      <DesktopDialogRoot onClose={saving ? undefined : onClose}>
        <DesktopDialogSurface width={920} className="desktop-cloud-automation-dialog" ariaLabel={title}>
          <header className="desktop-dialog-header desktop-cloud-automation-dialog-header">
            <div className="desktop-dialog-title-row">
              <div>
                <h2>{title}</h2>
                <p>{getWizardDescription(step, provider, activeTemplate, t)}</p>
              </div>
            </div>
            <DesktopDialogCloseButton disabled={saving} onClick={onClose} />
          </header>
          <div
            className="desktop-dialog-body desktop-cloud-automation-dialog-body"
            data-po-scrollbar="content"
          >
            <AutomationWizardBody props={props} wizard={wizard} />
          </div>
        </DesktopDialogSurface>
      </DesktopDialogRoot>
    </DesktopOverlayLayer>
  );
}

function useAutomationCreateWizard({
  projectId,
  cloudSession,
  apiBaseUrl,
  providers,
  template,
  onCloudSessionChange,
  onRefresh,
  onCreated,
  onClose,
}: CloudNewAutomationDialogProps) {
  const datasourceProviders = useMemo(
    () => providers.filter((provider) => provider.category === "datasource"),
    [providers],
  );
  const templates = useMemo(() => buildAutomationTemplates(datasourceProviders), [datasourceProviders]);
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(template?.provider ?? null);
  const [step, setStep] = useState<WizardStep>(template ? "resolving" : "choose");
  const [oauthLookups, setOauthLookups] = useState<Record<string, OauthLookup>>({});
  const [oauthReloadVersion, setOauthReloadVersion] = useState(0);
  const [connectAttempt, setConnectAttempt] = useState(0);
  const [connectPhase, setConnectPhase] = useState<"starting" | "waiting" | "error">("starting");
  const [connectError, setConnectError] = useState<OauthConnectFailure | null>(null);
  const [targetPath, setTargetPath] = useState("");
  const [configValues, setConfigValues] = useState<Record<string, string>>({});
  const [source, setSource] = useState<AutomationSourceSelection | null>(null);
  const [trigger, setTrigger] = useState(() => getDefaultAutomationTriggerDraft(null));
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<AutomationCreateFailure | null>(null);

  const provider = datasourceProviders.find((item) => item.provider === selectedProviderId) ?? null;
  const activeTemplate = template?.provider === provider?.provider ? template : null;

  useEffect(() => {
    let cancelled = false;
    const oauthProviders = datasourceProviders.filter(
      (item) => item.auth !== "none" && supportsCloudAutomationOauth(item.provider),
    );
    setOauthLookups((current) => {
      const next = { ...current };
      for (const item of oauthProviders) next[item.provider] = { state: "loading" };
      return next;
    });
    for (const item of oauthProviders) {
      void getCloudAutomationOauthStatus(cloudSession, item.provider, onCloudSessionChange, apiBaseUrl)
        .then((status) => {
          if (cancelled) return;
          setOauthLookups((current) => ({
            ...current,
            [item.provider]: { state: status.connected ? "connected" : "disconnected", status },
          }));
        })
        .catch((error) => {
          if (cancelled) return;
          setOauthLookups((current) => ({
            ...current,
            [item.provider]: {
              state: "error",
              error: error instanceof Error ? error.message : String(error),
            },
          }));
        });
    }
    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl, cloudSession, datasourceProviders, oauthReloadVersion, onCloudSessionChange]);

  useEffect(() => {
    if (!provider) return;
    setConfigValues(defaultAutomationConfigValues(provider));
    setTargetPath(defaultAutomationTargetPath(provider));
    setSource(null);
    setTrigger(getDefaultAutomationTriggerDraft(provider));
    setFeedback(null);
  }, [provider]);

  useEffect(() => {
    if (step !== "resolving" || !provider) return;
    if (!providerNeedsOauth(provider) || !supportsCloudAutomationOauth(provider.provider)) {
      setStep("configure");
      return;
    }
    const lookup = oauthLookups[provider.provider];
    if (lookup?.state === "connected") setStep("configure");
    else if (lookup?.state === "disconnected") setStep("connect");
  }, [oauthLookups, provider, step]);

  useEffect(() => {
    if (step !== "connect" || !provider) return undefined;
    let cancelled = false;
    let pollTimer: number | null = null;
    const startTimer = window.setTimeout(() => {
      setConnectPhase("starting");
      setConnectError(null);
      void getCloudAutomationOauthAuthorizeUrl(
        cloudSession,
        provider.provider,
        onCloudSessionChange,
        apiBaseUrl,
      )
        .then((authorizationUrl) => openCloudAutomationAuthorizationUrl(authorizationUrl))
        .then(() => {
          if (cancelled) return;
          setConnectPhase("waiting");
          const poll = async () => {
            try {
              const status = await getCloudAutomationOauthStatus(
                cloudSession,
                provider.provider,
                onCloudSessionChange,
                apiBaseUrl,
              );
              if (cancelled) return;
              setOauthLookups((current) => ({
                ...current,
                [provider.provider]: { state: status.connected ? "connected" : "disconnected", status },
              }));
              if (status.connected) {
                setStep("configure");
                return;
              }
              pollTimer = window.setTimeout(poll, 3_000);
            } catch (error) {
              if (cancelled) return;
              setConnectPhase("error");
              setConnectError(toOauthConnectFailure(error));
            }
          };
          pollTimer = window.setTimeout(poll, 1_000);
        })
        .catch((error) => {
          if (cancelled) return;
          setConnectPhase("error");
          setConnectError(toOauthConnectFailure(error));
        });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(startTimer);
      if (pollTimer !== null) window.clearTimeout(pollTimer);
    };
  }, [apiBaseUrl, cloudSession, connectAttempt, onCloudSessionChange, provider, step]);

  const validation = deriveAutomationValidation({ provider, configValues, source, targetPath, trigger, saving });
  const { canCreate, normalizedTargetPath } = validation;

  const continueWithProvider = () => {
    if (!provider) return;
    if (!providerNeedsOauth(provider) || !supportsCloudAutomationOauth(provider.provider)) {
      setStep("configure");
      return;
    }
    const lookup = oauthLookups[provider.provider];
    if (lookup?.state === "connected") setStep("configure");
    else if (lookup?.state === "disconnected") setStep("connect");
    else setStep("resolving");
  };

  const handleCreate = async () => {
    if (!provider || !canCreate) return;
    setSaving(true);
    setFeedback(null);
    try {
      const result = await createSynchronizeBinding(
        cloudSession,
        buildDesktopCreateAutomationRequest({
          projectId,
          provider,
          configValues,
          source,
          targetPath: normalizedTargetPath,
          trigger,
        }),
        onCloudSessionChange,
        apiBaseUrl,
      );
      onCreated(createAutomationEcho(result, provider.provider, normalizedTargetPath));
      onClose();
      void Promise.resolve().then(onRefresh).catch(() => undefined);
    } catch (error) {
      setFeedback(toAutomationCreateFailure(error, provider.display_name));
      setSaving(false);
    }
  };

  return {
    datasourceProviders, templates, selectedProviderId, setSelectedProviderId, step, setStep,
    oauthLookups, setOauthReloadVersion, connectPhase, setConnectPhase, connectError, setConnectError, setConnectAttempt,
    provider, activeTemplate, targetPath, setTargetPath, configValues, setConfigValues, source, setSource, trigger, setTrigger,
    saving, feedback, validation, continueWithProvider, handleCreate,
  };
}

type AutomationWizard = ReturnType<typeof useAutomationCreateWizard>;
type WizardContentProps = { props: CloudNewAutomationDialogProps; wizard: AutomationWizard };

function AutomationWizardBody({ props, wizard }: WizardContentProps) {
  const { t } = useLocalization();
  const { providersLoading, providersError } = props;
  const { datasourceProviders, step, provider, oauthLookups, setStep, setOauthReloadVersion,
    connectPhase, connectError, setConnectPhase, setConnectError, setConnectAttempt } = wizard;
  if (providersLoading) return <div className="desktop-cloud-automation-state">{t("automation.create.loadingSources")}</div>;
  if (providersError) return <div className="desktop-dialog-error" dir="auto">
    {t("automation.create.sourcesError", { detail: bidiIsolate(providersError) })}
  </div>;
  if (datasourceProviders.length === 0) return <div className="desktop-cloud-automation-state">{t("automation.create.noSources")}</div>;
  if (step === "choose") return <AutomationChooseStep props={props} wizard={wizard} />;
  if (!provider) return <div className="desktop-cloud-automation-state">
    <span>{t("automation.create.sourceUnavailable")}</span>
    <button className="desktop-dialog-button" type="button" onClick={() => setStep("choose")}>
      {t("automation.create.chooseAnotherSource")}
    </button>
  </div>;
  if (step === "resolving") return <ConnectionResolvingState
    provider={provider} lookup={oauthLookups[provider.provider]}
    onBack={() => setStep("choose")} onRetry={() => setOauthReloadVersion(current => current + 1)}
  />;
  if (step === "connect") return <ConnectionWaitingState
    provider={provider} phase={connectPhase} error={connectError}
    onCancel={() => { setStep("choose"); setOauthReloadVersion(current => current + 1); }}
    onRetry={() => { setConnectPhase("starting"); setConnectError(null); setConnectAttempt(current => current + 1); }}
  />;
  return <AutomationConfigureStep props={props} wizard={wizard} provider={provider} />;
}

function AutomationChooseStep({ props, wizard }: WizardContentProps) {
  const { t } = useLocalization();
  const { onClose } = props;
  const { templates, datasourceProviders, oauthLookups, selectedProviderId, setSelectedProviderId, provider, continueWithProvider } = wizard;
  return (
    <>
      <div className="desktop-cloud-automation-chooser-grid">
        {templates.map((item) => {
          const itemProvider = datasourceProviders.find((candidate) => candidate.provider === item.provider);
          const status = getProviderConnectionBadge(itemProvider, oauthLookups[item.provider], t);
          return (
            <AutomationTemplateCard
              key={item.id}
              template={item}
              selected={selectedProviderId === item.provider}
              actionLabel={t("automation.action.choose")}
              status={status.label}
              statusTone={status.tone}
              onAdd={() => setSelectedProviderId(item.provider)}
            />
          );
        })}
      </div>
      <div className="desktop-cloud-automation-dialog-footer-row">
        <span className="muted">{t("automation.create.chooseSourceHint")}</span>
        <div className="desktop-cloud-automation-actions">
          <button className="desktop-dialog-button" type="button" onClick={onClose}>{t("common.action.cancel")}</button>
          <button className="desktop-dialog-button primary" type="button" disabled={!provider} onClick={continueWithProvider}>
            {t("automation.action.continue")}
            <ArrowRight className="po-directional-icon" size={14} />
          </button>
        </div>
      </div>
    </>
  );
}

function AutomationConfigureStep({ props, wizard, provider }: WizardContentProps & { provider: DesktopCloudAutomationProviderSpec }) {
  const { t } = useLocalization();
  const { projectId, cloudSession, apiBaseUrl, onCloudSessionChange } = props;
  const { configValues, source, setConfigValues, setSource, trigger, setTrigger, targetPath, setTargetPath, saving, setStep, handleCreate } = wizard;
  const { normalizedTargetPath, canCreate } = wizard.validation;
  const feedbackMessage = formatAutomationCreateFailure(wizard.feedback, t);
  return (
    <>
      <div className="desktop-cloud-automation-builder">
        <section className="desktop-cloud-automation-node">
          <div className="desktop-cloud-automation-node-header">
            <span className="desktop-cloud-automation-node-icon">
              <CloudAutomationProviderMark provider={provider.provider} iconUrl={provider.icon_url} />
            </span>
            <span dir="auto">{provider.display_name}</span>
          </div>
          <div className="desktop-cloud-automation-node-body">
            <CloudAutomationSourceEditor
              provider={provider}
              cloudSession={cloudSession}
              apiBaseUrl={apiBaseUrl}
              configValues={configValues}
              source={source}
              onCloudSessionChange={onCloudSessionChange}
              onConfigValueChange={(key, value) => setConfigValues((current) => ({ ...current, [key]: value }))}
              onSourceChange={setSource}
            />
          </div>
        </section>
        <div className="desktop-cloud-automation-trigger-bridge">
          <CloudAutomationTriggerEditor provider={provider} draft={trigger} onChange={setTrigger} />
          <ArrowRight className="po-directional-icon" size={16} aria-hidden="true" />
        </div>
        <section className="desktop-cloud-automation-node">
          <div className="desktop-cloud-automation-node-header">
            <span className="desktop-cloud-automation-node-icon"><img src={resolveRendererPublicAssetUrl(RENDERER_ASSET_PATHS.icons.ui.folder)} alt="" /></span>
            <span dir="auto">/{normalizedTargetPath}</span>
          </div>
          <div className="desktop-cloud-automation-node-body">
            <CloudAutomationDestinationEditor
              projectId={projectId}
              cloudSession={cloudSession}
              apiBaseUrl={apiBaseUrl}
              targetPath={targetPath}
              onCloudSessionChange={onCloudSessionChange}
              onChange={setTargetPath}
            />
          </div>
        </section>
      </div>
      {feedbackMessage && (
        <div className="desktop-dialog-error desktop-cloud-automation-action-error" role="alert" dir="auto">
          {feedbackMessage}
        </div>
      )}
      <div className="desktop-cloud-automation-dialog-footer-row">
        <span className={canCreate ? "ready" : "muted"}>
          {getAutomationValidationMessage(wizard.validation, t)}
        </span>
        <div className="desktop-cloud-automation-actions">
          <button className="desktop-dialog-button" type="button" disabled={saving} onClick={() => setStep("choose")}>
            {t("automation.action.back")}
          </button>
          <button className="desktop-dialog-button primary" type="button" disabled={!canCreate} onClick={handleCreate}>
            <Check size={14} />
            {saving ? t("automation.create.creating") : t("automation.create.submit")}
          </button>
        </div>
      </div>
    </>
  );
}

function deriveAutomationValidation({ provider, configValues, source, targetPath, trigger, saving }: {
  provider: DesktopCloudAutomationProviderSpec | null;
  configValues: Record<string, string>;
  source: AutomationSourceSelection | null;
  targetPath: string;
  trigger: Parameters<typeof getAutomationTriggerValidationError>[0];
  saving: boolean;
}) {
  const fields = getCloudAutomationUserConfigFields(provider);
  const missingRequired = fields.some((field) => field.required && !configValues[field.key]?.trim());
  const sourceMissing = Boolean(provider && provider.provider !== "url" && providerNeedsOauth(provider) && !source?.resourceId.trim());
  const normalizedTargetPath = normalizeAutomationTargetPath(targetPath);
  const targetPathError = getAutomationTargetPathValidationError(targetPath);
  const triggerError = getAutomationTriggerValidationError(trigger);
  const canCreate = Boolean(provider && !missingRequired && !sourceMissing && !targetPathError && !triggerError && !saving);
  return { missingRequired, sourceMissing, normalizedTargetPath, targetPathError, triggerError, canCreate };
}

function getAutomationValidationMessage(validation: ReturnType<typeof deriveAutomationValidation>, t: MessageFormatter) {
  if (validation.missingRequired) return t("automation.create.missingRequired");
  if (validation.sourceMissing) return t("automation.create.sourceMissing");
  if (validation.targetPathError) return formatAutomationValidationError(validation.targetPathError, t);
  if (validation.triggerError) return formatAutomationValidationError(validation.triggerError, t);
  return t("automation.create.ready");
}

function getWizardTitle(step: WizardStep, provider: DesktopCloudAutomationProviderSpec | null, template: AutomationTemplate | null, t: MessageFormatter) {
  if (step === "choose") return t("automation.create.chooseTitle");
  const providerLabel = bidiIsolate(provider?.display_name ?? t("automation.source.generic"));
  if (step === "connect") return t("automation.create.connectTitle", { provider: providerLabel });
  if (template) return formatAutomationTemplateTitle(template, t);
  return t("automation.create.configureTitle", { provider: providerLabel });
}

function getConnectionHeading(phase: "starting" | "waiting" | "error", providerUnavailable: boolean, provider: string, t: MessageFormatter) {
  if (phase === "starting") return t("automation.connection.openingAuthorization");
  if (phase === "waiting") return t("automation.connection.waiting");
  if (providerUnavailable) return t("automation.connection.providerUnavailable", { provider: bidiIsolate(provider) });
  return t("automation.connection.authorizationAttention");
}

function getConnectionDescription(phase: "starting" | "waiting" | "error", providerUnavailable: boolean, provider: string, error: OauthConnectFailure | null, t: MessageFormatter) {
  if (phase !== "error") return t("automation.connection.finishInBrowser", { provider: bidiIsolate(provider) });
  if (providerUnavailable) return t("automation.connection.providerUnavailableDetail", { provider: bidiIsolate(provider) });
  return t("automation.error.detail", { detail: bidiIsolate(error?.detail) });
}

function ConnectionResolvingState({
  provider,
  lookup,
  onBack,
  onRetry,
}: {
  provider: DesktopCloudAutomationProviderSpec | null;
  lookup?: OauthLookup;
  onBack: () => void;
  onRetry: () => void;
}) {
  const { t } = useLocalization();
  const providerLabel = provider?.display_name ?? t("automation.source.generic");
  return (
    <div className="desktop-cloud-automation-connect-state">
      {lookup?.state === "error" ? <ShieldCheck size={28} /> : <LoaderCircle className="desktop-dialog-spinner" size={28} />}
      <h3>{lookup?.state === "error"
        ? t("automation.connection.statusUnavailable")
        : t("automation.connection.checkingProvider", { provider: bidiIsolate(providerLabel) })}</h3>
      <p dir="auto">{lookup?.error
        ? t("automation.error.detail", { detail: bidiIsolate(lookup.error) })
        : t("automation.connection.readingAccount")}</p>
      <div className="desktop-cloud-automation-actions">
        <button className="desktop-dialog-button" type="button" onClick={onBack}>{t("automation.action.back")}</button>
        {lookup?.state === "error" && (
          <button className="desktop-dialog-button primary" type="button" onClick={onRetry}>{t("common.action.retry")}</button>
        )}
      </div>
    </div>
  );
}

function ConnectionWaitingState({
  provider,
  phase,
  error,
  onCancel,
  onRetry,
}: {
  provider: DesktopCloudAutomationProviderSpec;
  phase: "starting" | "waiting" | "error";
  error: OauthConnectFailure | null;
  onCancel: () => void;
  onRetry: () => void;
}) {
  const { t } = useLocalization();
  const providerUnavailable = phase === "error" && error?.code === "provider-unavailable";
  return (
    <div className="desktop-cloud-automation-connect-state">
      {phase === "error" ? <ExternalLink size={28} /> : <LoaderCircle className="desktop-dialog-spinner" size={28} />}
      <h3>{getConnectionHeading(phase, providerUnavailable, provider.display_name, t)}</h3>
      <p dir="auto">{getConnectionDescription(phase, providerUnavailable, provider.display_name, error, t)}</p>
      <div className="desktop-cloud-automation-actions">
        <button className={`desktop-dialog-button${providerUnavailable ? " primary" : ""}`} type="button" onClick={onCancel}>
          {providerUnavailable ? t("automation.create.chooseAnotherSource") : t("common.action.cancel")}
        </button>
        {phase === "error" && !providerUnavailable && (
          <button className="desktop-dialog-button primary" type="button" onClick={onRetry}>{t("automation.action.tryAgain")}</button>
        )}
      </div>
    </div>
  );
}

function CloudAutomationProviderMark({
  provider,
  iconUrl,
}: {
  provider: string;
  iconUrl?: string | null;
}) {
  const Icon = providerIcon(provider);
  const resolvedIconUrl = iconUrl || getCloudProviderIconUrl(provider);
  return resolvedIconUrl ? <img src={resolvedIconUrl} alt="" /> : <Icon size={18} />;
}

function providerNeedsOauth(provider: DesktopCloudAutomationProviderSpec) {
  return provider.auth !== "none";
}

function getProviderConnectionBadge(
  provider: DesktopCloudAutomationProviderSpec | undefined,
  lookup: OauthLookup | undefined,
  t: MessageFormatter,
): { label: string; tone: "neutral" | "ready" | "required" | "error" } {
  if (!provider || !providerNeedsOauth(provider)) {
    return { label: t("automation.connection.ready"), tone: "ready" };
  }
  if (!supportsCloudAutomationOauth(provider.provider)) {
    return { label: t("automation.connection.configurationRequired"), tone: "required" };
  }
  if (!lookup || lookup.state === "loading") return { label: t("automation.connection.checking"), tone: "neutral" };
  if (lookup.state === "connected") {
    return { label: lookup.status?.workspace_name || t("automation.connection.connected"), tone: "ready" };
  }
  if (lookup.state === "error") return { label: t("automation.connection.statusUnavailableShort"), tone: "error" };
  return { label: t("automation.connection.required"), tone: "required" };
}

function getWizardDescription(
  step: WizardStep,
  provider: DesktopCloudAutomationProviderSpec | null,
  template: AutomationTemplate | null,
  t: MessageFormatter,
) {
  if (step === "choose") return t("automation.create.description.choose");
  if (step === "connect") return t("automation.create.description.connect");
  if (step === "resolving") return t("automation.create.description.resolving");
  if (template) return formatAutomationTemplateDescription(template, t);
  return t("automation.create.description.configure", {
    provider: bidiIsolate(provider?.display_name ?? t("automation.source.generic")),
  });
}

function createAutomationEcho(
  result: DesktopCloudCreateSynchronizeBindingResult,
  provider: string,
  targetPath: string,
): CloudAutomationCreationEcho {
  const execution: Record<string, unknown> = isRecord(result.execution_result) ? result.execution_result : {};
  const status = readString(execution.status) || result.binding.status || "queued";
  const error = readString(execution.error) || result.binding.error_message || null;
  return {
    synchronizeBindingId: result.binding.id,
    synchronizeRunId: readString(execution.synchronize_run_id) || null,
    provider,
    targetPath,
    status,
    summary: readString(execution.summary) || null,
    error,
  };
}

function toAutomationCreateFailure(error: unknown, providerLabel: string): AutomationCreateFailure {
  const message = error instanceof Error ? error.message : String(error);
  const status = error && typeof error === "object" && "status" in error
    ? Number((error as { status?: unknown }).status)
    : 0;
  if (status === 503 || /503|worker.*unavailable|enqueue|queue/i.test(message)) {
    return { code: "queue-unavailable", detail: message, providerLabel };
  }
  if (/oauth|authoriz|credential|token|connect.*account/i.test(message)) {
    return { code: "authorization", detail: message, providerLabel };
  }
  return { code: "generic", detail: message, providerLabel };
}

function toOauthConnectFailure(error: unknown): OauthConnectFailure {
  const detail = error instanceof Error ? error.message : String(error);
  const code = error && typeof error === "object" && "code" in error
    ? String((error as { code?: unknown }).code || "").trim().toLowerCase()
    : "";
  const providerUnavailable = [
    "oauth_not_configured",
    "provider_not_configured",
    "integration_not_configured",
  ].includes(code) || /oauth.{0,80}(?:not configured|not available)|(?:not configured|not available).{0,80}oauth|required environment variables|missing.{0,60}(?:oauth|client (?:id|secret)|credentials?)/i.test(detail);
  return {
    code: providerUnavailable ? "provider-unavailable" : "retryable",
    detail,
  };
}

function formatAutomationCreateFailure(
  failure: AutomationCreateFailure | null,
  t: MessageFormatter,
): string | null {
  if (!failure) return null;
  return t(`automation.create.error.${failure.code}`, {
    detail: bidiIsolate(failure.detail),
    provider: bidiIsolate(failure.providerLabel),
  });
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
