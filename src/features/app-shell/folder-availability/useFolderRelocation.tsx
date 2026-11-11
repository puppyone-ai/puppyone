import { useCallback, useRef, useState } from "react";
import { Tooltip } from "@puppyone/shared-ui";
import { bidiIsolate, useLocalization } from "@puppyone/localization";
import { DesktopDialogCloseButton, DesktopDialogRoot, DesktopDialogSurface } from "../../../components/DesktopDialog";
import { DesktopOverlayLayer } from "../../../components/DesktopOverlayPortal";
import type { FolderCandidate, FolderRelocation } from "../../../types/electron";
import { folderNameOf } from "./folderAvailabilityCopy";

type Pending =
  | { kind: "confirm"; from: string; candidate: FolderCandidate }
  | { kind: "share-again"; relocation: FolderRelocation };

/**
 * Finding a project's folder again: the person points at it in the system dialog, or
 * takes the one Main found renamed in place. A folder that does not look like the same
 * one is used only after the person says so. A project that was open to the owner's
 * other computers is offered again from its new place, through the ordinary approval.
 */
export function useFolderRelocation({ onRelocated, onShareAgain }: {
  onRelocated: (relocation: FolderRelocation) => void | Promise<void>;
  /** Opens sharing for the folder's new place; absent when this computer cannot share. */
  onShareAgain?: (folderPath: string) => void;
}) {
  const { t } = useLocalization();
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);

  const run = useCallback(async (step: () => Promise<void>) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError(null);
    try { await step(); } catch { setError(t("shell.folderRelocate.failed")); } finally {
      running.current = false;
      setBusy(false);
    }
  }, [t]);

  const apply = useCallback((candidate: FolderCandidate) => run(async () => {
    const relocation = await window.puppyoneDesktop!.relocateFolder(candidate.token);
    setPending(relocation.wasShared && onShareAgain ? { kind: "share-again", relocation } : null);
    await onRelocated(relocation);
  }), [onRelocated, onShareAgain, run]);

  const locate = useCallback((folderPath: string) => run(async () => {
    const result = await window.puppyoneDesktop!.locateFolder(folderPath);
    if (result.status !== "selected") return;
    if (result.match === "different") {
      setPending({ kind: "confirm", from: folderPath, candidate: result });
      return;
    }
    const relocation = await window.puppyoneDesktop!.relocateFolder(result.token);
    setPending(relocation.wasShared && onShareAgain ? { kind: "share-again", relocation } : null);
    await onRelocated(relocation);
  }), [onRelocated, onShareAgain, run]);

  const close = () => { if (!busy) { setPending(null); setError(null); } };
  let dialog = null;
  if (pending?.kind === "confirm") {
    const name = folderNameOf(pending.from);
    dialog = (
      <FolderDialog title={t("shell.folderRelocate.confirmTitle", { name: bidiIsolate(name) })} busy={busy} onClose={close}
        body={t("shell.folderRelocate.different", { chosen: bidiIsolate(pending.candidate.name), name: bidiIsolate(name) })}
        error={error}
        secondary={{ label: t("shell.folderRelocate.chooseAgain"), onClick: () => { setPending(null); void locate(pending.from); } }}
        primary={{ label: t("shell.folderRelocate.useIt"), onClick: () => void apply(pending.candidate) }} />
    );
  } else if (pending?.kind === "share-again") {
    const name = folderNameOf(pending.relocation.path);
    dialog = (
      <FolderDialog title={t("shell.folderRelocate.sharedTitle")} busy={busy} onClose={close}
        body={t("shell.folderRelocate.wasShared", { name: bidiIsolate(name) })} error={null}
        secondary={{ label: t("shell.folderRelocate.notNow"), onClick: close }}
        primary={{ label: t("shell.folderRelocate.shareAgain"), onClick: () => {
          const target = pending.relocation.path;
          setPending(null);
          onShareAgain?.(target);
        } }} />
    );
  }
  return { locate, apply, busy, error, dialog };
}

type DialogAction = { label: string; onClick: () => void };

/** A two-choice question about a project's folder, in the product's dialog. */
export function FolderDialog({ title, body, error, busy, secondary, primary, onClose }: {
  title: string;
  body: string;
  error: string | null;
  busy: boolean;
  secondary: DialogAction;
  primary: DialogAction;
  onClose: () => void;
}) {
  const { t } = useLocalization();
  return (
    <DesktopOverlayLayer>
      <DesktopDialogRoot dismissOnBackdrop={!busy} onClose={busy ? undefined : onClose}>
        <DesktopDialogSurface className="desktop-project-folder-dialog" width={420} ariaLabel={title}>
          <header className="desktop-dialog-header">
            <div className="desktop-dialog-title-row"><h2>{title}</h2></div>
            <Tooltip content={t("common.action.close")}><DesktopDialogCloseButton
              label={t("common.action.close")} disabled={busy} onClick={onClose} /></Tooltip>
          </header>
          <div className="desktop-dialog-body">
            <p>{body}</p>
            {error && <p className="desktop-dialog-error" role="alert">{error}</p>}
          </div>
          <footer className="desktop-dialog-footer">
            <button className="desktop-dialog-button" type="button" disabled={busy} onClick={secondary.onClick}>
              {secondary.label}
            </button>
            <button className="desktop-dialog-button primary" type="button" disabled={busy}
              aria-busy={busy || undefined} data-desktop-dialog-initial-focus="true" onClick={primary.onClick}>
              {primary.label}
            </button>
          </footer>
        </DesktopDialogSurface>
      </DesktopDialogRoot>
    </DesktopOverlayLayer>
  );
}
