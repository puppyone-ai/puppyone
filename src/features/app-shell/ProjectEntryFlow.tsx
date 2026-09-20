import { useCallback, useMemo, useState } from "react";
import { OnboardingImportDialog } from "../../components/OnboardingImportDialog";
import { OnboardingProjectEntryDialog } from "../../components/OnboardingProjectEntryDialog";
import type {
  WorkspaceCloneRepositoryRequest,
  WorkspaceCreateProjectRequest,
  WorkspaceCreateProjectResult,
  WorkspaceProjectLocationGrant,
} from "../../types/electron";
import { ProjectEntryLauncherDialog } from "./ProjectEntryLauncherDialog";

export type ProjectEntryFlowStep = "launcher" | "create" | "import" | null;

export type ProjectEntryFlowController = Readonly<{
  step: ProjectEntryFlowStep;
  openLauncher: () => void;
  openCreate: () => void;
  openImport: () => void;
  close: () => void;
}>;

/**
 * One state machine for every way into a local Project. Surfaces may expose
 * different entry affordances, but they must hand off to this controller and
 * render the same flow below.
 */
export function useProjectEntryFlow(): ProjectEntryFlowController {
  const [step, setStep] = useState<ProjectEntryFlowStep>(null);
  const openLauncher = useCallback(() => setStep("launcher"), []);
  const openCreate = useCallback(() => setStep("create"), []);
  const openImport = useCallback(() => setStep("import"), []);
  const close = useCallback(() => setStep(null), []);

  return useMemo(() => ({
    step,
    openLauncher,
    openCreate,
    openImport,
    close,
  }), [close, openCreate, openImport, openLauncher, step]);
}

export type ProjectEntryFlowProps = Readonly<{
  controller: ProjectEntryFlowController;
  onOpenFolder: () => void;
  onDefaultLocation?: () => Promise<WorkspaceProjectLocationGrant | null>;
  onChooseLocation?: () => Promise<WorkspaceProjectLocationGrant | null>;
  onCreateProject?: (
    request: WorkspaceCreateProjectRequest,
  ) => Promise<WorkspaceCreateProjectResult>;
  onImportRepository?: (request: WorkspaceCloneRepositoryRequest) => Promise<boolean>;
}>;

export function ProjectEntryFlow({
  controller,
  onOpenFolder,
  onDefaultLocation,
  onChooseLocation,
  onCreateProject,
  onImportRepository,
}: ProjectEntryFlowProps) {
  if (controller.step === "launcher") {
    return (
      <ProjectEntryLauncherDialog
        canCreateProject={Boolean(onCreateProject && onChooseLocation)}
        canImport={Boolean(onImportRepository)}
        onClose={controller.close}
        onOpenFolder={() => {
          controller.close();
          onOpenFolder();
        }}
        onCreateProject={controller.openCreate}
        onImport={controller.openImport}
      />
    );
  }

  if (controller.step === "create" && onCreateProject && onChooseLocation) {
    return (
      <OnboardingProjectEntryDialog
        onClose={controller.close}
        onDefaultLocation={onDefaultLocation}
        onChooseLocation={onChooseLocation}
        onSubmit={onCreateProject}
      />
    );
  }

  if (controller.step === "import" && onImportRepository) {
    return (
      <OnboardingImportDialog
        onClose={controller.close}
        onDefaultLocation={onDefaultLocation}
        onChooseLocation={onChooseLocation}
        onImportRepository={onImportRepository}
        onOpenFolder={onOpenFolder}
      />
    );
  }

  return null;
}
