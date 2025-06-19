import React, { useState, useRef, useEffect } from 'react'
import ReactDOM from 'react-dom'
import { useServers } from '../states/UserServersContext'
import { useServerOperations } from '../hooks/useServerMnagement'
import { Transition } from '@headlessui/react'
import { Fragment } from 'react'

type DeployedServiceOperationMenuProps = {
    serviceId: string,
    serviceType: 'api' | 'chatbot',
    workspaceName: string,
    show: boolean,
    handleOperationMenuHide: () => void,
    buttonRef: React.RefObject<HTMLButtonElement>
}

function DeployedServiceOperationMenu({
    serviceId, 
    serviceType, 
    workspaceName,
    show, 
    handleOperationMenuHide, 
    buttonRef
}: DeployedServiceOperationMenuProps) {

    const { removeApiService, removeChatbotService } = useServers()
    const { deleteApiService, deleteChatbotService } = useServerOperations()
    const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 })

    useEffect(() => {
        if (show && buttonRef.current) {
            const rect = buttonRef.current.getBoundingClientRect();
            setMenuPosition({
                top: rect.top-4,
                left: rect.right+10
            });
        }
    }, [show, buttonRef]);

    const handleDelete = async () => {
        try {
            // 先调用服务器删除API
            if (serviceType === 'api') {
                await deleteApiService(serviceId);
                removeApiService(serviceId);
            } else {
                await deleteChatbotService(serviceId); 
                removeChatbotService(serviceId);
            }
            
            console.log(`✅ ${serviceType} service deleted successfully:`, serviceId);
            handleOperationMenuHide();
        } catch (error) {
            console.error(`Error deleting ${serviceType} service:`, error);
        }
    }

    return (
        <>
            {ReactDOM.createPortal(
                <Transition
                    show={show}
                    as={Fragment}
                    enter="transition ease-out duration-100"
                    enterFrom="transform opacity-0 translate-y-[-10px]"
                    enterTo="transform opacity-100 translate-y-0"
                    leave="transition ease-in duration-75"
                    leaveFrom="transform opacity-100 translate-y-0"
                    leaveTo="transform opacity-0 translate-y-[-10px]"
                >
                    <ul 
                        className='w-[128px] bg-[#252525] p-[8px] border-[1px] border-[#404040] rounded-[8px] gap-[4px] flex flex-col fixed z-[2000000]'
                        style={{ top: `${menuPosition.top}px`, left: `${menuPosition.left}px` }}
                    >
                        <li className='w-full'>
                            <button 
                                className='px-[0px] rounded-[4px] bg-inherit hover:bg-[#3E3E41] w-full h-[26px] flex justify-start items-center text-[#F44336] hover:text-[#FF6B64] font-plus-jakarta-sans text-[12px] font-[400] tracking-[0.5px] cursor-pointer whitespace-nowrap gap-[8px]'
                                onClick={(e) => {
                                    e.stopPropagation()
                                    e.preventDefault()
                                    handleDelete()
                                }}
                            >
                                <div className='flex justify-center items-center'>
                                    <svg width="26" height="26" viewBox="0 0 26 26" fill="none" xmlns="http://www.w3.org/2000/svg">
                                        <path d="M19 7L7 19" stroke="#F44336" strokeWidth="2"/>
                                        <path d="M19 19L7 7" stroke="#F44336" strokeWidth="2"/>
                                    </svg>
                                </div>
                                Delete
                            </button>
                        </li>
                    </ul>
                </Transition>,
                document.body
            )}
        </>
    )
}

export default DeployedServiceOperationMenu 