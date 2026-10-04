import { Tooltip } from "@puppyone/shared-ui";
import { useEffect, useState, type ReactNode, type Ref } from "react";
import { useLocalization } from "@puppyone/localization/react";
import { useDesktopPlatformCapabilities } from "../platform/useDesktopPlatformCapabilities";
import { PuppyBrandMark } from "./brand/PuppyBrandMark";

type DesktopWindowChromeProps = {
  /** Header presentation location; shell content separately owns the committed provider. */
  workspaceLocation?: "local" | "cloud";
  context?: ReactNode;
  centeredContext?: ReactNode;
  actions?: ReactNode;
  tabs?: ReactNode;
  sessionTabsHostRef?: Ref<HTMLDivElement>;
};

/**
 * Owns the renderer-side native window chrome boundary.
 *
 * Product surfaces and shared editors must remain inside the sibling
 * workbench subtree and must never participate in Electron's draggable-region
 * hit testing.
 */
export function DesktopWindowChrome({
  workspaceLocation = "local",
  context,
  centeredContext,
  actions,
  tabs,
  sessionTabsHostRef,
}: DesktopWindowChromeProps) {
  const { t } = useLocalization();
  const fullScreen = useWindowFullScreenState();
  const windowActive = useWindowActivityState();
  const platformCapabilities = useDesktopPlatformCapabilities();

  return (
    <header
      className="desktop-titlebar"
      // Leave Local's existing skin cascade untouched; only Cloud opts into tint.
      data-workspace-kind={workspaceLocation === "cloud" ? "cloud" : undefined}
      data-window-drag-region="true"
      data-window-chrome-mode={platformCapabilities?.windowChrome.mode}
      data-window-platform={platformCapabilities?.platform}
      data-window-active={windowActive ? "true" : "false"}
      data-window-full-screen={fullScreen ? "true" : undefined}
      data-centered-project={centeredContext ? "true" : undefined}
    >
      {workspaceLocation === "cloud" && <span className="desktop-cloud-header-reveal" aria-hidden="true" />}
      <div className="desktop-titlebar-layout">
        <div className="desktop-titlebar-leading">
          <div className="desktop-titlebar-left">
            <div className="desktop-titlebar-brand" aria-hidden="true">
              <PuppyBrandMark
                className="desktop-titlebar-brand-icon"
                tone="lite"
              />
              <strong className="desktop-titlebar-brand-name">{t("shell.brand.name")}</strong>
              <span className="desktop-titlebar-brand-separator">—</span>
            </div>
            {context}
          </div>
          <div
            className="desktop-titlebar-drag-fill"
            data-window-drag-region="true"
            aria-hidden={sessionTabsHostRef || tabs ? undefined : true}
          >
            {(sessionTabsHostRef || tabs) && (
              <div
                ref={sessionTabsHostRef}
                className="desktop-titlebar-session-tabs-host"
                data-window-no-drag="true"
              >
                {tabs}
              </div>
            )}
          </div>
        </div>
        {centeredContext && (
          <div className="desktop-titlebar-centered-context" data-window-no-drag="true">
            {centeredContext}
          </div>
        )}
        <div className="desktop-titlebar-trailing">
          {actions && (
            <div className="desktop-titlebar-actions">
              {actions}
            </div>
          )}
          <div className="desktop-window-controls" data-window-no-drag="true">
            <Tooltip content={t("shell.windowControls.minimize")}><button
              className="desktop-window-control is-minimize"
              type="button"
              aria-label={t("shell.windowControls.minimize")}
              onClick={() => performWindowAction("minimize")}
            >
              <span aria-hidden="true" />
            </button></Tooltip>
            <Tooltip content={t("shell.windowControls.maximize")}><button
              className="desktop-window-control is-maximize"
              type="button"
              aria-label={t("shell.windowControls.maximize")}
              onClick={() => performWindowAction("toggle-maximize")}
            >
              <span aria-hidden="true" />
            </button></Tooltip>
            <Tooltip content={t("shell.windowControls.close")}><button
              className="desktop-window-control is-close"
              type="button"
              aria-label={t("shell.windowControls.close")}
              onClick={() => performWindowAction("close")}
            >
              <span aria-hidden="true" />
            </button></Tooltip>
          </div>
        </div>
      </div>
    </header>
  );
}

function useWindowActivityState() {
  const [active, setActive] = useState(() => (
    typeof document === "undefined" || document.hasFocus()
  ));

  useEffect(() => {
    const activate = () => setActive(true);
    const deactivate = () => setActive(false);
    window.addEventListener("focus", activate);
    window.addEventListener("blur", deactivate);
    return () => {
      window.removeEventListener("focus", activate);
      window.removeEventListener("blur", deactivate);
    };
  }, []);

  return active;
}

function performWindowAction(action: "minimize" | "toggle-maximize" | "close") {
  void window.puppyoneDesktop?.performWindowAction?.({ action }).catch(() => undefined);
}

function useWindowFullScreenState() {
  const [fullScreen, setFullScreen] = useState(false);

  useEffect(() => {
    const bridge = window.puppyoneDesktop;
    if (!bridge?.getWindowChromeState || !bridge.onWindowChromeStateChanged) return undefined;

    let active = true;
    const applyState = (state: { fullScreen: boolean }) => {
      if (active) setFullScreen(state?.fullScreen === true);
    };
    const stopListening = bridge.onWindowChromeStateChanged(applyState);
    void bridge.getWindowChromeState().then(applyState).catch(() => undefined);

    return () => {
      active = false;
      stopListening();
    };
  }, []);

  return fullScreen;
}

export function DesktopWindowDragRegion({ className }: { className: string }) {
  return (
    <div
      className={className}
      data-window-drag-region="true"
      aria-hidden="true"
    />
  );
}
