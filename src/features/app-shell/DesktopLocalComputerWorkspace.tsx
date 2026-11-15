import { useCallback, useEffect, useState } from "react";
import type { DataNode } from "@puppyone/shared-ui";
import { CloudScreenThumbnail } from "../cloud";
import {
  findLocalComputerForPath,
  LocalComputerScreenView,
  useLocalComputers,
} from "../computer-mode";
import { useComputerModeEnabled } from "../flags";
import {
  DesktopDataWorkspaceSurface,
  type DesktopDataWorkspaceSurfaceProps,
} from "./DesktopDataWorkspaceSurface";

export function DesktopLocalComputerWorkspace({
  surfaceProps,
}: {
  surfaceProps: DesktopDataWorkspaceSurfaceProps;
}) {
  const computerMode = useComputerModeEnabled();
  const {
    computers,
    runtime,
    wakeComputer,
    sleepComputer,
    provisionDesktop,
    connectScreen,
  } = useLocalComputers();
  const computer = computerMode
    ? findLocalComputerForPath(computers, surfaceProps.workspace.path)
    : null;
  const [screenOpen, setScreenOpen] = useState(false);

  useEffect(() => {
    setScreenOpen(false);
  }, [computer?.id, surfaceProps.workspace.path]);

  const onActiveDataPathChange = useCallback(
    (nextPath: string | null, node?: DataNode | null) => {
      setScreenOpen(false);
      return surfaceProps.onActiveDataPathChange(nextPath, node);
    },
    [surfaceProps],
  );

  if (!computer) {
    return <DesktopDataWorkspaceSurface {...surfaceProps} />;
  }

  return (
    <DesktopDataWorkspaceSurface
      {...surfaceProps}
      activeExplorerPath={screenOpen ? null : surfaceProps.activeExplorerPath}
      onActiveDataPathChange={onActiveDataPathChange}
      sidebarCompanion={(
        <>
          {surfaceProps.sidebarCompanion}
          <CloudScreenThumbnail
            active={screenOpen}
            onOpen={() => setScreenOpen((current) => !current)}
          />
        </>
      )}
      providerStateContent={screenOpen ? (
        <LocalComputerScreenView
          computer={computer}
          runtime={runtime}
          connect={connectScreen}
          onWake={wakeComputer}
          onSleep={sleepComputer}
          onProvisionDesktop={provisionDesktop}
        />
      ) : surfaceProps.providerStateContent}
    />
  );
}
