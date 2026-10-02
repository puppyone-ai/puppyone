import { useLocalization } from "@puppyone/localization/react";
import type { CloudWorkspaceSection } from "../types";
import { CloudActivationHero } from "../components/CloudActivationHero";
import { CloudAuthCard } from "./CloudAuthCard";
import { DesktopCloudSignInCta } from "./DesktopCloudSignInCta";
import { useCloudAuthController } from "../hooks/useCloudAuthController";
import "./cloud-sign-in.css";

export function CloudSignInView({
  activeSection,
  apiBaseUrl,
  compact = false,
}: {
  activeSection: CloudWorkspaceSection;
  apiBaseUrl: string | null;
  compact?: boolean;
}) {
  const { t } = useLocalization();
  const auth = useCloudAuthController({
    cloudApiBaseUrl: apiBaseUrl,
  });

  if (compact) return <DesktopCloudSignInCta
    signingIn={auth.signingIn} error={auth.error} onSignIn={auth.startSignIn} />;

  return (
    <CloudActivationHero
      activeSection={activeSection}
      className="desktop-cloud-sign-in-entry"
      ariaLabel={t("cloud.auth.signInToCloud")}
      action={(
        <CloudAuthCard
          signingIn={auth.signingIn}
          error={auth.error}
          onSignIn={auth.startSignIn}
        />
      )}
    />
  );
}
