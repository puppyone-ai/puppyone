'use client'
import Sidebar from "./components/sidebar/Sidebar";
import Workflow from "./components/workflow/Workflow";
import React from "react";
import { NodeContextProvider } from "./components/states/NodeContext";
import { ReactFlowProvider } from '@xyflow/react'


export default function Home() {

  return (
    <NodeContextProvider>
      <div id="home" className="w-screen h-screen flex flex-row bg-[#131313] overflow-hidden">
        
       <ReactFlowProvider>
         <Workflow />
       </ReactFlowProvider> 
       
       </div>
      
      
    </NodeContextProvider>
  
  );
}
