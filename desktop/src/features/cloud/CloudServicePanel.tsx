import { Check, Cloud, RefreshCw, Server, SquareTerminal, Users } from "lucide-react";
import type { FormEvent, ReactNode } from "react";
import type { CloudAuthView, CloudLoginFeature, CloudLoginMethod } from "./model";
import type { CloudServicePanelProps } from "./types";
import { useCloudAuthController } from "./hooks/useCloudAuthController";
import { resolveCloudEnvironment } from "./environment";

export function CloudServicePanel({
  open,
  status,
  accountEmail,
  loading,
  error,
  onClose,
  onRefresh,
  onSignedIn,
  onEnterCloud,
  onOpenGitSettings,
}: CloudServicePanelProps) {
  const cloudEnvironment = resolveCloudEnvironment({ status });
  const cloudRemote = cloudEnvironment.cloudRemote;
  const cloudApiBaseUrl = cloudEnvironment.apiBaseUrl;
  const auth = useCloudAuthController({
    cloudApiBaseUrl,
    accountEmail,
    onSignedIn,
    onRefresh,
  });

  if (!open) return null;

  const hosted = Boolean(cloudRemote);
  const signedInEmail = auth.signedInEmail;
  const effectiveAuthView: CloudAuthView = !hosted && signedInEmail ? "signedIn" : auth.view;
  const showHostedCard = Boolean(hosted && signedInEmail);
  const statusBadge = error
    ? "Check failed"
    : loading && !status
      ? "Checking"
      : showHostedCard
        ? "Hosted"
        : null;
  const statusTitle = showHostedCard ? "Workspace already connected." : "Sign in to continue.";
  const cloudFeatures: CloudLoginFeature[] = [
    {
      label: "Team collaboration",
      icon: Users,
    },
    {
      label: "Cloud backup",
      icon: Cloud,
    },
    {
      label: "MCP / CLI supported",
      icon: SquareTerminal,
    },
    {
      label: "24/7 online",
      icon: Server,
    },
  ];

  return (
    <div className="desktop-cloud-panel-layer">
      <button className="desktop-cloud-panel-scrim" type="button" aria-label="Close Cloud panel" onClick={onClose} />
      <section className={`desktop-cloud-panel ${showHostedCard ? "hosted" : "locked"}`} role="dialog" aria-modal="true" aria-label="Cloud Native Service">
        <div className="desktop-cloud-panel-body">
          <section className="desktop-cloud-login-layout">
            <div className="desktop-cloud-login-copy">
              <div className="desktop-cloud-login-copy-content">
                <div className="desktop-cloud-login-identity">
                  <div className="desktop-cloud-login-logo" aria-hidden="true">
                    <CloudProductMark />
                  </div>
                  <div className="desktop-cloud-login-copy-stack">
                    <h3>Get Puppyone Cloud</h3>
                    {statusBadge && (
                      <span className={`desktop-cloud-login-badge ${showHostedCard ? "hosted" : "locked"}`}>{statusBadge}</span>
                    )}
                    <p>Back up this workspace. Keep agents, teammates, MCP, and CLI connected.</p>
                  </div>
                </div>
                <div className="desktop-cloud-login-feature-list">
                  {cloudFeatures.map((feature) => (
                    <CloudLoginFeatureRow key={feature.label} feature={feature} />
                  ))}
                </div>
              </div>
            </div>
            <aside className="desktop-cloud-login-card">
              {showHostedCard ? (
                <CloudHostedLoginCard
                  loading={loading}
                  statusTitle={statusTitle}
                  error={error}
                  onOpenCloud={onEnterCloud}
                  onRefresh={onRefresh}
                  onOpenGitSettings={onOpenGitSettings}
                />
              ) : (
                <CloudAuthCard
                  view={effectiveAuthView}
                  email={auth.email}
                  password={auth.password}
                  signedInEmail={signedInEmail}
                  loading={auth.loading}
                  error={auth.error}
                  message={auth.message}
                  onEmailChange={auth.setEmail}
                  onPasswordChange={auth.setPassword}
                  onProviderLogin={auth.startProviderLogin}
                  onEmailSubmit={auth.handleEmailSubmit}
                  onPasswordSubmit={auth.handlePasswordSubmit}
                  onSignupContinue={auth.handleSignupContinue}
                  onOpenCloud={onEnterCloud}
                  onRefresh={onRefresh}
                  onBack={auth.handleBack}
                />
              )}
            </aside>
          </section>
        </div>
      </section>
    </div>
  );
}

