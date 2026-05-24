import { APP_VERSION_LABEL } from './appVersion';

function isLocalhost(): boolean {
  if (typeof window === 'undefined') return true;
  const host = window.location.hostname;
  return host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0';
}

export function getEnvironmentLabel(): string {
  const env = isLocalhost() ? 'Local' : 'Cloud';
  return `${env} ${APP_VERSION_LABEL}`;
}
