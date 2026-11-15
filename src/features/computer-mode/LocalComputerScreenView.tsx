import { useLocalization } from "@puppyone/localization";
import { Monitor, Moon, Play, Sparkles } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type {
  LocalComputerRecord,
  LocalComputerRuntimeInfo,
  LocalComputerScreenSession,
} from "../../../shared/local-computers/types";
import {
  CloudScreenLiveViewport,
  cloudScreenViewer,
  type CloudScreenViewerStatus,
} from "../cloud";

export type LocalComputerScreenViewProps = Readonly<{
  computer: LocalComputerRecord;
  runtime: LocalComputerRuntimeInfo;
  connect: (id: string) => Promise<LocalComputerScreenSession>;
  onWake: (id: string) => Promise<unknown>;
  onSleep: (id: string) => Promise<unknown>;
  onProvisionDesktop: (id: string) => Promise<unknown>;
}>;

type LiveStreamState =
  | { kind: "idle" }
  | { kind: "connecting" }
  | { kind: "open"; session: LocalComputerScreenSession; viewerStatus: CloudScreenViewerStatus }
  | { kind: "failed" };

export function LocalComputerScreenView({
  computer,
  runtime,
  connect,
  onWake,
  onSleep,
  onProvisionDesktop,
}: LocalComputerScreenViewProps) {
  const { t } = useLocalization();
  const [busyAction, setBusyAction] = useState(false);
  const [stream, setStream] = useState<LiveStreamState>({ kind: "idle" });
  const [attempt, setAttempt] = useState(0);

  const shouldStreamVnc = computer.status === "running" && computer.desktopReady;

  useEffect(() => {
    if (!shouldStreamVnc) {
      setStream({ kind: "idle" });
      return undefined;
    }
    let active = true;
    setStream({ kind: "connecting" });
    connect(computer.id).then(
      (session) => {
        if (!active) return;
        if (session.transport === "vnc-ws" && session.url) {
          setStream({ kind: "open", session, viewerStatus: "connecting" });
        } else {
          setStream({ kind: "idle" });
        }
      },
      () => {
        if (active) setStream({ kind: "failed" });
      },
    );
    return () => {
      active = false;
    };
  }, [attempt, computer.id, connect, shouldStreamVnc]);

  const onViewerStatus = useCallback((viewerStatus: CloudScreenViewerStatus) => {
    setStream((current) => {
      if (current.kind !== "open") return current;
      if (viewerStatus === "disconnected") return { kind: "failed" };
      return { ...current, viewerStatus };
    });
  }, []);

  const runAction = async (task: () => Promise<unknown>) => {
    if (busyAction) return;
    setBusyAction(true);
    try {
      await task();
    } finally {
      setBusyAction(false);
    }
  };

  if (computer.status === "asleep" || computer.status === "stopped") {
    return (
      <section className="computer-mode-screen-surface" aria-label={t("cloud.sandbox.screen.label")}>
        <div className="computer-mode-screen-card is-asleep">
          <span className="computer-mode-screen-icon" aria-hidden="true">
            <Moon size={22} strokeWidth={1.7} />
          </span>
          <h3 className="computer-mode-screen-title">{computer.name}</h3>
          <p className="computer-mode-screen-note">
            {t("onboarding.computerMode.screen.asleepNote")}
          </p>
          <div className="computer-mode-screen-actions">
            <button
              type="button"
              className="cloud-screen-view-action is-primary"
              disabled={busyAction}
              onClick={() => void runAction(() => onWake(computer.id))}
            >
              <Play size={13} strokeWidth={2} aria-hidden="true" />
              <span>{t("onboarding.computerMode.screen.wakeAction")}</span>
            </button>
          </div>
        </div>
      </section>
    );
  }

  if (computer.status === "provisioning") {
    return (
      <section
        className="computer-mode-screen-surface"
        aria-label={t("cloud.sandbox.screen.label")}
        aria-busy="true"
      >
        <div className="computer-mode-screen-card is-provisioning">
          <span className="computer-mode-screen-icon" aria-hidden="true">
            <Sparkles size={22} strokeWidth={1.7} />
          </span>
          <h3 className="computer-mode-screen-title">{computer.name}</h3>
          <p className="computer-mode-screen-note" role="status">
            {t("onboarding.computerMode.screen.provisioningNote")}
          </p>
        </div>
      </section>
    );
  }

  const Viewer = shouldStreamVnc ? cloudScreenViewer("vnc") : null;
  if (Viewer && stream.kind === "open") {
    const connecting = stream.viewerStatus !== "connected";
    return (
      <CloudScreenLiveViewport
        Viewer={Viewer}
        session={{
          url: stream.session.url,
          protocols: stream.session.protocols ?? ["binary"],
          transport: "vnc",
        }}
        connecting={connecting}
        onStatus={onViewerStatus}
        className="computer-mode-live-screen"
      >
        <div className="computer-mode-live-toolbar">
          <span className="computer-mode-live-pill">
            <i className="computer-mode-live-dot" aria-hidden="true" />
            <span>{computer.name}</span>
          </span>
          <button
            type="button"
            className="computer-mode-live-sleep"
            disabled={busyAction}
            onClick={() => void runAction(() => onSleep(computer.id))}
          >
            {t("onboarding.computerMode.screen.sleepAction")}
          </button>
        </div>
      </CloudScreenLiveViewport>
    );
  }

  return (
    <section className="computer-mode-screen-surface" aria-label={t("cloud.sandbox.screen.label")}>
      <div className="computer-mode-screen-card is-running">
        <div className="computer-mode-screen-preview-window" aria-hidden="true">
          <div className="computer-mode-screen-preview-bar">
            <span />
            <span />
            <span />
          </div>
          <div className="computer-mode-screen-preview-stage">
            <Monitor size={24} strokeWidth={1.65} />
          </div>
        </div>
        <div className="computer-mode-screen-status-row">
          <span className="computer-mode-status-pill" data-status="running">
            {t("onboarding.computerMode.status.running")}
          </span>
          <span className="computer-mode-runtime-meta">
            {runtime.available
              ? t("onboarding.computerMode.dialog.runtimeReady")
              : t("onboarding.computerMode.dialog.runtimeManaged")}
          </span>
        </div>
        <h3 className="computer-mode-screen-title">{computer.name}</h3>
        <p className="computer-mode-screen-note">
          {stream.kind === "failed"
            ? t("cloud.sandbox.screen.disconnected")
            : t("onboarding.computerMode.screen.workspaceReadyNote")}
        </p>
        <div className="computer-mode-screen-actions">
          {stream.kind === "failed" && (
            <button
              type="button"
              className="cloud-screen-view-action is-primary"
              onClick={() => setAttempt((value) => value + 1)}
            >
              {t("cloud.sandbox.screen.retry")}
            </button>
          )}
          {runtime.available && !computer.desktopReady && (
            <button
              type="button"
              className="cloud-screen-view-action is-primary"
              disabled={busyAction}
              onClick={() => void runAction(() => onProvisionDesktop(computer.id))}
            >
              <Monitor size={13} strokeWidth={1.9} aria-hidden="true" />
              <span>{t("onboarding.computerMode.screen.startDesktopAction")}</span>
            </button>
          )}
          <button
            type="button"
            className="cloud-screen-view-action"
            disabled={busyAction}
            onClick={() => void runAction(() => onSleep(computer.id))}
          >
            <Moon size={13} strokeWidth={1.9} aria-hidden="true" />
            <span>{t("onboarding.computerMode.screen.sleepAction")}</span>
          </button>
        </div>
      </div>
    </section>
  );
}
