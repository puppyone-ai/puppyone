import { useEffect, useRef, useState } from "react";
import type { DesktopCloudSession } from "../../../lib/cloudApi";
import { useHostCatalog } from "../data/useHostCatalog";
import { HostFolderSharingDialog } from "./HostFolderSharingDialog";

/** `opened`: the source was just created and opened here, so it is awaited, not opened
 * again, and finishing stays in the project instead of returning Home. */
type Intent = Readonly<{ path: string; authority: string; sequence: number; opened?: boolean }>;

/** A Home gesture is not a filesystem grant. Open the exact source through the
 * existing navigator before offering the existing, Main-authorized sharing flow. */
export function useHomepageFolderSharing({ enabled, session, apiBase, workspacePath, workspaceName, openProject, returnHome }: {
  enabled: boolean; session: DesktopCloudSession | null; apiBase: string;
  workspacePath: string | null; workspaceName: string;
  openProject: (path: string) => Promise<void>; returnHome: () => Promise<void>;
}) {
  const authority = enabled && session ? JSON.stringify([apiBase, session.user_id, session.session_generation]) : null;
  const current = useRef({ authority, workspacePath, returnHome });
  current.current = { authority, workspacePath, returnHome };
  const sequence = useRef(0);
  const [candidate, setCandidate] = useState<Intent | null>(null);
  const [ready, setReady] = useState<Intent | null>(null);
  useEffect(() => {
    if (!candidate) return;
    const current = candidate.sequence === sequence.current && candidate.authority === authority;
    // A project just created may not be this window's project yet; it is waited for.
    if (current && candidate.opened && candidate.path !== workspacePath) return;
    setCandidate(null);
    if (current && candidate.path === workspacePath) setReady(candidate);
  }, [candidate, authority, workspacePath]);
  useEffect(() => {
    if (ready && (ready.authority !== authority || ready.path !== workspacePath)) {
      sequence.current++;
      setReady(null);
    }
  }, [ready, authority, workspacePath]);
  useEffect(() => () => { sequence.current++; }, []);

  const request = async (path: string, { opened = false }: { opened?: boolean } = {}) => {
    if (!authority || !path) return;
    const attempt = ++sequence.current;
    setCandidate(null);
    setReady(null);
    if (!opened) await openProject(path);
    if (attempt === sequence.current && current.current.authority === authority) setCandidate({ path, authority, sequence: attempt, opened });
  };
  const close = () => {
    if (!ready || ready.sequence !== sequence.current) return;
    sequence.current++;
    setReady(null);
    if (!ready.opened && ready.authority === current.current.authority && ready.path === current.current.workspacePath) {
      void current.current.returnHome();
    }
  };
  const valid = ready && ready.authority === authority && ready.path === workspacePath;
  return { authority, request: authority ? request : undefined,
    dialog: valid && session ? <SharingSurface key={`${ready.authority}:${ready.path}`} session={session}
      path={ready.path} name={workspaceName} onClose={close} /> : null };
}

function SharingSurface({ session, path, name, onClose }: {
  session: DesktopCloudSession; path: string; name: string; onClose: () => void;
}) {
  const catalog = useHostCatalog(session);
  return <HostFolderSharingDialog catalog={catalog} target={{ kind: "share", rootPath: path, name }} onClose={onClose} />;
}
