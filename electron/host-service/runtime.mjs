/**
 * Runs Puppyone Host: the service plus its local control channel. Used by the
 * Electron host mode and, under plain Node, by tests and headless drivers.
 */
import { startControlServer } from "./control.mjs";
import { createHostService } from "./service.mjs";

export async function runHostService({ stateDir, onShutdown = () => {}, logger = console, ...options }) {
  let desktopPeer = null;
  let control = null;
  const service = createHostService({ stateDir, logger, ...options,
    desktop: () => (desktopPeer && !desktopPeer.isClosed() ? desktopPeer : null),
    onStatus: (status) => control?.broadcast("status", status),
    onRevoked: (lost) => control?.broadcast("revoked", lost) });

  let closing = null;
  function close() {
    closing ??= (async () => {
      service.dispose();
      await control?.close();
    })();
    return closing;
  }

  control = await startControlServer({ stateDir, logger,
    handlersFor: (role) => role === "desktop"
      ? { ...service.methods, shutdown: async () => { setTimeout(() => { void close().then(onShutdown); }, 0); return true; } }
      // Other local clients may only observe.
      : { status: service.methods.status },
    onPeer: (peer, role) => { if (role === "desktop") desktopPeer = peer; } });
  await service.start();
  return Object.freeze({ service, control, close });
}
