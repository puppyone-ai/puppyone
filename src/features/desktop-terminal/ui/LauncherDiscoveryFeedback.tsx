import { useEffect, useState, type ReactNode } from "react";
import { useLocalization } from "@puppyone/localization/react";
/** Delay only the indicator, never discovery or usable results. */
export function useDelayedDiscoveryFeedback(scanning: boolean) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!scanning) {
      setVisible(false);
      return;
    }
    const timer = window.setTimeout(() => setVisible(true), 200);
    return () => window.clearTimeout(timer);
  }, [scanning]);
  return scanning && visible;
}

export function LauncherDiscoveryFeedback({ scanning, refreshing, busy }: {
  scanning: boolean;
  refreshing: boolean;
  empty: boolean;
  busy: boolean;
}) {
  const { t } = useLocalization();
  const message = scanning
    ? refreshing ? "terminal.launcher.refreshing" : "terminal.launcher.detecting"
    : null;
  if (!message) return null;
  return <div className="desktop-terminal-launcher-discovery" data-scanning={scanning}>
    <span className="desktop-terminal-launcher-discovery-icon" aria-hidden="true">
      {scanning && !busy && <span className="desktop-terminal-launcher-discovery-spinner" />}
    </span>
    <span>{t(message)}</span>
  </div>;
}

/** A keyed row remembers its entry state; subsequent progress never restarts it. */
export function DiscoveryAgentRow({ animate, children }: { animate: boolean; children: ReactNode }) {
  const [entering, setEntering] = useState(animate);
  useEffect(() => {
    if (!entering) return;
    // Also retire the class when reduced motion / a hidden tab prevents an
    // animationend event. Leaving it attached would replay on display:none exit.
    const timer = window.setTimeout(() => setEntering(false), 160);
    return () => window.clearTimeout(timer);
  }, [entering]);
  return <div role="listitem" onAnimationEnd={() => setEntering(false)}
    className={entering && animate ? "desktop-terminal-launcher-discovered" : undefined}>
    {children}
  </div>;
}
