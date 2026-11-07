import { Tooltip } from "@puppyone/shared-ui";
import { bidiIsolate, useLocalization } from "@puppyone/localization";
import { useState } from "react";
import type { HostCatalogFolder } from "../../../../shared/host-contract/types";
import { DesktopDialogCloseButton, DesktopDialogRoot } from "../../../components/DesktopDialog";
import { DesktopOverlayLayer } from "../../../components/DesktopOverlayPortal";
import type { HostCatalog } from "../data/useHostCatalog";
import { forgetSharedFolder, rememberSharedFolder } from "../model/sharedFolders";
import "./host-sharing.css";

export type HostFolderSharingTarget =
  | Readonly<{ kind: "share"; rootPath: string; name: string }>
  | Readonly<{ kind: "settings"; folderId: string; name: string; rootPath?: string }>;

const RUN_KINDS = [
  { kind: "terminal", capability: "folder.shell" },
  { kind: "git", capability: "folder.git" },
  { kind: "agent", capability: "folder.agent" },
] as const;

type RunKind = typeof RUN_KINDS[number]["kind"];

/**
 * What the owner's other computers may do with one folder on this computer.
 * Every choice applies at once; Main asks the person in the system's own words
 * before anything is widened, so this surface never asks a second time.
 */
export function HostFolderSharingDialog({ target, catalog, onClose }: {
  target: HostFolderSharingTarget;
  catalog: HostCatalog;
  onClose: () => void;
}) {
  const { t } = useLocalization();
  const [pending, setPending] = useState(false);
  const [writableChoice, setWritableChoice] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleId = "host-sharing-dialog-title";
  const name = bidiIsolate(target.name);
  const device = catalog.devices.find((item) => item.id === catalog.thisComputerId);
  const folder = target.kind === "settings"
    ? device?.folders.find((item) => item.id === target.folderId && item.state === "active") : undefined;
  const writable = folder ? folder.capabilities.includes("folder.write") : writableChoice;

  /** One change at a time; the reason stays in the dialog when it is refused. */
  const change = async <T,>(work: () => Promise<T>, failure: string): Promise<{ value: T } | null> => {
    if (pending) return null;
    setPending(true);
    setError(null);
    try {
      const value = await work();
      await catalog.refresh();
      return { value };
    } catch (cause) {
      setError(cause instanceof Error && cause.message ? cause.message : t(failure));
      return null;
    } finally {
      setPending(false);
    }
  };

  const share = async () => {
    if (target.kind !== "share") return;
    const result = await change(async () => window.puppyoneDesktop?.registerHostFolder({
      rootPath: target.rootPath, writable: writableChoice, expectedSession: catalog.expectedSession }), "hosts.register.failure");
    const registered = result?.value;
    if (registered && "folderId" in registered) {
      rememberSharedFolder(target.rootPath, registered.folderId);
      onClose();
    }
  };

  const setAccess = (next: boolean) => {
    if (target.kind === "share") { setWritableChoice(next); return; }
    if (!folder || !device || next === writable) return;
    void change(async () => window.puppyoneDesktop?.updateHostFolder({ deviceId: device.id, folderId: folder.id,
      name: folder.name, writable: next, expectedRevision: folder.revision, expectedSession: catalog.expectedSession }),
    "hosts.catalog.updateFailure");
  };

  const setRun = (kind: RunKind, allowed: boolean) => {
    if (!folder || !device) return;
    const current = Object.fromEntries(RUN_KINDS.map((item) =>
      [item.kind, folder.capabilities.includes(item.capability)])) as Record<RunKind, boolean>;
    void change(async () => window.puppyoneDesktop?.setHostExecution({ deviceId: device.id, folderId: folder.id,
      ...current, [kind]: allowed, expectedRevision: folder.revision, expectedSession: catalog.expectedSession }),
    "hosts.catalog.updateFailure");
  };

  const stop = async () => {
    if (!folder || !device) return;
    const result = await change(async () => window.puppyoneDesktop?.removeHostFolder({ deviceId: device.id,
      folderId: folder.id, expectedSession: catalog.expectedSession }), "hosts.catalog.removeFailure");
    if (result?.value && !("cancelled" in result.value)) {
      forgetSharedFolder(folder.id, target.rootPath);
      onClose();
    }
  };

  const settingsUnavailable = target.kind === "settings" && !folder;
  return (
    <DesktopOverlayLayer>
      <DesktopDialogRoot dismissOnBackdrop={!pending} onClose={pending ? undefined : onClose}>
        <div className="desktop-dialog-surface host-sharing-dialog" role="dialog" aria-modal="true"
          aria-labelledby={titleId} tabIndex={-1}>
          <header className="desktop-dialog-header">
            <div className="desktop-dialog-title-row">
              <h2 id={titleId}>{t(target.kind === "share" ? "hosts.dialog.shareTitle" : "hosts.dialog.settingsTitle", { name })}</h2>
            </div>
            <Tooltip content={t("common.action.close")}>
              <DesktopDialogCloseButton label={t("common.action.close")} disabled={pending} onClick={onClose} />
            </Tooltip>
          </header>
          <div className="desktop-dialog-body host-sharing-body">
            <p>{t("hosts.dialog.intro", { name })}</p>
            {settingsUnavailable
              ? <p className="desktop-dialog-note" role="status">
                {t(catalog.loaded ? "hosts.folder.revoked" : "hosts.sharing.connecting")}</p>
              : <>
                <AccessChoice writable={writable} disabled={pending} onChange={setAccess} />
                {folder && writable && <RunChoice folder={folder} sandboxed={Boolean(catalog.sharing?.sandbox)}
                  disabled={pending} onChange={setRun} />}
              </>}
            {error && <p className="desktop-dialog-error" role="alert">{error}</p>}
          </div>
          <footer className={`desktop-dialog-footer ${folder ? "two-action" : ""}`}>
            {target.kind === "share" ? <>
              <button className="desktop-dialog-button" type="button" disabled={pending} onClick={onClose}>
                {t("common.action.cancel")}</button>
              <button className="desktop-dialog-button primary" type="button" disabled={pending}
                data-desktop-dialog-initial-focus="true" onClick={() => void share()}>
                {t("hosts.dialog.share")}</button>
            </> : <>
              {folder && <button className="desktop-dialog-button destructive" type="button" disabled={pending}
                onClick={() => void stop()}>{t("hosts.dialog.stop")}</button>}
              <button className="desktop-dialog-button primary" type="button" disabled={pending}
                data-desktop-dialog-initial-focus="true" onClick={onClose}>{t("hosts.dialog.done")}</button>
            </>}
          </footer>
        </div>
      </DesktopDialogRoot>
    </DesktopOverlayLayer>
  );
}

