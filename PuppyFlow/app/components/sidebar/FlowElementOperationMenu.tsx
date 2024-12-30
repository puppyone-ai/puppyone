import React, { useState, useRef } from 'react'
import ReactDOM from 'react-dom'
import { useFlowsPerUserContext } from '../states/FlowsPerUserContext'

type FlowElementOperationMenuProps = {
    flowId: string,
    show: boolean,
    handleOperationMenuHide: () => void
}

function FlowElementOperationMenu({flowId, show, handleOperationMenuHide}: FlowElementOperationMenuProps) {

    const {removeFlow, editFlowName} = useFlowsPerUserContext()
    // const renameContainerRef = useRef<HTMLDivElement>(null)
    const renameDialogRef = useRef<HTMLDialogElement>(null)
    const newNameInputRef = useRef<HTMLInputElement>(null)

    // const handleRenameDialogOpen = () => {
    //     if (renameContainerRef.current) {
    //         renameContainerRef.current.classList.add('flex')
    //         renameContainerRef.current.classList.remove('hidden')
    //     }
    // }

    // const handleRenameDialogClose = () => {
    //     if (renameContainerRef.current) {
    //         if (newNameInputRef.current) {
    //             newNameInputRef.current.value = ''
    //         }
    //         renameContainerRef.current.classList.add('hidden')
    //         renameContainerRef.current.classList.remove('flex')
    //     }
    // }

    const handleRenameDialogOpen = () => {
        if (renameDialogRef.current) {
            renameDialogRef.current.showModal()
        }
    }

    const handleRenameDialogClose = () => {
        if (renameDialogRef.current) {
            if (newNameInputRef.current) {
                newNameInputRef.current.value = ''
            }
            renameDialogRef.current.close()
        }
    }

    const handleRename = async (e: React.MouseEvent<HTMLButtonElement>) => {
        try{
            e.stopPropagation()
            e.preventDefault()
            if (newNameInputRef.current?.value) {
                console.log(newNameInputRef.current?.value, "start to rename")
                await editFlowName(flowId, newNameInputRef.current?.value)
            }
            else {
                alert('Please enter a name')
            }
        } catch (error) {
            console.error(error)
        } finally {
            // newNameInputRef.current!.value = ''
            handleRenameDialogClose()
        }
    }

  return (
    <ul className={`${show ? 'flex flex-col items-center justify-center' : 'hidden'}  w-[92px]  py-[8px] rounded-[4px] bg-[#3E3E41] absolute top-[0px] left-[230px] z-[2000000]`}>
        <li className='w-full'>
            <button className='flex items-center justify-start gap-[8px] pl-[16px] w-full h-[24px]' onClick={(e) => {
                e.stopPropagation()
                e.preventDefault()
                handleOperationMenuHide()
                handleRenameDialogOpen()
            }}>
                <div className='flex justify-center items-center'>
                <svg xmlns="http://www.w3.org/2000/svg" width="9" height="10" viewBox="0 0 9 10" fill="none">
                    <path d="M6.99994 0.5L9 2.50006L4.49994 7L2.49994 5L6.99994 0.5Z" fill="#BEBEBE"/>
                    <path d="M2 5.5L4 7.5L1 8.5L2 5.5Z" fill="#BEBEBE"/>
                </svg>
                </div>
                <div className='flex justify-start items-center text-[12px] text-[#BEBEBE] font-normal font-plus-jakarta-sans w-[50px]'>
                    rename
                </div>
            </button>
        <button className='flex items-center justify-start gap-[8px] pl-[16px] w-full h-[24px]' onClick={(e) => {
                e.stopPropagation()
                e.preventDefault()
                handleOperationMenuHide()
                removeFlow(flowId)
            }}>
                <div className='flex justify-center items-center'>
                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M9 1L1 9" stroke="#BEBEBE" stroke-width="2"/>
                <path d="M9 9L1 1" stroke="#BEBEBE" stroke-width="2"/>
                </svg>
                </div>
                <div className='flex justify-start items-center text-[12px] text-[#BEBEBE] font-normal font-plus-jakarta-sans w-[50px]'>
                    delete
                </div>
            </button>
        </li>
        {ReactDOM.createPortal(
    //   <div ref={renameContainerRef} className='hidden fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center w-[300px] h-[200px] bg-[#3E3E41] rounded-[8px] gap-[3px] z-[2000000]'>
    //     <h3 className='text-[16px] text-[#CDCDCD] font-plus-jakarta-sans font-bold flex items-center justify-center w-[240px] h-[20px]'>
    //         New Workspace Name
    //     </h3>
    //     <div className='flex items-center justify-center gap-[8px] w-[180px] h-[80px] bg-[#3E3E41] rounded-[4px] font-plus-jakarta-sans font-bold whitespace-nowrap text-[16px] text-[#CDCDCD]'>
    //     <input ref={newNameInputRef} type="text" placeholder='Enter new name' className='w-[240px] h-[30px] bg-[#3E3E41] rounded-[4px] border-[1px] border-solid border-[#BEBEBE] font-plus-jakarta-sans font-bold text-[#BEBEBE] hover:bg-transparent hover:border-main-orange hover:outline-[#ffa73d] hover:text-[#CDCDCD]'/>
    //     </div>
    //     <div className='flex items-center justify-center gap-[8px] w-[240px] h-[20px]'>
    //         <button className='w-[70px] h-[20px] bg-[#3E3E41] rounded-[4px] border-[1px] border-solid border-[#BEBEBE] font-plus-jakarta-sans font-bold text-[#BEBEBE] hover:bg-[#CDCDCD] hover:text-[#CDCDCD] flex items-center justify-center' onClick={handleRename}>
    //             save
    //         </button>
    //         <button className='w-[70px] h-[20px] bg-[#3E3E41] rounded-[4px] border-[1px] border-solid border-[#BEBEBE] font-plus-jakarta-sans font-bold text-[#BEBEBE] flex items-center justify-center' onClick={handleRenameDialogClose}>
    //             cancel
    //         </button>
    //     </div>
    //   </div>,
    <dialog 
    ref={renameDialogRef} 
    className="bg-[#2A2A2A] rounded-lg shadow-2xl border border-[#404040] p-6 w-[400px] backdrop-blur-sm fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2"
>
    <div className="flex flex-col gap-6">
        {/* Header */}
        <h2 className="text-[#FFFFFF] text-xl font-semibold">
            New Workspace Name
        </h2>

        {/* Input field */}
        <div className="relative">
            <input
                ref={newNameInputRef}
                type="text"
                placeholder="Enter new name"
                className="w-full px-4 py-2 bg-[#363636] border border-[#404040] rounded-md
                         text-[#FFFFFF] placeholder-[#808080]
                         focus:outline-none focus:ring-2 focus:ring-[#5C5C5C]
                         transition duration-200"
            />
        </div>

        {/* Buttons */}
        <div className="flex justify-end gap-3 mt-2">
            <button
                onClick={handleRenameDialogClose}
                className="px-4 py-2 rounded-md text-[#BEBEBE] hover:bg-[#363636]
                         transition duration-200"
            >
                Cancel
            </button>
            <button
                onClick={handleRename}
                className="px-4 py-2 bg-[#2B5C9B] hover:bg-[#1E4B8A] 
                         text-white rounded-md transition duration-200"
            >
                Save
            </button>
        </div>
    </div>
</dialog>,
      document.body
    )}
    </ul>
  )
}

export default FlowElementOperationMenu