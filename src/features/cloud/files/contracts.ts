/** Wire contracts of the live Cloud workbench file API. */
export type CloudEntry = {
  path: string;
  name: string;
  type: string;
  mime_type?: string | null;
  size_bytes?: number | null;
  children_count?: number | null;
  exists?: boolean;
};

export function statusOf(error: unknown): number {
  return error && typeof error === "object" && "status" in error ? Number(error.status) : 0;
}

/** A sandbox Feature as the backend catalog resolves it for one workspace. */
export type CloudSandboxFeature = { id: string; surface: string | null; enabled: boolean;
  /** Wire format of a streamed surface; the client picks its viewer by it. */
  transport?: string | null;
  /** Whether the bound computer's image ships it. */
  installed?: boolean;
  reason: "not_installed" | "disabled" | "not_entitled" | "user_disabled" | "requires" | null;
  /** Reported for layout before the machine provides it; nothing runs behind it. */
  preview?: boolean };

/** The owner's choices for this project's Cloud Computer. */
export type CloudSandboxSettings = { desktop?: boolean; screen_stream?: boolean };

/** The workspace's sandbox Profile and Features; servers before Profiles omit it.
 * `next_profile` differs from `profile` when the owner changed the install
 * choice, which applies when the next computer is created. */
export type CloudSandbox = { profile: string | null; next_profile: string | null;
  settings: CloudSandboxSettings; features: CloudSandboxFeature[] };

/** A one-time screen connection: the WebSocket presents the ticket as a subprotocol. */
export type CloudScreenSession = { url: string; protocols: string[]; transport: string };

/** A Cloud workspace row as the workbench API reports it. */
export type CloudWorkbench = { id: string; project_id: string; generation: string; state: string; target_ref: string;
  operation?: { pending: boolean; phase: string | null; deadline: string | null; error: string | null; retryable: boolean };
  sandbox?: CloudSandbox };
