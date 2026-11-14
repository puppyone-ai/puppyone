import { useLocalization } from "@puppyone/localization";
import { Cloud, ExternalLink } from "lucide-react";
import { useEffect, useState, type CSSProperties } from "react";
import {
  DesktopDialogCloseButton,
  DesktopDialogRoot,
  DesktopDialogSurface,
} from "../../../components/DesktopDialog";
import { DesktopOverlayLayer } from "../../../components/DesktopOverlayPortal";
import { InlineLoading } from "../../../components/loading";
import { OnboardingValueHub } from "../../../components/onboarding/OnboardingValueHub";
import { OnboardingValueForwardScene } from "../../../components/onboarding/OnboardingValueScenes";
import "../../../components/onboarding/onboarding-value-carousel.css";
import {
  onDesktopCloudAuthStateChanged,
  supportsDesktopCloudOAuth,
} from "../../../lib/cloudSession";
import { useCloudAuthController } from "../hooks/useCloudAuthController";
import {
  closeCloudSignInDialog,
  useCloudSignInDialogRequest,
} from "./cloudSignInDialogStore";
import "./cloud-sign-in-dialog.css";

export const CLOUD_SIGN_IN_SLIDES = [
  { id: "cloud", seconds: 4 },
  { id: "share", seconds: 5 },
] as const;

export type CloudSignInSlideIndex = 0 | 1;

const nextCloudSignInSlide = (index: CloudSignInSlideIndex): CloudSignInSlideIndex => (
  ((index + 1) % CLOUD_SIGN_IN_SLIDES.length) as CloudSignInSlideIndex
);

/**
 * Explains what signing in unlocks before opening the browser OAuth flow, reusing
 * first run's hub and link-handoff scenes at dialog scale.
 */
export function CloudSignInDialog({ signedIn = false }: { signedIn?: boolean }) {
  const request = useCloudSignInDialogRequest();

  useEffect(() => {
    if (signedIn && request) closeCloudSignInDialog();
  }, [request, signedIn]);

  useEffect(() => {
    if (!request) return undefined;
    return onDesktopCloudAuthStateChanged((state) => {
      if (state?.status === "authenticated" || state?.status === "offline-authenticated") {
        closeCloudSignInDialog();
      }
    });
  }, [request]);

  if (!request || signedIn) return null;

  return (
    <DesktopOverlayLayer>
      <CloudSignInDialogContent
        key={request.id}
        apiBaseUrl={request.apiBaseUrl}
        onClose={closeCloudSignInDialog}
      />
    </DesktopOverlayLayer>
  );
}

function CloudSignInDialogContent({
  apiBaseUrl,
  onClose,
}: {
  apiBaseUrl: string | null;
  onClose: () => void;
}) {
  const { t } = useLocalization();
  const auth = useCloudAuthController({ cloudApiBaseUrl: apiBaseUrl });
  const [index, setIndex] = useState<CloudSignInSlideIndex>(0);
  const productName = t("cloud.productName");

  const handleSubmit = () => {
    auth.startSignIn();
    if (!supportsDesktopCloudOAuth()) onClose();
  };

  return (
    <DesktopDialogRoot onClose={onClose}>
      <DesktopDialogSurface
        className="cloud-sign-in-dialog"
        ariaLabel={t("cloud.auth.signInToCloud")}
      >
        <DesktopDialogCloseButton
          className="cloud-sign-in-close"
          label={t("cloud.common.close")}
          onClick={onClose}
        />
        <div className="onboarding-value-carousel" data-pause-on-hover="true">
          <div className="onboarding-value-stage" aria-hidden="true">
            <div
              className={`onboarding-value-slide ${index === 0 ? "is-active" : ""}`}
              data-value-slide="cloud"
            >
              <OnboardingValueHub label={productName} />
            </div>
            <div
              className={`onboarding-value-slide ${index === 1 ? "is-active" : ""}`}
              data-value-slide="share"
            >
              <OnboardingValueForwardScene agent="grok-bot" />
            </div>
          </div>
          <div
            className="onboarding-value-dots"
            role="group"
            aria-label={t("cloud.auth.explainer.dots")}
          >
            {CLOUD_SIGN_IN_SLIDES.map((slide, dot) => (
              <button
                key={slide.id}
                type="button"
                className={`onboarding-value-dot ${dot === index ? "is-active" : ""}`}
                aria-label={t(`cloud.auth.explainer.${slide.id}.label`)}
                aria-current={dot === index || undefined}
                onClick={() => setIndex(dot as CloudSignInSlideIndex)}
              >
                {dot === index && (
                  <i
                    key={index}
                    style={{ "--onboarding-slide-seconds": `${slide.seconds}s` } as CSSProperties}
                    onAnimationEnd={(event) => {
                      if (event.target === event.currentTarget) {
                        setIndex(nextCloudSignInSlide(index));
                      }
                    }}
                  />
                )}
              </button>
            ))}
          </div>
        </div>
        <div className="cloud-sign-in-copy">
          <span className="cloud-sign-in-eyebrow">
            <Cloud size={15} strokeWidth={2} aria-hidden="true" />
            {productName}
          </span>
          <div className="cloud-sign-in-moments">
            {CLOUD_SIGN_IN_SLIDES.map((slide, slideIndex) => (
              <div
                key={slide.id}
                className={`cloud-sign-in-moment ${slideIndex === index ? "is-active" : ""}`}
                aria-hidden={slideIndex === index ? undefined : true}
              >
                <h2>{t(`cloud.auth.explainer.${slide.id}.title`)}</h2>
                <p>{t(`cloud.auth.explainer.${slide.id}.body`)}</p>
              </div>
            ))}
          </div>
          <div className="cloud-sign-in-actions">
            <button
              type="button"
              className="cloud-sign-in-primary"
              data-desktop-dialog-initial-focus="true"
              // Stays available while waiting: asking again reopens the browser page.
              onClick={handleSubmit}
            >
              <span>{t("cloud.auth.explainer.submit")}</span>
              <ExternalLink size={14} strokeWidth={1.8} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="cloud-sign-in-later"
              onClick={onClose}
            >
              {t("cloud.auth.explainer.later")}
            </button>
          </div>
          {auth.signingIn && (
            <div className="cloud-sign-in-feedback" role="status">
              <InlineLoading label={t("cloud.home.waitingForSignIn")} size="xs" tone="neutral" />
            </div>
          )}
          {auth.error && (
            <p className="cloud-sign-in-feedback is-error" role="alert">
              {auth.error}
            </p>
          )}
        </div>
      </DesktopDialogSurface>
    </DesktopDialogRoot>
  );
}
