import { useLocalization } from "@puppyone/localization/react";
import type { CloudWorkspaceSection } from "../types";
import { CloudActivationHero } from "../components/CloudActivationHero";
import { CloudAuthCard, CloudProductMark } from "./CloudAuthCard";
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

  if (compact) return <section className="desktop-cloud-workspace-sign-in">
    <CloudProductMark />
    <h3>{t("cloud.auth.signInRequired")}</h3>
    <p>{t("cloud.recovery.localStatePreserved")}</p>
    <CloudAuthCard signingIn={auth.signingIn} error={auth.error} onSignIn={auth.startSignIn} />
  </section>;

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
