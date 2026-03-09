const appVersion = process.env.NEXT_PUBLIC_APP_VERSION || '0.0.0';

function isLocalhost(): boolean {
  if (typeof window === 'undefined') return true;
  const host = window.location.hostname;
  return host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0';
}

export function getEnvironmentLabel(): string {
  const env = isLocalhost() ? 'Local' : 'Cloud';
  return `${env} v${appVersion}`;
}
