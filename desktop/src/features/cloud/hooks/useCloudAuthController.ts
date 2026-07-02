import { useEffect, useState, type FormEvent } from "react";
import {
  checkCloudEmail,
  openCloudApp,
  type DesktopCloudSession,
} from "../../../lib/cloudApi";
import {
  signInDesktopCloudWithPassword,
  onDesktopCloudAuthError,
  startDesktopCloudOAuth,
  supportsDesktopCloudOAuth,
} from "../../../lib/cloudSession";
import type { CloudAuthView, CloudLoginMethod } from "../model";

export function useCloudAuthController({
  cloudApiBaseUrl,
  accountEmail,
  onSignedIn,
  onRefresh,
}: {
  cloudApiBaseUrl: string | null;
  accountEmail: string | null;
  onSignedIn: (session: DesktopCloudSession) => void;
  onRefresh: () => void | Promise<void>;
}) {
  const [view, setView] = useState<CloudAuthView>("main");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState<CloudLoginMethod | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [signedInEmail, setSignedInEmail] = useState<string | null>(null);
  const effectiveSignedInEmail = signedInEmail ?? accountEmail;

  useEffect(() => {
    return onDesktopCloudAuthError((message) => {
      setLoading(null);
      setMessage(null);
      setError(message);
    });
  }, []);

  const startCloudLogin = async (method: CloudLoginMethod, emailOverride?: string) => {
    const params = new URLSearchParams();
    if (method !== "email") params.set("provider", method);
    const trimmedEmail = emailOverride?.trim();
    if (trimmedEmail) params.set("email", trimmedEmail);

    setLoading(method);
    setError(null);
    try {
      if ((method === "google" || method === "github") && supportsDesktopCloudOAuth()) {
        await startDesktopCloudOAuth(method, cloudApiBaseUrl);
        setMessage("Finish sign-in in your browser. Desktop will connect automatically.");
      } else {
        openCloudApp(`/login${params.size > 0 ? `?${params.toString()}` : ""}`);
      }
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "Unable to start Cloud sign-in");
    } finally {
      window.setTimeout(() => setLoading(null), 1200);
    }
  };

  const handleEmailSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedEmail = email.trim();
    if (!trimmedEmail) return;

    setError(null);
    setMessage(null);
    setLoading("email");

    try {
      const result = await checkCloudEmail(trimmedEmail, cloudApiBaseUrl);
      setView(result.exists ? "signin" : "signup");
    } catch (checkError) {
      setError(checkError instanceof Error ? checkError.message : "Failed to check email");
    } finally {
      setLoading(null);
    }
  };

  const handlePasswordSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) return;

    setError(null);
    setMessage(null);
    setLoading("password");

    try {
      const session = await signInDesktopCloudWithPassword(trimmedEmail, password, cloudApiBaseUrl);
      setMessage(null);
      setPassword("");
      setSignedInEmail(session.user_email || trimmedEmail);
      onSignedIn(session);
      void onRefresh();
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "Sign-in failed");
    } finally {
      setLoading(null);
    }
  };

  const handleSignupContinue = () => {
    void startCloudLogin("email", email);
  };

  const handleBack = () => {
    setView("main");
    setPassword("");
    setError(null);
    setMessage(null);
  };

  return {
    view,
    email,
    password,
    signedInEmail: effectiveSignedInEmail,
    loading,
    error,
    message,
    setEmail,
    setPassword,
    startProviderLogin: (method: Exclude<CloudLoginMethod, "email" | "password">) => void startCloudLogin(method),
    handleEmailSubmit,
    handlePasswordSubmit,
    handleSignupContinue,
    handleBack,
  };
}
