import React,{useEffect, useState, useRef, Fragment} from 'react'
import ReactDOM from 'react-dom'
import { useNodesPerFlowContext } from '../../../states/NodesPerFlowContext'
import { useReactFlow , Position} from '@xyflow/react'
import useFileNodeUploadUtils from '../../../hooks/useFileNodeUploadUtils'
import { PuppyStorage_IP_address_for_uploadingFile } from '../../../hooks/useJsonConstructUtils'
import { Transition } from '@headlessui/react'

type FileNodeSettingMenuProps = {
    showSettingMenu: number,
    clearMenu: () => void,
    nodeid: string,

}

function FileNodeSettingMenu({showSettingMenu, clearMenu, nodeid}: FileNodeSettingMenuProps) {

    const {  manageNodeasLocked, setNodeEditable, preventInactivateNode} = useNodesPerFlowContext()
    const {onTriggerUploadFile} = useFileNodeUploadUtils()
    const {setNodes, setEdges, getEdges, getNode}  = useReactFlow()
    const [tempUploadInfo, setTempUploadInfo] = useState<{uploadUrl: string, uploadId: string} | null>(null)
    const fileInputRef = useRef<HTMLInputElement>(null)


    // 处理 onDelete node
    const deleteNode = () => {
        setEdges(prevEdges => prevEdges.filter(edge => edge.source !== nodeid && edge.target !== nodeid));
        setNodes(prevNodes => prevNodes.filter(node => node.id !== nodeid));
    }

    const manageEditLabel = () => {
        setNodeEditable(nodeid)
        preventInactivateNode()
        clearMenu()
    }

    const handleInputChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        // 获取文件扩展名
        const fileName = file.name;
        const fileExtension = fileName.substring(fileName.lastIndexOf('.') + 1);


        try {
            // Step 1: 获取预签名URL和UUID, userid = Rose123
            const response = await fetch(`${PuppyStorage_IP_address_for_uploadingFile}/Rose123`);

            if (!response.ok) {
                throw new Error(`Fetch temporary upload info Error: ${response.status}`)
            }

            const { presigned_url, task_id } = await response.json();

            // Step 2: 上传文件到S3
            const uploadResponse = await fetch(presigned_url, {
                method: 'PUT',
                headers: {
                    'Content-Type': file.type,
                    // 'x-amz-meta-uuid': task_id, // 保存UUID到metadata
                },
                body: file,
            });

            if (uploadResponse.ok) {
                console.log('文件上传成功');
                saveFileInformation(task_id, fileExtension)
                // 在这里可以将UUID保存到block的content
            } else {
                console.log(response)
                console.error('文件上传失败');
            }
        } catch (error) {
            console.error('上传过程中发生错误', error);
        }
    };

    const saveFileInformation = (task_id: string, fileType: string) => {
        setNodes(prevNodes => prevNodes.map(node => node.id === nodeid ? { ...node, data: { 
            ...node.data,content: task_id, fileType: fileType } } : node));
    }

    

  return (
    <>
        <Transition
            show={!!showSettingMenu}
            as={Fragment}
            enter="transition ease-out duration-100"
            enterFrom="transform opacity-0 translate-y-[-10px]"
            enterTo="transform opacity-100 translate-y-0"
            leave="transition ease-in duration-75"
            leaveFrom="transform opacity-100 translate-y-0"
            leaveTo="transform opacity-0 translate-y-[-10px]"
        >
            <ul className='flex flex-col absolute top-[8px] p-[8px] w-[160px] gap-[4px] bg-[#252525] border-[1px] border-[#404040] rounded-[8px] left-0 z-[20000]'>

                <li>
                    <button className='flex flex-row items-center justify-start gap-[8px] w-full h-[26px] hover:bg-[#3E3E41] rounded-[4px] border-none text-[#CDCDCD] hover:text-white'
                    onClick={(e) => {
                        e.stopPropagation()
                        e.preventDefault()
                        clearMenu()
                        fileInputRef.current?.click()
                    }}>
                        <div className='flex items-center justify-center'>
                            <svg width="26" height="26" viewBox="0 0 26 26" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M8 15L8 9L19 9L19 15" stroke="currentColor" strokeWidth="2"/>
                                <path d="M13.5 21V14" stroke="currentColor" strokeWidth="2"/>
                                <path d="M13.5 11L16.5 15H10.5L13.5 11Z" fill="currentColor"/>
                            </svg>
                        </div>
                        <div className='font-plus-jakarta-sans text-[12px] font-normal leading-normal whitespace-nowrap'>
                            Upload
                        </div>
                    </button>
                </li>


                <li className='w-full h-[1px] bg-[#404040] my-[2px]'></li>
                <li>
                    <button className='flex flex-row items-center justify-start gap-[8px] w-full h-[26px] hover:bg-[#3E3E41] rounded-[4px] border-none text-[#CDCDCD] hover:text-white'
                    onClick={()=> manageNodeasLocked(nodeid)}>
                        <div className='flex items-center justify-center'>
                            <svg width="26" height="26" viewBox="0 0 26 26" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <rect x="7" y="13" width="12" height="7" fill="currentColor"/>
                                <rect x="9" y="7" width="8" height="11" rx="4" stroke="currentColor" strokeWidth="2"/>
                            </svg>
                        </div>
                        <div className='font-plus-jakarta-sans text-[12px] font-normal leading-normal whitespace-nowrap'>
                            {getNode(nodeid)?.data?.isLocked ? "Unlock the File" : "Lock the File"}
                        </div>
                    </button>
                </li>
                <li>
                    <button className='renameButton flex flex-row items-center justify-start gap-[8px] w-full h-[26px] hover:bg-[#3E3E41] rounded-[4px] border-none text-[#CDCDCD] hover:text-white'
                    onClick={manageEditLabel}>
                        <div className='renameButton flex items-center justify-center'>
                            <svg width="26" height="26" viewBox="0 0 26 26" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M16.8891 6L20.0003 9.11118L13.0002 16.111L9.88915 13L16.8891 6Z" fill="currentColor"/>
                                <path d="M9.1109 13.7776L12.222 16.8887L7.55536 18.4442L9.1109 13.7776Z" fill="currentColor"/>
                            </svg>
                        </div>
                        <div className='renameButton font-plus-jakarta-sans text-[12px] font-normal leading-normal whitespace-nowrap'>
                            Rename
                        </div>
                    </button>
                </li>                    

                <li className='w-full h-[1px] bg-[#404040] my-[2px]'></li>
                <li>
                    <button className='flex flex-row items-center justify-start gap-[8px] w-full h-[26px] hover:bg-[#3E3E41] rounded-[4px] border-none text-[#F44336] hover:text-[#FF6B64]'
                    onClick={deleteNode}>
                        <div className='flex items-center justify-center'>
                            <svg width="26" height="26" viewBox="0 0 26 26" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M19 7L7 19" stroke="currentColor" strokeWidth="2"/>
                                <path d="M19 19L7 7" stroke="currentColor" strokeWidth="2"/>
                            </svg>
                        </div>
                        <div className='font-plus-jakarta-sans text-[12px] font-normal leading-normal whitespace-nowrap'>
                            Delete
                        </div>
                    </button>
                </li>
            </ul>
        </Transition>
        {ReactDOM.createPortal(
            <input
                type="file"
                ref={fileInputRef}
                onChange={handleInputChange}
                onClick={(e) => e.stopPropagation()}
                accept=".json"
                className="opacity-0 absolute top-0 left-0 w-full h-full cursor-pointer"
                style={{
                    position: 'fixed',
                    top: '-100%',
                    left: '-100%',
                    // 移除 pointer-events-none
                    // 移除 transform 和 translate，因为它们可能会影响点击
                    zIndex: 9999,
                }}
            />,
            document.body
        )}
    </>
    
  )
}

export default FileNodeSettingMenu
