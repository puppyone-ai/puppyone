import { getSafeMarkdownHref } from "../policy/markdownUrlPolicy";
import type { CapabilityPrincipal } from "../security/capabilityPrincipal";

export type LinkIntent =
  | { kind: "internal"; path: string }
  | { kind: "external"; href: string }
  | { kind: "denied"; reason: string };

export type LinkBrokerResult =
  | { action: "navigate-internal"; path: string }
  | { action: "open-external"; href: string }
  | { action: "confirm-external"; href: string }
  | { action: "deny"; reason: string };

export type LinkBrokerOptions = {
  resolveInternal?: (documentPath: string, href: string) => string | null;
  requireExternalConfirmation?: boolean;
};

/**
 * Converts a typed link intent into controlled navigation. Adapters never open
 * ambient browser windows from raw href attributes.
 */
export function createLinkBroker(options: LinkBrokerOptions = {}) {
  return {
    resolve(
      principal: CapabilityPrincipal,
      href: string,
    ): LinkBrokerResult {
      if (!href.trim()) return { action: "deny", reason: "empty-href" };
      const canonical = getSafeMarkdownHref(href);
      if (!canonical) return { action: "deny", reason: "unsafe-protocol" };

      if (!/^[a-z][a-z0-9+.-]*:/i.test(canonical)) {
        const internal = options.resolveInternal
          ? options.resolveInternal(principal.documentPath, canonical)
          : canonical;
        return internal
          ? { action: "navigate-internal", path: internal }
          : { action: "deny", reason: "unresolved-internal" };
      }

      if (/^https?:/i.test(canonical) || /^mailto:/i.test(canonical)) {
        if (options.requireExternalConfirmation) {
          return { action: "confirm-external", href: canonical };
        }
        return { action: "open-external", href: canonical };
      }

      return { action: "deny", reason: "unresolved" };
    },
  };
}

export type LinkBroker = ReturnType<typeof createLinkBroker>;
