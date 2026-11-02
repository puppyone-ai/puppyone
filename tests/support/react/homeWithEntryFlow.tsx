import React, { type ComponentProps } from "react";
import { MinimalOnboarding, type MinimalOnboardingProps } from "../../../src/components/MinimalOnboarding";
import { ProjectEntryFlow, useProjectEntryFlow } from "../../../src/features/app-shell/ProjectEntryFlow";

type FlowProps = ComponentProps<typeof ProjectEntryFlow>;

export type HomeWithEntryFlowProps =
  & Omit<MinimalOnboardingProps, "projectEntryController" | "canCreateProject" | "canImport">
  & Partial<Pick<MinimalOnboardingProps, "projectEntryController">>
  & {
    onChooseProjectLocation?: FlowProps["onChooseLocation"];
    onDefaultProjectLocation?: FlowProps["onDefaultLocation"];
    onCreateProject?: FlowProps["onCreateProject"];
    onImportSource?: FlowProps["onImportSource"];
    onConnectImportSource?: FlowProps["onConnectSource"];
    onListImportResources?: FlowProps["onListResources"];
    onCancelImportSource?: FlowProps["onCancelImport"];
    onImportSourceProgress?: FlowProps["onImportProgress"];
  };

/** The Homepage wired to its entry flow as the window wires it. A given controller stands for a window's. */
export function HomeWithEntryFlow({
  projectEntryController,
  onChooseProjectLocation,
  onDefaultProjectLocation,
  onCreateProject,
  onImportSource,
  onConnectImportSource,
  onListImportResources,
  onCancelImportSource,
  onImportSourceProgress,
  ...home
}: HomeWithEntryFlowProps) {
  const ownFlow = useProjectEntryFlow();
  const controller = projectEntryController ?? ownFlow;
  return (
    <>
      <MinimalOnboarding
        {...home}
        projectEntryController={controller}
        canCreateProject={Boolean(onCreateProject && onChooseProjectLocation)}
        canImport={Boolean(onImportSource)}
      />
      {!projectEntryController && (
        <ProjectEntryFlow
          controller={controller}
          onOpenFolder={() => void home.onChooseWorkspace()}
          onChooseLocation={onChooseProjectLocation}
          onDefaultLocation={onDefaultProjectLocation}
          onCreateProject={onCreateProject}
          onImportSource={onImportSource}
          onConnectSource={onConnectImportSource}
          onListResources={onListImportResources}
          onCancelImport={onCancelImportSource}
          onImportProgress={onImportSourceProgress}
        />
      )}
    </>
  );
}
