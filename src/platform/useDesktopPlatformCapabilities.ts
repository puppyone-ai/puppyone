import { useEffect, useState } from "react";
import type { DesktopPlatformCapabilities } from "../types/electron";
import { getDesktopPlatformCapabilitiesSnapshot, readDesktopPlatformCapabilities } from "./desktopPlatformClient";

export function useDesktopPlatformCapabilities(): DesktopPlatformCapabilities | null {
  const [capabilities, setCapabilities] = useState<DesktopPlatformCapabilities | null>(getDesktopPlatformCapabilitiesSnapshot);

  useEffect(() => {
    let active = true;
    void readDesktopPlatformCapabilities().then((value) => {
      if (active) setCapabilities(value);
    });
    return () => {
      active = false;
    };
  }, []);

  return capabilities;
}
