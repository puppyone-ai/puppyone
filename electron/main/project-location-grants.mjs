import { randomUUID } from "node:crypto";

/**
 * Keeps renderer-visible paths separate from the authority to create there.
 * Grants are bound to the exact WebContents object and only the latest Browse
 * selection remains valid for a window.
 */
export function createProjectLocationGrantStore({ createId = randomUUID } = {}) {
  const grantBySender = new WeakMap();
  const committedOperationBySender = new WeakMap();

  return Object.freeze({
    issue(sender, canonicalPath) {
      requireSender(sender);
      if (typeof canonicalPath !== "string" || !canonicalPath.trim()) {
        throw new Error("A canonical project location is required.");
      }
      const grant = Object.freeze({
        grantId: createId(),
        path: canonicalPath,
      });
      grantBySender.set(sender, grant);
      committedOperationBySender.delete(sender);
      return grant;
    },

    resolve(sender, grantId, operationId = null) {
      requireSender(sender);
      const grant = grantBySender.get(sender);
      if (typeof grantId !== "string" || !grantId || grant?.grantId !== grantId) {
        throw new Error("Choose a project location before creating the project.");
      }
      const committedOperation = committedOperationBySender.get(sender);
      if (committedOperation && committedOperation !== operationId) {
        throw new Error("Choose a new project location grant for a different creation operation.");
      }
      return grant.path;
    },

    bindCommittedOperation(sender, grantId, operationId) {
      requireSender(sender);
      const grant = grantBySender.get(sender);
      if (grant?.grantId !== grantId || typeof operationId !== "string" || !operationId) {
        throw new Error("A valid project location grant and operation are required.");
      }
      const committedOperation = committedOperationBySender.get(sender);
      if (committedOperation && committedOperation !== operationId) {
        throw new Error("This location grant has already committed a different operation.");
      }
      committedOperationBySender.set(sender, operationId);
    },

    revoke(sender, grantId) {
      requireSender(sender);
      const grant = grantBySender.get(sender);
      if (!grant || grant.grantId !== grantId) return false;
      grantBySender.delete(sender);
      committedOperationBySender.delete(sender);
      return true;
    },
  });
}

function requireSender(sender) {
  if ((typeof sender !== "object" && typeof sender !== "function") || sender === null) {
    throw new Error("No active window is available for this project location.");
  }
}
