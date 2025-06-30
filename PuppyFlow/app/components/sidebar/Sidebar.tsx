import React, { useState, useEffect, useRef } from 'react'
import ReactDOM from 'react-dom'
import Header from './Header'
import AddNewWorkspaceButton from './AddNewWorkspaceButton'
import FlowElement from './FlowElement'
import FlowThumbnailView from './FlowThumbnailView'
import { useWorkspaces } from '../states/UserWorkspacesContext'
import Dashboard from '../userDashBoard/DashBoardNew'
import dynamic from 'next/dynamic'
import DeployedServicesList from './DeployedServicesList'
import DeploymentTypeLogo from './DeploymentTypeLogo'
import { useAppSettings } from '../states/AppSettingsContext'
import { useAllDeployedServices } from '../states/UserServersContext'

type SidebarFullScreenProps = {
  setFlowFullScreen: React.Dispatch<React.SetStateAction<boolean>>,
}

type SidebarHiddenProps = {
  setFlowFullScreen: React.Dispatch<React.SetStateAction<boolean>>,
}

const DialogPortal = dynamic(() =>
  Promise.resolve(({ children, ...props }: { children: React.ReactNode }) => {
    return ReactDOM.createPortal(children, document.body)
  }),
  { ssr: false }
)

function SidebarFullScreen({ setFlowFullScreen }: SidebarFullScreenProps) {
  const { workspaces } = useWorkspaces()
  const { userSubscriptionStatus, isLoadingSubscriptionStatus } = useAppSettings()
  const { apis, chatbots } = useAllDeployedServices()
  const [flowIdShowOperationMenu, setFlowIdShowOperationMenu] = useState<string | null>(null)

  // Check if there are any deployed services
  const hasDeployedServices = apis.length > 0 || chatbots.length > 0

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
      <div className="flex flex-col items-start pb-[8px] relative self-stretch w-full h-full overflow-hidden">

        <div className="w-full text-[#5D6065] text-[11px] font-semibold pt-[24px] pl-[16px] pr-[8px] font-plus-jakarta-sans">
          <div className="mb-[16px] flex items-center gap-2">
            <span>Workpaces</span>
            <div className="h-[1px] flex-grow bg-[#404040]"></div>
          </div>
        </div>
        <ul className="flex flex-col gap-[8px] items-start relative w-full overflow-y-auto max-h-[calc(100vh-320px)]">
          {workspaces.map((workspace) => (
            <FlowElement
              key={workspace.workspace_id}
              FlowId={workspace.workspace_id}
              FlowName={workspace.workspace_name}
              isDirty={workspace.pushToDatabase}
              handleOperationMenuShow={handleOperationMenuShow}
              flowIdShowOperationMenu={flowIdShowOperationMenu}
            />
          ))}
        </ul>
        <AddNewWorkspaceButton />

        {/* Spacer */}
        <div className="flex-grow"></div>
        
        {/* Deployed Services List - moved to bottom and conditionally rendered */}
        {hasDeployedServices && (
          <div className="mt-[8px] relative self-stretch w-full">
            <DeployedServicesList />
          </div>
        )}
        
        {/* 订阅状态显示 - 加载状态 */}
        {isLoadingSubscriptionStatus && (
          <div className="flex items-center justify-center p-2">
            <div className="w-3 h-3 border border-[#404040] border-t-[#8B8B8B] rounded-full animate-spin"></div>
          </div>
        )}
      </div>

      {/* 展开状态底部 - 左对齐：DeploymentTypeLogo 和订阅状态都靠左 */}
      <div className="absolute bottom-[8px] left-[8px] right-[8px] flex items-center gap-2">
        <DeploymentTypeLogo />
        {userSubscriptionStatus && (
          <span className="text-[#8B8B8B] text-[10px] font-medium">
            {userSubscriptionStatus.is_premium ? 'PRO' : 'FREE'}
          </span>
        )}
      </div>
    </div>
  )
}

