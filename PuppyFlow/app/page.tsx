'use client'
import Sidebar from "./components/sidebar/Sidebar";
import Workflow from "./components/workflow/Workflow";
import React from "react";
import { ReactFlowProvider } from '@xyflow/react'
import { NodesPerFlowContextProvider } from "./components/states/NodesPerFlowContext";
import { FlowsPerUserContextProvider, useFlowsPerUserContext } from "./components/states/FlowsPerUserContext";
import BlankWorkspace from "./components/blankworkspace/BlankWorkspace";
import { AppSettingsProvider } from "./components/states/AppSettingsContext";

function ActiveFlowContent() {
  const { selectedFlowId } = useFlowsPerUserContext();
  return selectedFlowId ? <Workflow /> : <BlankWorkspace />;
}

export default function Home() {
  return (
    <div id="home" className="w-screen h-screen flex flex-row bg-[#131313] overflow-hidden">
      <AppSettingsProvider>
        <ReactFlowProvider>
          <FlowsPerUserContextProvider>
            <>
              <Sidebar />
              <NodesPerFlowContextProvider>
                <ActiveFlowContent />
              </NodesPerFlowContextProvider>
            </>
          </FlowsPerUserContextProvider>
        </ReactFlowProvider>
      </AppSettingsProvider>
    </div>
  );
}
