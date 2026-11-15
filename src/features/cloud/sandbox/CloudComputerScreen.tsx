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
import { statusOf, type CloudSandbox, type CloudSandboxSettings, type CloudScreenSession } from "../files/contracts";
import { CLOUD_SCREEN_RECONNECTS, cloudScreenAvailability, type CloudScreenAvailability } from "./cloudScreenState";
import {
  cloudScreenViewer,
  type CloudScreenViewerProps,
  type CloudScreenViewerStatus,
} from "./screenTransports";
import "./cloud-computer-screen.css";

/** A small screen under the explorer; opening it shows the screen in the editor area. */
export function CloudScreenThumbnail({ active, onOpen }: {
  active: boolean;
  onOpen: () => void;
}) {
  const { t } = useLocalization();
  const label = t("cloud.sandbox.screen.open");
  return <button type="button" className="cloud-screen-thumbnail" data-active={active || undefined}
    aria-pressed={active} aria-label={label} title={label} onClick={onOpen}>
    <ScreenGlyph className="cloud-screen-thumbnail-glyph" />
  </button>;
}

type ScreenConnection =
  | { state: "requesting" }
  | { state: "open"; session: CloudScreenSession; status: CloudScreenViewerStatus }
  | { state: "asleep" }
  | { state: "failed" };

/** The Cloud Computer's screen in the editor area, or one quiet line saying why not. */
export function CloudScreenView({ sandbox, connect, onSettings, onWake }: {
  sandbox: CloudSandbox;
  connect: () => Promise<CloudScreenSession>;
  onSettings: (settings: CloudSandboxSettings) => Promise<void>;
  onWake: () => void;
}) {
  const { t } = useLocalization();
  const availability = cloudScreenAvailability(sandbox);
  const [saving, setSaving] = useState(false);
  const change = (settings: CloudSandboxSettings) => {
    setSaving(true);
    void onSettings(settings).finally(() => setSaving(false));
  };
  if (availability.kind === "stream") {
    return <ScreenStream transport={availability.transport} connect={connect} onWake={onWake} />;
  }
  const { notice, action } = screenNotice(availability);
  return <ScreenNotice notice={t(notice)}>
    {action && <button type="button" className="cloud-screen-view-action" disabled={saving}
      onClick={() => change(action.settings)}>{t(action.label)}</button>}
  </ScreenNotice>;
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
        : { notice: "cloud.sandbox.screen.not-installed",
          action: { label: "cloud.sandbox.screen.install", settings: { desktop: true } } };
    case "stream_off":
      return { notice: "cloud.sandbox.screen.stream-off",
        action: { label: "cloud.sandbox.screen.stream-on", settings: { screen_stream: true } } };
    default:
      return { notice: "cloud.sandbox.screen.unavailable", action: null };
  }
}

function ScreenNotice({ notice, children }: { notice: string; children?: ReactNode }) {
  const { t } = useLocalization();
  return <section className="cloud-screen-view" aria-label={t("cloud.sandbox.screen.label")}>
    <ScreenGlyph className="cloud-screen-view-glyph" />
    <p className="cloud-screen-view-note" dir="auto">{notice}</p>
    {children}
  </section>;
}

