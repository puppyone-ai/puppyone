'use client'
import Sidebar from "./components/sidebar/Sidebar";
import Workflow from "./components/workflow/Workflow";
import React from "react";
import { ReactFlowProvider } from '@xyflow/react'
import { NodesPerFlowContextProvider } from "./components/states/NodesPerFlowContext";
import { WorkspacesProvider, useWorkspaces } from "./components/states/UserWorkspacesContext";
import BlankWorkspace from "./components/blankworkspace/BlankWorkspace";
import { AppSettingsProvider } from "./components/states/AppSettingsContext";
import { ServersProvider } from "./components/states/UserServersContext";
import { useDisplaySwitch } from "./components/hooks/useDisplayWorkspcaeSwitching";
import ServerDisplay from "./components/serverDisplay/ServerDisplay";

function ActiveFlowContent() {
  const { showingItem } = useWorkspaces();
  const { currentMode } = useDisplaySwitch();
  
  // 根据显示模式决定渲染什么内容
  if (currentMode === 'workspace') {
    // 如果是工作区模式，使用 ReactFlow 渲染
    return showingItem?.type === 'workspace' ? <Workflow /> : <BlankWorkspace />;
  } else if (currentMode === 'server') {
    // 如果是服务器模式，使用服务器组件渲染
    return <ServerDisplay />;
  } else {
    // 默认显示空白工作区
    return <BlankWorkspace />;
  }
}

function MainApplication() {
  return (
    <div id="home" className="w-screen h-screen flex flex-row bg-[#131313] overflow-hidden">
      <AppSettingsProvider>
        <ReactFlowProvider>
          <WorkspacesProvider>
            <ServersProvider>
              <>
                <Sidebar />

                <NodesPerFlowContextProvider>
                  <ActiveFlowContent />
                </NodesPerFlowContextProvider>
                
              </>
            </ServersProvider>
          </WorkspacesProvider>
        </ReactFlowProvider>
      </AppSettingsProvider>
    </div>
  );
}

export default function Home() {
  return <MainApplication />;
}
