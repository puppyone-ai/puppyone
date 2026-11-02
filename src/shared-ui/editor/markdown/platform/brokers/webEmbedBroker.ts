import type { CapabilityPrincipal } from "../security/capabilityPrincipal";

export type WebEmbedRequest = {
  principal: CapabilityPrincipal;
  href: string;
  privacyProfile: "temporary-no-credential";
};

export type WebEmbedBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type WebEmbedCapabilityScope = Pick<
  CapabilityPrincipal,
  | "editorViewId"
  | "workspaceId"
  | "documentPath"
  | "documentRevision"
  | "executionSessionId"
> & {
  purpose: "web-embed";
};

export type WebEmbedSession = {
  id: string;
  href: string;
  state: "blocked" | "click-to-load" | "loading" | "loaded" | "destroyed";
  nativeViewId?: string;
  destroy(): void;
};

export type MarkdownWebEmbedBridge = {
  create(request: {
    href: string;
    bounds?: WebEmbedBounds;
    capability: WebEmbedCapabilityScope;
  }): Promise<{ id: string }>;
  setBounds(request: { id: string; bounds: WebEmbedBounds }): Promise<void>;
  destroy(request: { id: string }): Promise<void>;
};

function getDesktopWebEmbedBridge(): MarkdownWebEmbedBridge | null {
  const desktop = (globalThis as { puppyoneDesktop?: { markdownWebEmbed?: MarkdownWebEmbedBridge } }).puppyoneDesktop;
  return desktop?.markdownWebEmbed ?? null;
}

/**
 * External https embeds are realized by the main process via WebContentsView.
 * Markdown widgets never create authority-bearing browser surfaces directly.
 * Default policy: blocked / click-to-load.
 */
export function createWebEmbedBroker(options: {
  allowAutomaticLoad?: boolean;
} = {}) {
  const sessions = new Map<string, WebEmbedSession>();
  const principals = new Map<string, WebEmbedCapabilityScope>();
  const activations = new Map<string, Promise<WebEmbedSession | null>>();
  let sequence = 0;

  const destroySession = (session: WebEmbedSession) => {
    if (session.state === "destroyed") return;
    session.state = "destroyed";
    const bridge = getDesktopWebEmbedBridge();
    if (session.nativeViewId && bridge) {
      void bridge.destroy({ id: session.nativeViewId }).catch(() => undefined);
    }
    sessions.delete(session.id);
    principals.delete(session.id);
  };

  return {
    create(request: WebEmbedRequest): WebEmbedSession {
      const href = canonicalizeWebEmbedHref(request.href);
      if (
        !href ||
        request.privacyProfile !== "temporary-no-credential" ||
        request.principal.purpose !== "web-embed"
      ) {
        const denied: WebEmbedSession = {
          id: `web-embed-denied:${++sequence}`,
          href: request.href,
          state: "blocked",
          destroy() {
            destroySession(denied);
          },
        };
        sessions.set(denied.id, denied);
        return denied;
      }

      const id = `web-embed:${++sequence}`;
      const session: WebEmbedSession = {
        id,
        href,
        state: options.allowAutomaticLoad ? "loading" : "click-to-load",
        destroy() {
          destroySession(session);
        },
      };
      sessions.set(id, session);
      principals.set(id, {
        editorViewId: request.principal.editorViewId,
        workspaceId: request.principal.workspaceId,
        documentPath: request.principal.documentPath,
        documentRevision: request.principal.documentRevision,
        purpose: "web-embed",
        executionSessionId: request.principal.executionSessionId,
      });

      if (options.allowAutomaticLoad) {
        void this.activate(id);
      }
      return session;
    },

    async activate(sessionId: string, bounds?: WebEmbedBounds): Promise<WebEmbedSession | null> {
      const session = sessions.get(sessionId);
      if (!session || session.state === "destroyed" || session.state === "blocked") return null;
      if (session.state === "loaded") return session;
      const pending = activations.get(sessionId);
      if (pending) return pending;

      const activation = activateSession(session, bounds);
      activations.set(sessionId, activation);
      try {
        return await activation;
      } finally {
        if (activations.get(sessionId) === activation) activations.delete(sessionId);
      }
    },

    async setBounds(sessionId: string, bounds: WebEmbedBounds): Promise<void> {
      const session = sessions.get(sessionId);
      if (!session?.nativeViewId) return;
      const bridge = getDesktopWebEmbedBridge();
      if (!bridge) return;
      await bridge.setBounds({ id: session.nativeViewId, bounds }).catch(() => undefined);
    },

    destroy(sessionId: string) {
      const session = sessions.get(sessionId);
      if (session) destroySession(session);
    },

    destroyStaleRevision(editorViewId: string, currentRevision: string) {
      for (const [id, capability] of Array.from(principals.entries())) {
        if (
          capability.editorViewId === editorViewId &&
          capability.documentRevision !== currentRevision
        ) {
          const session = sessions.get(id);
          if (session) destroySession(session);
        }
      }
    },

    disposeAll() {
      for (const session of Array.from(sessions.values())) destroySession(session);
      sessions.clear();
    },
  };

  async function activateSession(
    session: WebEmbedSession,
    bounds?: WebEmbedBounds,
  ): Promise<WebEmbedSession | null> {
    session.state = "loading";

    const bridge = getDesktopWebEmbedBridge();
    if (!bridge) {
      // Browser/dev without Electron: mark loaded for UI placeholder only.
      session.state = "loaded";
      return session;
    }

    try {
      const capability = principals.get(session.id);
      if (!capability) return null;
      const created = await bridge.create({ href: session.href, bounds, capability });
      const current = sessions.get(session.id);
      if (!current || current.state === "destroyed") {
        await bridge.destroy({ id: created.id }).catch(() => undefined);
        return null;
      }
      current.nativeViewId = created.id;
      current.state = "loaded";
      return current;
    } catch {
      const current = sessions.get(session.id);
      if (current && current.state !== "destroyed") current.state = "click-to-load";
      return current ?? null;
    }
  }
}

export type WebEmbedBroker = ReturnType<typeof createWebEmbedBroker>;

function canonicalizeWebEmbedHref(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || isPrivateWebEmbedHost(url.hostname)) return null;
    return url.href;
  } catch {
    return null;
  }
}

function isPrivateWebEmbedHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host === "::" || host === "::1") return true;
  if (/^f[cd][0-9a-f]{2}:/i.test(host) || /^fe[89ab][0-9a-f]:/i.test(host)) return true;
  const octets = host.split(".");
  if (octets.length !== 4 || octets.some((octet) => !/^\d{1,3}$/.test(octet))) return false;
  const values = octets.map(Number);
  return values.some((part) => part > 255) ||
    values[0] === 0 ||
    values[0] === 10 ||
    values[0] === 127 ||
    (values[0] === 169 && values[1] === 254) ||
    (values[0] === 172 && values[1] >= 16 && values[1] <= 31) ||
    (values[0] === 192 && values[1] === 168);
}
