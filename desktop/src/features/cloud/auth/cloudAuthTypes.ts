import type { DesktopCloudSession } from "../../../lib/cloudApi";

export type CloudAuthState =
  | { status: "restoring"; apiBaseUrl: string | null }
  | { status: "signed-out"; apiBaseUrl: string | null }
  | { status: "signed-in"; apiBaseUrl: string | null; session: DesktopCloudSession }
  | { status: "wrong-host"; apiBaseUrl: string; session: DesktopCloudSession }
  | { status: "expired"; apiBaseUrl: string | null };

export function getCloudAuthSession(authState: CloudAuthState): DesktopCloudSession | null {
  return authState.status === "signed-in" ? authState.session : null;
}

export function isCloudAuthBlocking(authState: CloudAuthState): boolean {
  return authState.status === "signed-out" || authState.status === "wrong-host" || authState.status === "expired";
}

export function getCloudAuthEmail(authState: CloudAuthState): string | null {
  if (authState.status !== "signed-in" && authState.status !== "wrong-host") return null;
  return authState.session.user_email || null;
}
