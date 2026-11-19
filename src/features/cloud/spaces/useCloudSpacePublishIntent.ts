import { useEffect, useRef, useState } from "react";

export type CloudSpacePublishTarget = Readonly<{ path: string; organizationId: string; authority: string }>;

/** Navigation is not publication. Consume a drop only after that exact folder
 * opened, under the same account/deployment generation. A failed/superseded open
 * must never leave a delayed intent that fires when the folder is visited later. */
export function useCloudSpacePublishIntent({ authority, workspacePath, openProject, onReady }: {
  authority: string | null; workspacePath: string | null;
  openProject: (path: string) => Promise<void>; onReady: (target: CloudSpacePublishTarget) => void;
}) {
  const current = useRef({ authority, onReady });
  current.current = { authority, onReady };
  const sequence = useRef(0);
  const [candidate, setCandidate] = useState<CloudSpacePublishTarget | null>(null);
  useEffect(() => {
    if (!candidate) return;
    setCandidate(null);
    if (candidate.authority === authority && candidate.path === workspacePath) current.current.onReady(candidate);
  }, [candidate, authority, workspacePath]);
  useEffect(() => () => { sequence.current++; }, []);
  return async (path: string, organizationId: string) => {
    if (!authority || !path || !organizationId) return;
    const request = ++sequence.current;
    setCandidate(null);
    await openProject(path);
    if (request === sequence.current && current.current.authority === authority) setCandidate({ path, organizationId, authority });
  };
}
