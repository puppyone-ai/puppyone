import { Component, type ErrorInfo, type ReactNode } from "react";
import { useLocalization } from "@puppyone/localization/react";
import { AlertCircle, RefreshCw } from "lucide-react";

type BoundaryProps = Readonly<{
  itemId: string;
  surface: "content" | "status";
  children: ReactNode;
  resetKey?: unknown;
  fallback: (reload: () => void) => ReactNode;
}>;

/** View recovery never creates, closes or discards the project-owned runtime. */
class RenderBoundary extends Component<BoundaryProps, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }

  componentDidCatch(_error: unknown, info: ErrorInfo) {
    console.error("[AuxiliaryWorkbench] isolated render failure", {
      itemId: this.props.itemId, surface: this.props.surface,
      componentStack: info.componentStack,
    });
  }

  componentDidUpdate(previous: BoundaryProps) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) this.reload();
  }

  private reload = () => { this.setState({ failed: false }); };

  render() {
    return this.state.failed ? this.props.fallback(this.reload) : this.props.children;
  }
}

export function AuxiliaryWorkbenchRenderBoundary({ itemId, children }: Readonly<{ itemId: string; children: ReactNode }>) {
  const { t } = useLocalization();
  return <RenderBoundary itemId={itemId} surface="content" fallback={(reload) => (
    <div className="auxiliary-workbench-render-failure" role="alert" data-native-surface-occluder="true">
      <AlertCircle size={16} strokeWidth={1.8} aria-hidden="true" />
      <span>{t("workspace.workbench.renderFailure")}</span>
      <button type="button" className="desktop-terminal-workbench-create-retry" onClick={reload}>
        <RefreshCw size={12} strokeWidth={1.8} aria-hidden="true" />{t("workspace.workbench.reloadView")}
      </button>
    </div>
  )}>{children}</RenderBoundary>;
}

/** Optional status chrome must not take down a tab's content or close controls. */
export function AuxiliaryWorkbenchStatusBoundary({ itemId, resetKey, children }: Readonly<{
  itemId: string; resetKey: unknown; children: ReactNode;
}>) {
  return <RenderBoundary itemId={itemId} surface="status" resetKey={resetKey} fallback={() => null}>{children}</RenderBoundary>;
}
