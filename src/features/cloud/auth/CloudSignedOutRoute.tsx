import type { CloudAuthState } from "./cloudAuthTypes";
import type { CloudWorkspaceSection } from "../types";
import { CloudWorkspaceLoadingState } from "../components/shared";
import { CloudSignInView } from "./CloudSignInView";

export function CloudSignedOutRoute({
  activeSection,
  authState,
  apiBaseUrl,
  loadingLabel,
}: {
  activeSection: CloudWorkspaceSection;
  authState: CloudAuthState;
  apiBaseUrl: string | null;
  loadingLabel: string;
}) {
  const sessionTransitioning = authState.status === "restoring" || authState.status === "signing-out";
  if (sessionTransitioning) {
    return (
      <main className="desktop-cloud-main-view" data-po-scrollbar="content">
        <div className="desktop-cloud-page-shell">
          <CloudWorkspaceLoadingState label={loadingLabel} />
        </div>
      </main>
    );
  }

  return (
    <main
      className="desktop-cloud-main-view desktop-cloud-auth-main-view"
      data-po-scrollbar="content"
    >
      <div className="desktop-cloud-auth-page-shell">
        <CloudSignInView
          activeSection={activeSection}
          apiBaseUrl={apiBaseUrl}
        />
      </div>
    </main>
  );
}