function SidebarHidden({ setFlowFullScreen }: SidebarHiddenProps) {
  const { userSubscriptionStatus } = useAppSettings()
  const [showFlowMenu, setShowFlowMenu] = useState(false);
  const settingsDialogRef = useRef<HTMLDialogElement>(null)
  const [activeTab, setActiveTab] = useState<'settings' | 'models' | 'billing' | 'usage' | 'servers'>('settings')

  const handleCloseDialog = () => {
    settingsDialogRef.current?.close()
  }

  const handleSettingsClick = () => {
    settingsDialogRef.current?.showModal()
  }

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
    <div className='w-[64px] h-screen bg-[#252525] flex flex-col items-center pt-[16px] gap-[16px] transition-all duration-300 ease-in-out relative'>
      <button className='w-[32px] h-[32px] flex items-center justify-center group transition-all duration-200' onClick={() => setFlowFullScreen(true)}>
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className="group-hover:bg-[#313131] rounded-md">
          <rect width="32" height="32" rx="4" className="fill-transparent group-hover:fill-[#313131]" />
          <rect x="8.75" y="10.75" width="14.5" height="10.5" rx="1.25" className="stroke-[#CDCDCD] group-hover:stroke-[#FFFFFF]" strokeWidth="1.5" />
          <path d="M14 11V21" className="stroke-[#CDCDCD] group-hover:stroke-[#FFFFFF]" strokeWidth="1.5" />
        </svg>
      </button>

      <button className='w-[32px] h-[32px] flex items-center justify-center group transition-all duration-200' onClick={handleSettingsClick}>
        <div className='w-[32px] h-[32px] flex items-center justify-center group'>
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className="group-hover:bg-[#313131] rounded-md">
            <path fillRule="evenodd" clipRule="evenodd" d="M16 13.3333C14.5272 13.3333 13.3333 14.5272 13.3333 16C13.3333 17.4728 14.5272 18.6667 16 18.6667C17.4728 18.6667 18.6667 17.4728 18.6667 16C18.6667 14.5272 17.4728 13.3333 16 13.3333ZM14.6667 16C14.6667 15.2636 15.2636 14.6667 16 14.6667C16.7364 14.6667 17.3333 15.2636 17.3333 16C17.3333 16.7364 16.7364 17.3333 16 17.3333C15.2636 17.3333 14.6667 16.7364 14.6667 16Z" fill="#D9D9D9" className="group-hover:fill-[#FFFFFF]" />
            <path fillRule="evenodd" clipRule="evenodd" d="M15.7278 8C14.7325 8 13.8887 8.73186 13.7479 9.71716L13.6579 10.3474L13.1479 9.9649C12.3517 9.36772 11.2375 9.4469 10.5337 10.1507L10.1488 10.5356C9.445 11.2394 9.36582 12.3536 9.963 13.1498L10.3444 13.6583L9.71716 13.7479C8.73186 13.8887 8 14.7325 8 15.7278V16.2722C8 17.2675 8.73186 18.1113 9.71716 18.2521L10.3457 18.3419L9.9645 18.8502C9.36732 19.6464 9.4465 20.7606 10.1503 21.4644L10.5352 21.8493C11.239 22.5531 12.3532 22.6323 13.1494 22.0351L13.658 21.6536L13.7479 22.2828C13.8887 23.2681 14.7325 24 15.7278 24H16.2722C17.2675 24 18.1113 23.2681 18.2521 22.2828L18.3417 21.6552L18.8483 22.0351C19.6445 22.6323 20.7587 22.5531 21.4625 21.8493L21.8474 21.4644C22.5512 20.7606 22.6304 19.6464 22.0332 18.8502L21.6522 18.3422L22.2828 18.2521C23.2681 18.1113 24 17.2675 24 16.2722V15.7278C24 14.7325 23.2681 13.8887 22.2828 13.7479L21.6535 13.658L22.0347 13.1498C22.6319 12.3535 22.5527 11.2394 21.8489 10.5356L21.464 10.1507C20.7602 9.44688 19.646 9.36769 18.8498 9.96487L18.3419 10.3458L18.2521 9.71716C18.1113 8.73186 17.2675 8 16.2722 8H15.7278ZM15.0679 9.90572C15.1148 9.57729 15.3961 9.33333 15.7278 9.33333H16.2722C16.6039 9.33333 16.8852 9.57729 16.9321 9.90572L17.0966 11.057C17.1319 11.3037 17.3018 11.5101 17.5371 11.5922C17.7057 11.651 17.8699 11.7192 18.0291 11.7962C18.2535 11.9048 18.5199 11.879 18.7193 11.7294L19.6498 11.0315C19.9152 10.8325 20.2866 10.8589 20.5212 11.0935L20.9061 11.4784C21.1407 11.713 21.1671 12.0844 20.968 12.3498L20.2703 13.28C20.1207 13.4796 20.0949 13.7459 20.2036 13.9704C20.2807 14.1298 20.349 14.2942 20.4078 14.4629C20.4899 14.6982 20.6963 14.8681 20.943 14.9034L22.0943 15.0679C22.4227 15.1148 22.6667 15.3961 22.6667 15.7278V16.2722C22.6667 16.6039 22.4227 16.8852 22.0943 16.9321L20.943 17.0966C20.6963 17.1319 20.4899 17.3018 20.4078 17.5371C20.3488 17.7062 20.2804 17.8709 20.2031 18.0306C20.0944 18.2552 20.1201 18.5216 20.2698 18.7212L20.9665 19.6502C21.1656 19.9156 21.1392 20.287 20.9046 20.5216L20.5197 20.9065C20.2851 21.1411 19.9137 21.1675 19.6483 20.9684L18.7185 20.2711C18.519 20.1215 18.2528 20.0957 18.0283 20.2042C17.8693 20.281 17.7054 20.3491 17.5371 20.4078C17.3018 20.4899 17.1319 20.6963 17.0966 20.943L16.9321 22.0943C16.8852 22.4227 16.6039 22.6667 16.2722 22.6667H15.7278C15.3961 22.6667 15.1148 22.4227 15.0679 22.0943L14.9034 20.943C14.8681 20.6963 14.6982 20.4899 14.4629 20.4078C14.2942 20.349 14.1298 20.2807 13.9705 20.2036C13.746 20.095 13.4796 20.1207 13.2801 20.2704L12.3494 20.9684C12.084 21.1675 11.7126 21.1411 11.478 20.9065L11.0931 20.5216C10.8585 20.287 10.8321 19.9156 11.0312 19.6502L11.7293 18.7193C11.8789 18.5198 11.9047 18.2535 11.7961 18.029C11.7192 17.8698 11.651 17.7056 11.5922 17.5371C11.5101 17.3018 11.3037 17.1319 11.057 17.0966L9.90572 16.9321C9.57729 16.8852 9.33333 16.6039 9.33333 16.2722V15.7278C9.33333 15.3961 9.57729 15.1148 9.90572 15.0679L11.057 14.9034C11.3037 14.8681 11.5101 14.6982 11.5922 14.4629C11.6508 14.2947 11.7189 14.1309 11.7956 13.972C11.9041 13.7476 11.8783 13.4814 11.7288 13.2819L11.0297 12.3498C10.8306 12.0844 10.857 11.713 11.0916 11.4784L11.4765 11.0935C11.7111 10.8589 12.0825 10.8325 12.3479 11.0316L13.2792 11.7301C13.4788 11.8797 13.7452 11.9055 13.9697 11.7968C14.1293 11.7195 14.2939 11.6511 14.4629 11.5922C14.6982 11.5101 14.8681 11.3037 14.9034 11.057L15.0679 9.90572Z" fill="#D9D9D9" className="group-hover:fill-[#FFFFFF]" />
          </svg>
        </div>
      </button>

      <button id="FlowOutlineMenuButton" className='w-[32px] h-[32px] flex items-center justify-center group FlowOutlineMenuGroup transition-all duration-200'>
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className='group-hover:bg-[#313131] rounded-md'>
          <rect width="32" height="32" rx="4" className="fill-transparent group-hover:fill-[#313131]" />
          <rect x="9.75" y="9.75" width="8.5" height="8.5" rx="2.25" className="stroke-[#D9D9D9] group-hover:stroke-[#FFFFFF]" strokeWidth="1.5" />
          <path fillRule="evenodd" clipRule="evenodd" d="M13.1 18.9996C13.5633 21.2818 15.5811 22.9996 18 22.9996C20.7614 22.9996 23 20.761 23 17.9996C23 15.5806 21.2823 13.5629 19 13.0996V14.6445C20.4458 15.0748 21.5 16.4141 21.5 17.9996C21.5 19.9326 19.933 21.4996 18 21.4996C16.4145 21.4996 15.0752 20.4453 14.645 18.9996H13.1Z" className="fill-[#D9D9D9] group-hover:fill-[#FFFFFF]" />
        </svg>
      </button>

      <FlowThumbnailView showFlowMenu={showFlowMenu} />

      {/* Spacer */}
      <div className="flex-grow"></div>

      {/* 收缩状态底部 - 上下排版：订阅状态在上，DeploymentTypeLogo 在下 */}
      <div className="absolute bottom-[8px] flex flex-col items-center gap-1">
        {/* 订阅状态 */}
        {userSubscriptionStatus && (
          <span className="text-[#8B8B8B] text-[10px] font-medium">
            {userSubscriptionStatus.is_premium ? 'PRO' : 'FREE'}
          </span>
        )}
        {/* Deployment Type Logo */}
        <DeploymentTypeLogo />
      </div>

      <DialogPortal>
        <dialog
          ref={settingsDialogRef}
          className="bg-[#2A2A2A] rounded-lg shadow-2xl border border-[#404040] pt-[32px] pb-[16px] px-[16px] w-[800px] backdrop-blur-sm fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2"
        >
          <Dashboard
            activeTab={activeTab}
            onTabChange={setActiveTab}
            onClose={handleCloseDialog}
          />
        </dialog>
      </DialogPortal>
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