export function CloudAuthCard({
  view,
  email,
  password,
  signedInEmail,
  loading,
  error,
  message,
  onEmailChange,
  onPasswordChange,
  onProviderLogin,
  onEmailSubmit,
  onPasswordSubmit,
  onSignupContinue,
  onOpenCloud,
  onRefresh,
  onBack,
}: {
  view: CloudAuthView;
  email: string;
  password: string;
  signedInEmail: string | null;
  loading: CloudLoginMethod | null;
  error: string | null;
  message: string | null;
  onEmailChange: (email: string) => void;
  onPasswordChange: (password: string) => void;
  onProviderLogin: (method: Exclude<CloudLoginMethod, "email" | "password">) => void;
  onEmailSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onPasswordSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onSignupContinue: () => void;
  onOpenCloud: () => void;
  onRefresh: () => void;
  onBack: () => void;
}) {
  const disabled = Boolean(loading);

  return (
    <div className="desktop-cloud-auth-card">
      {view !== "main" && view !== "signedIn" && (
        <button className="desktop-cloud-auth-back" type="button" disabled={disabled} onClick={onBack}>
          All sign in options
        </button>
      )}

      {view === "main" ? (
        <>
          <div className="desktop-cloud-auth-provider-list">
            <CloudProviderButton
              icon={<CloudGoogleIcon />}
              label="Continue with Google"
              loadingLabel="Opening..."
              isLoading={loading === "google"}
              disabled={disabled}
              onClick={() => onProviderLogin("google")}
            />
            <CloudProviderButton
              icon={<CloudGithubIcon />}
              label="Continue with GitHub"
              loadingLabel="Opening..."
              isLoading={loading === "github"}
              disabled={disabled}
              onClick={() => onProviderLogin("github")}
            />
          </div>

          <CloudAuthDivider />

          <form className="desktop-cloud-auth-form" onSubmit={onEmailSubmit}>
            <label htmlFor="desktop-cloud-login-email">Email</label>
            <input
              id="desktop-cloud-login-email"
              type="email"
              value={email}
              placeholder="Your email address"
              required
              disabled={disabled}
              onChange={(event) => onEmailChange(event.target.value)}
            />
            <button className="desktop-cloud-auth-submit" type="submit" disabled={disabled}>
              {loading === "email" && <CloudAuthDots />}
              <span>{loading === "email" ? "Checking..." : "Continue"}</span>
            </button>
          </form>
        </>
      ) : view === "signin" ? (
        <>
          <div className="desktop-cloud-auth-heading">
            <h3>Welcome back</h3>
            <p>{email}</p>
          </div>
          <form className="desktop-cloud-auth-form" onSubmit={onPasswordSubmit}>
            <label htmlFor="desktop-cloud-login-password">Password</label>
            <input
              id="desktop-cloud-login-password"
              type="password"
              value={password}
              placeholder="Enter your password"
              required
              minLength={6}
              disabled={disabled}
              autoFocus
              onChange={(event) => onPasswordChange(event.target.value)}
            />
            <button className="desktop-cloud-auth-submit" type="submit" disabled={disabled}>
              {loading === "password" && <CloudAuthDots />}
              <span>{loading === "password" ? "Signing in..." : "Sign In"}</span>
            </button>
          </form>
        </>
      ) : view === "signup" ? (
        <>
          <div className="desktop-cloud-auth-heading">
            <h3>Create your account</h3>
            <p>{email}</p>
          </div>
          <button className="desktop-cloud-auth-submit" type="button" disabled={disabled} onClick={onSignupContinue}>
            {loading === "email" && <CloudAuthDots />}
            <span>{loading === "email" ? "Opening..." : "Continue in PuppyOne Cloud"}</span>
          </button>
        </>
      ) : (
        <>
          <div className="desktop-cloud-auth-heading">
            <h3>Signed in</h3>
            <p>{signedInEmail ?? email}</p>
          </div>
          <div className="desktop-cloud-auth-state">
            <span>
              <Check size={14} />
            </span>
            <div>
              <strong>Puppyone account connected</strong>
              <p>Back up this workspace to enable Cloud services here.</p>
            </div>
          </div>
          <button className="desktop-cloud-auth-submit" type="button" onClick={onOpenCloud}>
            Enter Cloud version
          </button>
          <button className="desktop-cloud-auth-secondary" type="button" onClick={onRefresh}>
            <RefreshCw size={14} />
            <span>Check workspace status</span>
          </button>
        </>
      )}

      <CloudAuthFeedback error={error} message={message} />

      {view !== "signedIn" && (
        <p className="desktop-cloud-auth-terms">By continuing you agree to our Terms and Privacy Policy.</p>
      )}
    </div>
  );
}

