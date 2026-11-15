import { useCallback, useEffect, useRef, useState } from "react";
import type { DataNode } from "@puppyone/shared-ui";
import type { LocalComputerStatus } from "../../../shared/local-computers/types";
import {
  ComputerScreenSidebarEntry,
  ComputerScreenStage,
  type ComputerScreenPower,
} from "../cloud";
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

function resolveLocalComputerPower(status: LocalComputerStatus): ComputerScreenPower {
  if (status === "asleep" || status === "stopped") return "asleep";
  if (status === "provisioning") return "provisioning";
  if (status === "error") return "inactive";
  return "running";
}

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
  const [pipHidden, setPipHidden] = useState(false);
  const [streamActive, setStreamActive] = useState(false);
  const [waking, setWaking] = useState(false);

  useEffect(() => {
    setScreenOpen(false);
    setPipHidden(false);
    setStreamActive(false);
  }, [computer?.id, surfaceProps.workspace.path]);

  const previousDocumentPath = useRef(surfaceProps.activeDocumentPath);
  useEffect(() => {
    if (previousDocumentPath.current !== surfaceProps.activeDocumentPath) {
      previousDocumentPath.current = surfaceProps.activeDocumentPath;
      if (surfaceProps.activeDocumentPath) setScreenOpen(false);
    }
  }, [surfaceProps.activeDocumentPath]);

  const onActiveDataPathChange = useCallback(
    (nextPath: string | null, node?: DataNode | null) => {
      setScreenOpen(false);
      return surfaceProps.onActiveDataPathChange(nextPath, node);
    },
    [surfaceProps],
  );

  const openScreen = useCallback(() => {
    setPipHidden(false);
    setScreenOpen(true);
  }, []);

  const collapseToPip = useCallback(() => {
    setScreenOpen(false);
  }, []);

  if (!computer) {
    return <DesktopDataWorkspaceSurface {...surfaceProps} />;
  }

  const sidebarPower = resolveLocalComputerPower(computer.status);

  return (
    <DesktopDataWorkspaceSurface
      {...surfaceProps}
      activeDocumentPath={screenOpen ? null : surfaceProps.activeDocumentPath}
      activeExplorerPath={screenOpen ? null : surfaceProps.activeExplorerPath}
      onActiveDataPathChange={onActiveDataPathChange}
      sidebarTopCompanion={(
        <ComputerScreenSidebarEntry
          active={screenOpen}
          power={sidebarPower}
          place="device"
          onOpen={openScreen}
          onWake={() => {
            setWaking(true);
            void wakeComputer(computer.id).finally(() => setWaking(false));
          }}
          wakeDisabled={waking}
        />
      )}
      computerScreenOverlay={(
        <ComputerScreenStage
          mode={screenOpen ? "full" : "pip"}
          pipVisible={!pipHidden && streamActive && computer.status === "running"}
          onExpandFromPip={openScreen}
          onHidePip={() => setPipHidden(true)}
          onCollapseToPip={collapseToPip}
        >
          <LocalComputerScreenView
            computer={computer}
            runtime={runtime}
            connect={connectScreen}
            onWake={wakeComputer}
            onSleep={sleepComputer}
            onProvisionDesktop={provisionDesktop}
            mode={screenOpen ? "full" : "pip"}
            onStreamActiveChange={setStreamActive}
          />
        </ComputerScreenStage>
      )}
    />
  );
}
