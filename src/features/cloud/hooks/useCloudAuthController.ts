import { useEffect, useState } from "react";
import { useLocalization } from "@puppyone/localization/react";
import { openCloudApp } from "../../../lib/cloudApi";
import {
  getCachedDesktopCloudAuthState,
  onDesktopCloudAuthError,
  onDesktopCloudAuthStateChanged,
  startDesktopCloudOAuth,
  supportsDesktopCloudOAuth,
} from "../../../lib/cloudSession";
import {
  cloudMessage,
  formatCloudMessage,
  type CloudMessageDescriptor,
} from "../cloudPresentation";

export function useCloudAuthController({
  cloudApiBaseUrl,
}: {
  cloudApiBaseUrl: string | null;
}) {
  const { t } = useLocalization();
  const [signingIn, setSigningIn] = useState(() => (
    getCachedDesktopCloudAuthState()?.status === "signing-in"
  ));
  const [error, setError] = useState<CloudMessageDescriptor | null>(null);

  useEffect(() => {
    return onDesktopCloudAuthError((message) => {
      setSigningIn(false);
      setError(cloudMessage("auth-start-failed", undefined, message));
    });
  }, []);

  useEffect(() => {
    const syncAuthState = (state: ReturnType<typeof getCachedDesktopCloudAuthState>) => {
      if (!state) return;
      if (state.status === "signing-in") {
        setSigningIn(true);
        setError(null);
        return;
      }
      setSigningIn(false);
    };
    syncAuthState(getCachedDesktopCloudAuthState());
    return onDesktopCloudAuthStateChanged(syncAuthState);
  }, []);

  const startCloudLogin = async () => {
    setSigningIn(true);
    setError(null);
    try {
      if (supportsDesktopCloudOAuth()) {
        await startDesktopCloudOAuth(cloudApiBaseUrl);
      } else {
        openCloudApp("/login");
        setSigningIn(false);
      }
    } catch (loginError) {
      setSigningIn(false);
      setError(cloudMessage(
        "auth-start-failed",
        undefined,
        loginError instanceof Error ? loginError.message : undefined,
      ));
    }
  };

  return {
    signingIn,
    error: error ? formatCloudMessage(error, t) : null,
    startSignIn: () => void startCloudLogin(),
  };
}
