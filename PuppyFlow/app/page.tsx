'use client'
import Sidebar from "./components/sidebar/Sidebar";
import Workflow from "./components/workflow/Workflow";
import React from "react";
import { ReactFlowProvider } from '@xyflow/react'
import { NodesPerFlowContextProvider } from "./components/states/NodesPerFlowContext";
import { FlowsPerUserContextProvider } from "./components/states/FlowsPerUserContext";
export default function Home() {
  return (
    
<div id="home" className="w-screen h-screen flex flex-row bg-[#131313] overflow-hidden">
          
      <ReactFlowProvider>
          <FlowsPerUserContextProvider>
            <>
              <Sidebar />
              <NodesPerFlowContextProvider>
                <Workflow />
              </NodesPerFlowContextProvider>
            </>
          </FlowsPerUserContextProvider>
        </ReactFlowProvider>
         
   </div>
  );
}
