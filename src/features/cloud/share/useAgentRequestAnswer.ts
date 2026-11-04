import { useEffect, useRef, useState } from "react";
import type { DesktopCloudSession } from "../../../lib/cloudApi";
import { decideAgentRequest } from "./agentLinks";

/**
 * Answering an Agent that asks to join, wherever the owner meets it: the
 * persistent request card or the Agents dialog's request tile. The answer goes to the
 * server and then whoever lists the Agents hears of it. While it is on its
 * way it cannot be given twice; if it fails it can be given again.
 */
export function useAgentRequestAnswer({ session, apiBaseUrl, onChanged, onDeciding, onFailed }: {
  session: DesktopCloudSession;
  apiBaseUrl: string;
  /** The list that no longer holds the request is what ends the wait. */
  onChanged: () => void;
  onDeciding?: () => void;
  onFailed?: () => void;
}) {
  const [deciding, setDeciding] = useState(false);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const answer = async (requestId: string, decision: "approve" | "reject") => {
    if (inFlight.current) return;
    inFlight.current = true;
    setDeciding(true);
    onDeciding?.();
    try {
      await decideAgentRequest(session, requestId, decision, apiBaseUrl);
      // A late answer cannot refresh a project/account that has already gone away.
      if (!mounted.current) return;
      // The answer stays disabled until the list that no longer holds the request arrives.
      onChanged();
    } catch {
      if (!mounted.current) return;
      inFlight.current = false;
      setDeciding(false);
      onFailed?.();
    }
  };
  return { deciding, answer };
}
