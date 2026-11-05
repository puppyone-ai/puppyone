import { useLocalization } from "@puppyone/localization/react";
import type { CloudWorkspaceSection } from "../types";
import { CloudActivationHero } from "../components/CloudActivationHero";
import { CloudProjectActivation } from "../components/CloudProjectActivation";
import { CloudAuthCard } from "./CloudAuthCard";
import { useCloudAuthController } from "../hooks/useCloudAuthController";
import "./cloud-sign-in.css";

export function CloudSignInView({
  activeSection,
  apiBaseUrl,
}: {
  activeSection: CloudWorkspaceSection;
  apiBaseUrl: string | null;
}) {
  const { t } = useLocalization();
  const auth = useCloudAuthController({
    cloudApiBaseUrl: apiBaseUrl,
  });

  const action = <CloudAuthCard signingIn={auth.signingIn} error={auth.error} onSignIn={auth.startSignIn} />;
  if (activeSection === "initialize") return <CloudProjectActivation action={action} />;

  return (
    <CloudActivationHero
      activeSection={activeSection}
      className="desktop-cloud-sign-in-entry"
      ariaLabel={t("cloud.auth.signInToCloud")}
      action={action}
    />
  );
}
