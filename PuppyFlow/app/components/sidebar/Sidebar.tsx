import React, { useState, useEffect } from 'react'
import Header from './Header'
import Footer from './Footer'
import FlowElement from './FlowElement'
import FlowOutlineMenu from './FlowOutlineMenu'
import { useFlowsPerUserContext } from '../states/FlowsPerUserContext'

type SidebarFullScreenProps = {
    setFlowFullScreen: React.Dispatch<React.SetStateAction<boolean>>,
}

type SidebarHiddenProps = {
    setFlowFullScreen: React.Dispatch<React.SetStateAction<boolean>>,
}

function SidebarFullScreen({setFlowFullScreen}: SidebarFullScreenProps) {
  const {workspaces} = useFlowsPerUserContext()
  const [flowIdShowOperationMenu, setFlowIdShowOperationMenu] = useState<string | null>(null)

  const handleOperationMenuShow = (flowId: string | null) => {
    if (!flowId) {
      setFlowIdShowOperationMenu(null)
    } else {
      setFlowIdShowOperationMenu(prev => prev === flowId ? null : flowId)
    }
  }

  return (
    <div className="flex-col font-normal px-[8px] py-[16px] w-[240px] h-screen items-start bg-[#252525] flex relative font-plus-jakarta-sans transition-all duration-300 ease-in-out">
      <Header setFlowFullScreen={setFlowFullScreen} />
      <div className="flex flex-col items-start pt-[24px] pb-[10px] relative self-stretch w-full">
        <div className="text-[#5D6065] text-[12px]  font-bold tracking-[0.5px] px-[16px] mt-[12px] mb-[12px] font-plus-jakarta-sans">
          <p>Library</p>
          </div>
        <ul className="flex flex-col gap-[5px] items-start relative w-full ">
          {workspaces.map((workspace) => (
            <FlowElement 
              key={workspace.flowId} 
              FlowId={workspace.flowId} 
              FlowName={workspace.flowTitle}
              handleOperationMenuShow={handleOperationMenuShow}
              flowIdShowOperationMenu={flowIdShowOperationMenu}
            />
          ))}
        </ul>
        <Footer/>
      </div>
    </div>
  )
}

function SidebarHidden({setFlowFullScreen}: SidebarHiddenProps) {
  const [showFlowMenu, setShowFlowMenu] = useState(false);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      
      const FlowOutlineMenuButton = document.getElementById('FlowOutlineMenuButton');
      const FlowOutlineMenuGroups = Array.from(document.getElementsByClassName('FlowOutlineMenuGroup') as HTMLCollection);
      const isOutside = FlowOutlineMenuGroups && !FlowOutlineMenuGroups.some(group => group.contains(event.target as Node));
      
      if (isOutside) {
        setShowFlowMenu(false);
      } else if (FlowOutlineMenuButton && FlowOutlineMenuButton.contains(event.target as Node)) {
        setShowFlowMenu(prev => !prev);
      }
    };

    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  return (
    <div className='w-[64px] h-screen bg-[#252525] flex flex-col items-center pt-[16px] gap-[16px] transition-all duration-300 ease-in-out'>
        <button className='w-[32px] h-[32px] flex items-center justify-center group' onClick={() => setFlowFullScreen(true)}>
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className="group-hover:bg-[#313131] rounded-md">
            <rect width="32" height="32" rx="4" className="fill-transparent group-hover:fill-[#313131]"/>
            <rect x="8.75" y="10.75" width="14.5" height="10.5" rx="1.25" className="stroke-[#CDCDCD] group-hover:stroke-[#FFFFFF]" strokeWidth="1.5"/>
            <path d="M14 11V21" className="stroke-[#CDCDCD] group-hover:stroke-[#FFFFFF]" strokeWidth="1.5"/>
          </svg>
        </button>

        <button className='w-[32px] h-[32px] flex items-center justify-center group'>
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M0 4C0 1.79086 1.79086 0 4 0H28C30.2091 0 32 1.79086 32 4V28C32 30.2091 30.2091 32 28 32H4C1.79086 32 0 30.2091 0 28V4Z" className="fill-transparent group-hover:fill-[#313131]"/>
            <circle cx="16" cy="12" r="3.25" className="stroke-[#D9D9D9] group-hover:stroke-[#FFFFFF]" strokeWidth="1.5"/>
            <path fillRule="evenodd" clipRule="evenodd" d="M19.1353 14.4844C18.8211 14.8803 18.4336 15.2153 17.9933 15.4689C18.8428 16.269 19.544 17.1024 19.8319 17.8132C20.237 18.8134 20.4179 20.2846 20.4765 21.6283C20.49 21.9387 20.4967 22.2327 20.499 22.5002H11.501C11.5033 22.2327 11.51 21.9387 11.5235 21.6283C11.5821 20.2846 11.763 18.8134 12.1681 17.8132C12.456 17.1024 13.1572 16.269 14.0067 15.4689C13.5664 15.2153 13.1789 14.8803 12.8647 14.4844C11.985 15.3276 11.1634 16.298 10.7778 17.2502C9.76491 19.7511 10.0318 24.0002 10.0318 24.0002H21.9682C21.9682 24.0002 22.2351 19.7511 21.2222 17.2502C20.8366 16.298 20.015 15.3276 19.1353 14.4844Z" className="fill-[#D9D9D9] group-hover:fill-[#FFFFFF]"/>
          </svg>
        </button>

        <button id="FlowOutlineMenuButton" className='w-[32px] h-[32px] flex items-center justify-center group FlowOutlineMenuGroup'>
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="32" height="32" rx="4" className="fill-transparent group-hover:fill-[#313131]"/>
            <rect x="9.75" y="9.75" width="8.5" height="8.5" rx="2.25" className="stroke-[#D9D9D9] group-hover:stroke-[#FFFFFF]" strokeWidth="1.5"/>
            <path fillRule="evenodd" clipRule="evenodd" d="M13.1 18.9996C13.5633 21.2818 15.5811 22.9996 18 22.9996C20.7614 22.9996 23 20.761 23 17.9996C23 15.5806 21.2823 13.5629 19 13.0996V14.6445C20.4458 15.0748 21.5 16.4141 21.5 17.9996C21.5 19.9326 19.933 21.4996 18 21.4996C16.4145 21.4996 15.0752 20.4453 14.645 18.9996H13.1Z" className="fill-[#D9D9D9] group-hover:fill-[#FFFFFF]"/>
          </svg>
        </button>

        <FlowOutlineMenu showFlowMenu={showFlowMenu} />
    </div>
  )
}

function Sidebar() {
  const [flowFullScreen, setFlowFullScreen] = useState(true);

  return (
    <div id='workspace-manage-panel' className="relative">
      <div className={`transition-all duration-150 ease-in-out ${flowFullScreen ? 'w-[240px]' : 'w-[64px]'}`}>
        {flowFullScreen ? (
          <SidebarFullScreen setFlowFullScreen={setFlowFullScreen} />
        ) : (
          <SidebarHidden setFlowFullScreen={setFlowFullScreen} />
        )}
      </div>
    </div>
  )
}

export default Sidebar