function AccessChoice({ writable, disabled, onChange }: {
  writable: boolean;
  disabled: boolean;
  onChange: (writable: boolean) => void;
}) {
  const { t } = useLocalization();
  const options = [
    { value: false, label: t("hosts.register.readOnly"), detail: t("hosts.dialog.viewDetail") },
    { value: true, label: t("hosts.register.editable"), detail: t("hosts.dialog.editDetail") },
  ];
  return (
    <fieldset className="host-sharing-section" disabled={disabled}>
      <legend className="host-sharing-heading">{t("hosts.dialog.access")}</legend>
      <div className="host-sharing-options" role="radiogroup" aria-label={t("hosts.dialog.access")}>
        {options.map((option) => (
          <label key={String(option.value)} className="host-sharing-option" data-selected={writable === option.value || undefined}>
            <input type="radio" name="host-sharing-access" checked={writable === option.value}
              onChange={() => onChange(option.value)} />
            <span className="host-sharing-option-text">
              <span className="host-sharing-option-label">{option.label}</span>
              <span className="host-sharing-option-detail">{option.detail}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function RunChoice({ folder, sandboxed, disabled, onChange }: {
  folder: HostCatalogFolder;
  sandboxed: boolean;
  disabled: boolean;
  onChange: (kind: RunKind, allowed: boolean) => void;
}) {
  const { t } = useLocalization();
  return (
    <section className="host-sharing-section" aria-labelledby="host-sharing-run-title">
      <h3 id="host-sharing-run-title" className="host-sharing-heading">{t("hosts.dialog.run")}</h3>
      <div className="host-sharing-switches">
        {RUN_KINDS.map(({ kind, capability }) => {
          const label = t(`hosts.execution.${kind}`);
          return (
            <div key={kind} className="host-sharing-switch-row">
              <span>{label}</span>
              <label className="desktop-settings-switch">
                <input type="checkbox" aria-label={label} checked={folder.capabilities.includes(capability)}
                  disabled={disabled || !sandboxed} onChange={(event) => onChange(kind, event.target.checked)} />
                <span aria-hidden="true" />
              </label>
            </div>
          );
        })}
      </div>
      <p className="desktop-dialog-note">{t(sandboxed ? "hosts.execution.sandboxed" : "hosts.execution.noSandbox")}</p>
    </section>
  );
}
