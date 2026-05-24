import packageJson from '../package.json';

const packageVersion = (packageJson as { version?: string }).version;

export const APP_VERSION =
  packageVersion || process.env.NEXT_PUBLIC_APP_VERSION || '0.0.0';

export const APP_VERSION_LABEL = `v${APP_VERSION}`;
