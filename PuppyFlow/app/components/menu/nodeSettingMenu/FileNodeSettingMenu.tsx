import React,{useEffect, useState, useRef} from 'react'
import ReactDOM from 'react-dom'
import { useNodesPerFlowContext } from '../../states/NodesPerFlowContext'
import { useReactFlow , Position} from '@xyflow/react'
import useFileNodeUploadUtils from '../../hooks/useFileNodeUploadUtils'
import { PuppyStorage_IP_address_for_uploadingFile } from '../../hooks/useJsonConstructUtils'

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
<ul className={`flex flex-col absolute top-[24px] py-[8px] w-[128px] bg-[#3E3E41] rounded-[4px] left-0 z-[20000] ${showSettingMenu ? "" : "hidden"}`}>
        <li>
            <button className='flex flex-row items-center justify-start px-[16px] gap-[8px] w-full h-[24px] bg-[#3E3E41] border-none rounded-t-[4px]'
            onClick={(e) => {
                e.stopPropagation()
                e.preventDefault()
                clearMenu()
                fileInputRef.current?.click()
            }}
            >
            <div className='flex items-center justify-center'>
            <svg xmlns="http://www.w3.org/2000/svg" width="9" height="10" viewBox="0 0 9 10" fill="none">
            <path d="M0.769196 6.17285L0.778356 2.17096L7.76868 2.17017L7.76918 6.1729" stroke="#BEBEBE" strokeWidth="1.5"/>
            <path d="M4.2692 9.17285V5.67285" stroke="#BEBEBE" strokeWidth="1.5"/>
            <path d="M4.2692 3.67285L6.2692 6.67285H2.2692L4.2692 3.67285Z" fill="#BEBEBE"/>
            </svg>
            </div>
            <div className='font-plus-jakarta-sans text-[12px] font-normal leading-normal text-[#BEBEBE] whitespace-nowrap'>
                Upload
            </div>
            </button>
        </li>
        <li>
            <button className='flex flex-row items-center justify-start px-[16px] gap-[8px] w-full h-[24px] bg-[#3E3E41]'
            onClick={()=> manageNodeasLocked(nodeid)}>
            <div className='flex items-center justify-center'>
            <svg xmlns="http://www.w3.org/2000/svg" width="8" height="9" viewBox="0 0 8 9" fill="none">
            <rect y="4" width="8" height="5" fill="#BEBEBE"/>
            <rect x="1.75" y="0.75" width="4.5" height="6.5" rx="2.25" stroke="#BEBEBE" strokeWidth="1.5"/>
            </svg>
            </div>
            <div className='font-plus-jakarta-sans text-[12px] font-normal leading-normal text-[#BEBEBE] whitespace-nowrap'>
                {getNode(nodeid)?.data?.isLocked ? "Unlock it" :"Lock it"}
            </div>
            </button>
        </li>
        <li>
            <div className='h-[1px] w-full bg-[#181818] my-[8px]'></div>
        </li>
        <li>
            <button className='renameButton flex flex-row items-center justify-start px-[16px] gap-[8px] w-full h-[24px] bg-[#3E3E41]'
            onClick={manageEditLabel}>
                <div className='renameButton flex items-center justify-center'>
                    <svg className='renameButton' xmlns="http://www.w3.org/2000/svg" width="9" height="10" viewBox="0 0 9 10" fill="none">
                        <path d="M7 0.5L9.00006 2.50006L4.5 7L2.5 5L7 0.5Z" fill="#BEBEBE"/>
                        <path d="M2 5.5L4 7.5L1 8.5L2 5.5Z" fill="#BEBEBE"/>
                    </svg>
                </div>
                <div className='renameButton font-plus-jakarta-sans text-[12px] font-normal leading-normal text-[#BEBEBE] whitespace-nowrap'>
                    rename
                </div>
            </button>
        </li>
        <li>
            <button className='flex flex-row items-center justify-start px-[16px] gap-[8px] w-full h-[24px] bg-[#3E3E41] rounded-b-[4px]' 
            onClick={deleteNode}>
                <div className='flex items-center justify-center'>
                    <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10" fill="none">
                        <path d="M9 1L1 9" stroke="#BEBEBE" strokeWidth="2"/>
                        <path d="M9 9L1 1" stroke="#BEBEBE" strokeWidth="2"/>
                    </svg>
                </div>
                <div className='font-plus-jakarta-sans text-[12px] font-normal leading-normal text-[#BEBEBE] whitespace-nowrap'>
                    Delete
                </div>
            </button>
        </li>
    </ul>
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
