export type DesktopBridge = NonNullable<Window["puppyoneDesktop"]>;

/** Install only the ports exercised by a fixture, while checking their real types. */
export function installDesktopBridge(ports: Partial<DesktopBridge>): void {
  Object.defineProperty(window, "puppyoneDesktop", {
    configurable: true,
    writable: true,
    value: ports,
  });
}