export function CloudHostedLoginCard({
  loading,
  statusTitle,
  error,
  onOpenCloud,
  onRefresh,
  onOpenGitSettings,
}: {
  loading: boolean;
  statusTitle: string;
  error: string | null;
  onOpenCloud: () => void;
  onRefresh: () => void;
  onOpenGitSettings: () => void;
}) {
  return (
    <div className="desktop-cloud-auth-card desktop-cloud-auth-card-hosted">
      <h3>PuppyOne Cloud</h3>
      <p className="desktop-cloud-auth-hosted-copy">{statusTitle}</p>
      <button className="desktop-cloud-auth-submit" type="button" onClick={onOpenCloud}>
        Enter Cloud version
      </button>
      <button className="desktop-cloud-auth-secondary" type="button" onClick={onRefresh}>
        <RefreshCw size={14} className={loading ? "spin" : undefined} />
        <span>Check status</span>
      </button>
      <button className="desktop-cloud-auth-secondary" type="button" onClick={onOpenGitSettings}>
        Git sync details
      </button>
      {error && <p className="desktop-cloud-login-error">{error}</p>}
    </div>
  );
}

export function CloudProviderButton({
  icon,
  label,
  loadingLabel,
  isLoading,
  disabled,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  loadingLabel: string;
  isLoading: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button className="desktop-cloud-provider-button" type="button" disabled={disabled} onClick={onClick}>
      <span className="desktop-cloud-provider-button-icon">{icon}</span>
      <span>{isLoading ? loadingLabel : label}</span>
    </button>
  );
}

export function CloudAuthDivider() {
  return (
    <div className="desktop-cloud-auth-divider">
      <span />
      <small>or</small>
      <span />
    </div>
  );
}

export function CloudAuthFeedback({ error, message }: { error: string | null; message: string | null }) {
  if (!error && !message) return null;

  return (
    <div className="desktop-cloud-auth-feedback">
      {error && <div className="error">{error}</div>}
      {message && <div className="success">{message}</div>}
    </div>
  );
}

export function CloudAuthDots() {
  return (
    <span className="desktop-cloud-auth-dots" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}

export function CloudLoginFeatureRow({ feature }: { feature: CloudLoginFeature }) {
  return (
    <div className="desktop-cloud-login-feature-row">
      <span>
        <Check size={13} />
      </span>
      <div>
        <strong>{feature.label}</strong>
      </div>
    </div>
  );
}

export function CloudProductMark() {
  return (
    <svg className="desktop-cloud-product-mark" viewBox="0 0 160 100" aria-hidden="true" focusable="false">
      <path
        className="desktop-cloud-product-mark-cloud"
        d="M43.8 76.5h72.6c14.4 0 26.1-11.1 26.1-24.8 0-13.6-11.4-24.6-25.6-24.9C111.2 13.8 98.1 5.5 83.5 7.1 67.3 8.8 54.2 21.1 51.2 37.2h-6.8c-15.5 0-27.9 11.1-27.9 24.6 0 9.6 9.3 14.7 27.3 14.7Z"
      />
    </svg>
  );
}

export function CloudGoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 533.5 544.3" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path fill="#4285f4" d="M533.5 278.4c0-17.6-1.6-34.4-4.6-50.4H272v95.3h147c-6.4 34.6-25.8 63.9-55 83.6l89 69.4c51.8-47.7 80.5-118 80.5-198z" />
      <path fill="#34a853" d="M272 544.3c74.7 0 137.5-24.8 183.3-67.4l-89-69.4c-24.7 16.6-56.3 26.3-94.3 26.3-72.5 0-134-49-155.9-114.9l-92 71.6c41.6 82.5 127.1 153.8 247.9 153.8z" />
      <path fill="#fbbc04" d="M116.1 318.9c-10-29.8-10-62.1 0-91.9l-92-71.6C4 211 0 240.9 0 272.4s4 61.4 24.1 116.9l92-70.4z" />
      <path fill="#ea4335" d="M272 107.7c39.7-.6 77.6 14.7 105.8 42.9l77.5-77.5C395.1 24 334.2 0 272 0 151.2 0 65.7 71.3 24.1 155.5l92 71.6C138 161.3 199.5 107.7 272 107.7z" />
    </svg>
  );
}

export function CloudGithubIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <path d="M12 1C6 1 1.5 5.5 1.5 11.5c0 4.6 3 8.5 7.2 9.9.5.1.7-.2.7-.5v-1.9c-2.9.6-3.5-1.2-3.5-1.2-.5-1.2-1.2-1.6-1.2-1.6-1-.7.1-.7.1-.7 1.1.1 1.7 1.1 1.7 1.1 1 1.7 2.6 1.2 3.2.9.1-.7.4-1.2.7-1.5-2.4-.3-4.9-1.2-4.9-5.3 0-1.2.4-2.1 1.1-2.9-.1-.3-.5-1.4.1-2.9 0 0 .9-.3 3 .1 1-.3 2-.4 3.1-.4s2.1.1 3.1.4c2.1-1.4 3-.1 3-.1.6 1.5.2 2.6.1 2.9.7.8 1.1 1.7 1.1 2.9 0 4.1-2.6 5.1-5 5.4.4.3.7 1 .7 2v3c0 .3.2.6.7.5 4.2-1.4 7.2-5.3 7.2-9.9C22.5 5.5 18 1 12 1z" />
    </svg>
  );
}
