import {
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import { useLocalization } from "@puppyone/localization";
import { Tooltip } from "@puppyone/shared-ui";
import { statusOf, type CloudSandbox, type CloudSandboxSettings, type CloudScreenSession } from "../files/contracts";
import { CLOUD_SCREEN_RECONNECTS, cloudScreenAvailability, type CloudScreenAvailability } from "./cloudScreenState";
import {
  cloudScreenViewer,
  type CloudScreenViewerProps,
  type CloudScreenViewerStatus,
} from "./screenTransports";
import "./cloud-computer-screen.css";

export type ComputerScreenPower = "running" | "provisioning" | "asleep" | "inactive";
export type ComputerScreenStageMode = "full" | "pip";
export type CloudScreenRuntimeState = Readonly<{
  power: ComputerScreenPower;
  streamActive: boolean;
}>;

/** A small screen under the explorer; retained for compatibility. */
export function CloudScreenThumbnail({ active, onOpen }: {
  active: boolean;
  onOpen: () => void;
}) {
  const { t } = useLocalization();
  const label = t("cloud.sandbox.screen.open");
  return (
    <Tooltip content={label}>
      <button
        type="button"
        className="cloud-screen-thumbnail"
        data-active={active || undefined}
        aria-pressed={active}
        aria-label={label}
        onClick={onOpen}
      >
        <ScreenGlyph className="cloud-screen-thumbnail-glyph" />
      </button>
    </Tooltip>
  );
}

function resolveSidebarScreenStatusKey(
  power: ComputerScreenPower,
  place: "cloud" | "device",
): string {
  switch (power) {
    case "running":
      return place === "cloud"
        ? "cloud.sandbox.screen.status.running-cloud"
        : "cloud.sandbox.screen.status.running-device";
    case "provisioning":
      return "cloud.sandbox.screen.status.provisioning";
    case "asleep":
      return "cloud.sandbox.screen.status.asleep";
    case "inactive":
      return "cloud.sandbox.screen.status.desktop-off";
  }
}

/**
 * Fixed-height computer screen entry pinned at the top of the Explorer sidebar.
 * Displays a miniature desktop window preview, status LED caption, and an
 * inline Wake action when asleep without shifting the file list below.
 */
export function ComputerScreenSidebarEntry({
  active,
  power,
  place,
  onOpen,
  onWake,
  wakeDisabled = false,
}: {
  active: boolean;
  power: ComputerScreenPower;
  place: "cloud" | "device";
  onOpen: () => void;
  onWake?: () => void;
  wakeDisabled?: boolean;
}) {
  const { t } = useLocalization();
  const statusLabel = t(resolveSidebarScreenStatusKey(power, place));
  return (
    <div className="computer-screen-sidebar-entry-host">
      <div
        className="computer-screen-sidebar-entry"
        data-active={active ? "true" : undefined}
        data-power={power}
      >
        <button
          type="button"
          className="computer-screen-sidebar-entry-main"
          data-computer-screen-sidebar-entry=""
          aria-pressed={active}
          onClick={onOpen}
        >
          <span className="computer-screen-sidebar-mini" data-power={power} aria-hidden="true">
            <span className="computer-screen-sidebar-mini-window" />
            <span className="computer-screen-sidebar-mini-dot" />
          </span>
          <span className="computer-screen-sidebar-meta">
            <span className="computer-screen-sidebar-title">{t("cloud.sandbox.screen.title")}</span>
            <span className="computer-screen-sidebar-status">
              <span className="computer-screen-led" data-power={power} aria-hidden="true" />
              <span className="computer-screen-sidebar-status-text">{statusLabel}</span>
            </span>
          </span>
        </button>
        {power === "asleep" && onWake && (
          <button
            type="button"
            className="computer-screen-sidebar-wake"
            data-computer-screen-sidebar-wake=""
            disabled={wakeDisabled}
            onClick={onWake}
          >
            {t("cloud.sandbox.screen.wake")}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Persistent screen stage mounted inside the main editor pane so switching
 * between Full-Pane screen and Files smoothly transitions to bottom-right PiP
 * without unmounting or reconnecting the underlying VNC session.
 */
export function ComputerScreenStage({
  mode,
  pipVisible,
  onExpandFromPip,
  onHidePip,
  onCollapseToPip,
  children,
}: {
  mode: ComputerScreenStageMode;
  pipVisible: boolean;
  onExpandFromPip: () => void;
  onHidePip: () => void;
  onCollapseToPip?: () => void;
  children: ReactNode;
}) {
  const { t } = useLocalization();
  const pipHidden = mode === "pip" && !pipVisible;

  useEffect(() => {
    if (mode !== "full" || !onCollapseToPip) return undefined;
    const onDocumentClick = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      if (event.target.closest("[data-editor-tab-id]")) {
        onCollapseToPip();
      }
    };
    document.addEventListener("click", onDocumentClick);
    return () => document.removeEventListener("click", onDocumentClick);
  }, [mode, onCollapseToPip]);

  return (
    <div
      className="computer-screen-stage"
      data-computer-screen-stage=""
      data-mode={mode}
      data-pip-hidden={pipHidden ? "true" : undefined}
      aria-hidden={pipHidden ? "true" : undefined}
    >
      <div className="computer-screen-stage-body">{children}</div>
      {mode === "pip" && pipVisible && (
        <>
          <button
            type="button"
            className="computer-screen-pip-hit"
            data-computer-screen-pip-expand=""
            aria-label={t("cloud.sandbox.screen.expand")}
            onClick={onExpandFromPip}
          />
          <span className="computer-screen-pip-label" aria-hidden="true">
            <span className="computer-screen-led" data-power="running" />
            <span>{t("cloud.sandbox.screen.title")}</span>
          </span>
          <Tooltip content={t("cloud.sandbox.screen.hide-pip")}>
            <button
              type="button"
              className="computer-screen-pip-close"
              data-computer-screen-pip-close=""
              aria-label={t("cloud.sandbox.screen.hide-pip")}
              onClick={onHidePip}
            >
              <CloseGlyph className="computer-screen-pip-close-glyph" />
            </button>
          </Tooltip>
        </>
      )}
    </div>
  );
}

type ScreenConnection =
  | { state: "requesting" }
  | { state: "open"; session: CloudScreenSession; status: CloudScreenViewerStatus }
  | { state: "asleep" }
  | { state: "failed" };

function resolveUnavailablePower(
  availability: Exclude<CloudScreenAvailability, { kind: "stream" }>,
): ComputerScreenPower {
  if (availability.kind === "preview") return "provisioning";
  if (availability.kind === "install" && availability.pending) return "provisioning";
  return "inactive";
}

function resolveConnectionRuntimeState(
  hasViewer: boolean,
  connection: ScreenConnection,
): CloudScreenRuntimeState {
  if (!hasViewer) return { power: "inactive", streamActive: false };
  switch (connection.state) {
    case "asleep":
      return { power: "asleep", streamActive: false };
    case "failed":
      return { power: "inactive", streamActive: false };
    case "requesting":
      return { power: "running", streamActive: false };
    case "open":
      return { power: "running", streamActive: connection.status === "connected" };
  }
}

/** The Cloud Computer's screen in the editor area, or one quiet line saying why not. */
export function CloudScreenView({
  sandbox,
  connect,
  onSettings,
  onWake,
  mode = "full",
  wakeSignal = 0,
  onRuntimeStateChange,
}: {
  sandbox: CloudSandbox;
  connect: () => Promise<CloudScreenSession>;
  onSettings: (settings: CloudSandboxSettings) => Promise<void>;
  onWake: () => void;
  mode?: ComputerScreenStageMode;
  wakeSignal?: number;
  onRuntimeStateChange?: (state: CloudScreenRuntimeState) => void;
}) {
  const { t } = useLocalization();
  const availability = cloudScreenAvailability(sandbox);
  const [saving, setSaving] = useState(false);

  const nonStreamPower = availability.kind === "stream"
    ? null
    : resolveUnavailablePower(availability);

  useEffect(() => {
    if (!nonStreamPower || !onRuntimeStateChange) return;
    onRuntimeStateChange({ power: nonStreamPower, streamActive: false });
  }, [nonStreamPower, onRuntimeStateChange]);

  const change = (settings: CloudSandboxSettings) => {
    setSaving(true);
    void onSettings(settings).finally(() => setSaving(false));
  };

  if (availability.kind === "stream") {
    return (
      <ScreenStream
        transport={availability.transport}
        connect={connect}
        onWake={onWake}
        mode={mode}
        wakeSignal={wakeSignal}
        onRuntimeStateChange={onRuntimeStateChange}
      />
    );
  }

  const { notice, action } = screenNotice(availability);
  return (
    <ScreenNotice notice={t(notice)}>
      {action && (
        <button
          type="button"
          className="cloud-screen-view-action"
          disabled={saving}
          onClick={() => change(action.settings)}
        >
          {t(action.label)}
        </button>
      )}
    </ScreenNotice>
  );
}

/** Message keys for a screen that cannot stream, and the one change that would help. */
function screenNotice(availability: Exclude<CloudScreenAvailability, { kind: "stream" }>): {
  notice: string;
  action: { label: string; settings: CloudSandboxSettings } | null;
} {
  switch (availability.kind) {
    case "preview":
      return { notice: "cloud.sandbox.screen.preview-note", action: null };
    case "install":
      return availability.pending
        ? { notice: "cloud.sandbox.screen.install-pending", action: null }
        : {
            notice: "cloud.sandbox.screen.not-installed",
            action: { label: "cloud.sandbox.screen.install", settings: { desktop: true } },
          };
    case "stream_off":
      return {
        notice: "cloud.sandbox.screen.stream-off",
        action: { label: "cloud.sandbox.screen.stream-on", settings: { screen_stream: true } },
      };
    default:
      return { notice: "cloud.sandbox.screen.unavailable", action: null };
  }
}

function ScreenNotice({ notice, children }: { notice: string; children?: ReactNode }) {
  const { t } = useLocalization();
  return (
    <section className="cloud-screen-view" aria-label={t("cloud.sandbox.screen.label")}>
      <ScreenGlyph className="cloud-screen-view-glyph" />
      <p className="cloud-screen-view-note" dir="auto">{notice}</p>
      {children}
    </section>
  );
}

function ScreenStream({
  transport,
  connect,
  onWake,
  mode,
  wakeSignal,
  onRuntimeStateChange,
}: {
  transport: string;
  connect: () => Promise<CloudScreenSession>;
  onWake: () => void;
  mode: ComputerScreenStageMode;
  wakeSignal: number;
  onRuntimeStateChange?: (state: CloudScreenRuntimeState) => void;
}) {
  const { t } = useLocalization();
  const Viewer = cloudScreenViewer(transport);
  const [connection, setConnection] = useState<ScreenConnection>({ state: "requesting" });
  const [attempt, setAttempt] = useState(0);
  const drops = useRef(0);
  const lastWakeSignal = useRef(wakeSignal);

  useEffect(() => {
    if (lastWakeSignal.current === wakeSignal) return;
    lastWakeSignal.current = wakeSignal;
    drops.current = 0;
    setAttempt((value) => value + 1);
  }, [wakeSignal]);

  useEffect(() => {
    let current = true;
    setConnection({ state: "requesting" });
    connect().then(
      (session) => {
        if (current) setConnection({ state: "open", session, status: "connecting" });
      },
      (error) => {
        if (current) setConnection({ state: statusOf(error) === 409 ? "asleep" : "failed" });
      },
    );
    return () => {
      current = false;
    };
  }, [connect, attempt]);

  const { power: runtimePower, streamActive } = resolveConnectionRuntimeState(
    Boolean(Viewer),
    connection,
  );
  useEffect(() => {
    onRuntimeStateChange?.({ power: runtimePower, streamActive });
  }, [onRuntimeStateChange, runtimePower, streamActive]);

  const onStatus = useCallback((status: CloudScreenViewerStatus) => {
    if (status === "connected") drops.current = 0;
    if (status === "disconnected" && drops.current < CLOUD_SCREEN_RECONNECTS) {
      drops.current += 1;
      window.setTimeout(() => setAttempt((value) => value + 1), 1_000);
      return;
    }
    setConnection((value) => {
      if (value.state !== "open") return value;
      return status === "disconnected" ? { state: "failed" } : { ...value, status };
    });
  }, []);

  const retry = () => {
    drops.current = 0;
    setAttempt((value) => value + 1);
  };

  if (!Viewer) return <ScreenNotice notice={t("cloud.sandbox.screen.unavailable")} />;
  if (connection.state === "asleep") {
    return (
      <ScreenNotice notice={t("cloud.sandbox.screen.asleep")}>
        <button
          type="button"
          className="cloud-screen-view-action"
          onClick={() => {
            onWake();
            retry();
          }}
        >
          {t("cloud.sandbox.screen.wake")}
        </button>
      </ScreenNotice>
    );
  }
  if (connection.state === "failed") {
    return (
      <ScreenNotice notice={t("cloud.sandbox.screen.disconnected")}>
        <button type="button" className="cloud-screen-view-action" onClick={retry}>
          {t("cloud.sandbox.screen.retry")}
        </button>
      </ScreenNotice>
    );
  }
  const connecting = connection.state === "requesting" || connection.status !== "connected";
  return (
    <CloudScreenLiveViewport
      Viewer={Viewer}
      session={connection.state === "open" ? connection.session : null}
      connecting={connecting}
      onStatus={onStatus}
      mode={mode}
    />
  );
}

/**
 * Shared live computer screen stage. Starts read-only so moving or clicking the
 * outer pointer never hijacks the inner desktop; hovering in Full-Pane mode
 * reveals "Take control" ("接管"), and pressing Escape, clicking outside, or
 * clicking "Release control" exits back to view-only.
 */
export function CloudScreenLiveViewport({
  Viewer,
  session,
  connecting,
  onStatus,
  mode = "full",
  onSleep,
  sleepDisabled = false,
  className,
  children,
}: {
  Viewer: ComponentType<CloudScreenViewerProps>;
  session: CloudScreenSession | null;
  connecting: boolean;
  onStatus: (status: CloudScreenViewerStatus) => void;
  mode?: ComputerScreenStageMode;
  onSleep?: () => void;
  sleepDisabled?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  const { t } = useLocalization();
  const stageRef = useRef<HTMLElement>(null);
  const [interactive, setInteractive] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    if (connecting || !session || mode !== "full") {
      setInteractive(false);
    }
  }, [connecting, mode, session]);

  const readyToControl = Boolean(session) && !connecting;
  const activeInteractive = mode === "full" && readyToControl && interactive;

  useEffect(() => {
    if (!activeInteractive) return undefined;
    const onOutsidePointerDown = (event: PointerEvent) => {
      const stage = stageRef.current;
      if (!stage) return;
      if (event.target instanceof Node && !stage.contains(event.target)) {
        setInteractive(false);
      }
    };
    const onEscapeKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setInteractive(false);
      }
    };
    document.addEventListener("pointerdown", onOutsidePointerDown, true);
    window.addEventListener("keydown", onEscapeKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onOutsidePointerDown, true);
      window.removeEventListener("keydown", onEscapeKeyDown, true);
    };
  }, [activeInteractive]);

  useEffect(() => {
    const syncFullscreen = () => {
      setIsFullscreen(Boolean(stageRef.current && document.fullscreenElement === stageRef.current));
    };
    document.addEventListener("fullscreenchange", syncFullscreen);
    return () => document.removeEventListener("fullscreenchange", syncFullscreen);
  }, []);

  const toggleFullscreen = () => {
    const stage = stageRef.current;
    if (!stage) return;
    if (document.fullscreenElement === stage) {
      void document.exitFullscreen?.().catch(() => undefined);
      return;
    }
    if (typeof stage.requestFullscreen === "function") {
      void stage.requestFullscreen().catch(() => undefined);
    }
  };

  const fullscreenLabel = t(
    isFullscreen ? "cloud.sandbox.screen.exit-fullscreen" : "cloud.sandbox.screen.fullscreen",
  );

  return (
    <section
      ref={stageRef}
      className={className ? `cloud-screen-live ${className}` : "cloud-screen-live"}
      data-interactive={activeInteractive ? "true" : "false"}
      data-mode={mode}
      aria-label={t("cloud.sandbox.screen.label")}
      aria-busy={connecting}
    >
      {children}
      {session && (
        <Suspense fallback={null}>
          <Viewer
            session={session}
            interactive={activeInteractive}
            onStatus={onStatus}
          />
        </Suspense>
      )}
      {mode === "full" && readyToControl && !activeInteractive && (
        <div className="cloud-screen-takeover-gate">
          <button
            type="button"
            className="cloud-screen-takeover-button"
            onClick={() => setInteractive(true)}
          >
            <PointerGlyph className="cloud-screen-takeover-glyph" />
            <span>{t("cloud.sandbox.screen.take-control")}</span>
          </button>
        </div>
      )}
      {mode === "full" && readyToControl && !activeInteractive && (
        <div className="cloud-screen-full-tools">
          {onSleep && (
            <button
              type="button"
              className="cloud-screen-tool-pill"
              disabled={sleepDisabled}
              onClick={onSleep}
            >
              <PowerGlyph className="cloud-screen-tool-glyph" />
              <span>{t("cloud.sandbox.screen.sleep")}</span>
            </button>
          )}
          <button
            type="button"
            className="cloud-screen-tool-pill"
            onClick={toggleFullscreen}
          >
            <ExpandGlyph className="cloud-screen-tool-glyph" />
            <span>{fullscreenLabel}</span>
          </button>
        </div>
      )}
      {activeInteractive && (
        <div className="cloud-screen-release-bar">
          <button
            type="button"
            className="cloud-screen-release-button"
            aria-label={t("cloud.sandbox.screen.release-control")}
            onClick={() => setInteractive(false)}
          >
            <span className="cloud-screen-release-dot" aria-hidden="true" />
            <span>{t("cloud.sandbox.screen.release-control")}</span>
            <kbd className="cloud-screen-release-kbd" aria-hidden="true">
              {t("cloud.sandbox.screen.release-shortcut")}
            </kbd>
          </button>
        </div>
      )}
      {connecting && (
        <p className="cloud-screen-live-status" role="status">
          {t("cloud.sandbox.screen.connecting")}
        </p>
      )}
    </section>
  );
}

function ScreenGlyph({ className }: { className: string }) {
  return (
    <svg className={`cloud-screen-glyph ${className}`} viewBox="0 0 20 16" aria-hidden="true">
      <rect className="cloud-screen-glyph-display" x="1.5" y="1.5" width="17" height="10.5" rx="2.25" />
      <path className="cloud-screen-glyph-stand" d="M10 12v2.25M7.25 14.5h5.5" />
    </svg>
  );
}

function PointerGlyph({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4.25 2.5 12.25 8.1l-3.4.55 1.75 3.85-1.65.75-1.75-3.85-2.95 2.35Z" />
    </svg>
  );
}

function PowerGlyph({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 2v5.5" />
      <path d="M4.5 4.5a5 5 0 1 0 7 0" />
    </svg>
  );
}

function ExpandGlyph({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" aria-hidden="true">
      <path d="M9.5 2.5h4v4M6.5 13.5h-4v-4M13.5 2.5 9 7M2.5 13.5 7 9" />
    </svg>
  );
}

function CloseGlyph({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
    </svg>
  );
}