function ScreenStream({ transport, connect, onWake }: {
  transport: string;
  connect: () => Promise<CloudScreenSession>;
  onWake: () => void;
}) {
  const { t } = useLocalization();
  const Viewer = cloudScreenViewer(transport);
  const [connection, setConnection] = useState<ScreenConnection>({ state: "requesting" });
  const [attempt, setAttempt] = useState(0);
  const drops = useRef(0);

  useEffect(() => {
    let current = true;
    setConnection({ state: "requesting" });
    connect().then(
      session => { if (current) setConnection({ state: "open", session, status: "connecting" }); },
      error => { if (current) setConnection({ state: statusOf(error) === 409 ? "asleep" : "failed" }); },
    );
    return () => { current = false; };
  }, [connect, attempt]);

  const onStatus = useCallback((status: CloudScreenViewerStatus) => {
    if (status === "connected") drops.current = 0;
    if (status === "disconnected" && drops.current < CLOUD_SCREEN_RECONNECTS) {
      drops.current += 1;
      window.setTimeout(() => setAttempt(value => value + 1), 1_000);
      return;
    }
    setConnection(value => {
      if (value.state !== "open") return value;
      return status === "disconnected" ? { state: "failed" } : { ...value, status };
    });
  }, []);

  const retry = () => { drops.current = 0; setAttempt(value => value + 1); };
  if (!Viewer) return <ScreenNotice notice={t("cloud.sandbox.screen.unavailable")} />;
  if (connection.state === "asleep") {
    return <ScreenNotice notice={t("cloud.sandbox.screen.asleep")}>
      <button type="button" className="cloud-screen-view-action" onClick={() => { onWake(); retry(); }}>
        {t("cloud.sandbox.screen.wake")}</button>
    </ScreenNotice>;
  }
  if (connection.state === "failed") {
    return <ScreenNotice notice={t("cloud.sandbox.screen.disconnected")}>
      <button type="button" className="cloud-screen-view-action" onClick={retry}>
        {t("cloud.sandbox.screen.retry")}</button>
    </ScreenNotice>;
  }
  const connecting = connection.state === "requesting" || connection.status !== "connected";
  return (
    <CloudScreenLiveViewport
      Viewer={Viewer}
      session={connection.state === "open" ? connection.session : null}
      connecting={connecting}
      onStatus={onStatus}
    />
  );
}

/**
 * Shared live computer screen stage. Starts read-only so moving or clicking the
 * outer pointer never hijacks the inner desktop; hovering reveals "Take control"
 * ("接管"), and clicking outside or "Release control" exits back to view-only.
 */
export function CloudScreenLiveViewport({
  Viewer,
  session,
  connecting,
  onStatus,
  className,
  children,
}: {
  Viewer: ComponentType<CloudScreenViewerProps>;
  session: CloudScreenSession | null;
  connecting: boolean;
  onStatus: (status: CloudScreenViewerStatus) => void;
  className?: string;
  children?: ReactNode;
}) {
  const { t } = useLocalization();
  const stageRef = useRef<HTMLElement>(null);
  const [interactive, setInteractive] = useState(false);

  useEffect(() => {
    if (connecting || !session) {
      setInteractive(false);
    }
  }, [connecting, session]);

  useEffect(() => {
    if (!interactive) return undefined;
    const onOutsidePointerDown = (event: PointerEvent) => {
      const stage = stageRef.current;
      if (!stage) return;
      if (event.target instanceof Node && !stage.contains(event.target)) {
        setInteractive(false);
      }
    };
    document.addEventListener("pointerdown", onOutsidePointerDown, true);
    return () => document.removeEventListener("pointerdown", onOutsidePointerDown, true);
  }, [interactive]);

  const readyToControl = Boolean(session) && !connecting;
  const activeInteractive = readyToControl && interactive;

  return (
    <section
      ref={stageRef}
      className={className ? `cloud-screen-live ${className}` : "cloud-screen-live"}
      data-interactive={activeInteractive ? "true" : "false"}
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
      {readyToControl && !activeInteractive && (
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
      {activeInteractive && (
        <div className="cloud-screen-release-bar">
          <button
            type="button"
            className="cloud-screen-release-button"
            onClick={() => setInteractive(false)}
          >
            <span className="cloud-screen-release-dot" aria-hidden="true" />
            <span>{t("cloud.sandbox.screen.release-control")}</span>
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
  return <svg className={`cloud-screen-glyph ${className}`} viewBox="0 0 20 16" aria-hidden="true">
    <rect className="cloud-screen-glyph-display" x="1.5" y="1.5" width="17" height="10.5" rx="2.25" />
    <path className="cloud-screen-glyph-stand" d="M10 12v2.25M7.25 14.5h5.5" />
  </svg>;
}

function PointerGlyph({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4.25 2.5 12.25 8.1l-3.4.55 1.75 3.85-1.65.75-1.75-3.85-2.95 2.35Z" />
    </svg>
  );
}
