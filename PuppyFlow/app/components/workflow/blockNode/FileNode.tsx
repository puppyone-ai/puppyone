'use client'
import { NodeProps, Node, Handle, Position, useReactFlow, NodeResizeControl } from '@xyflow/react'
import React,{useRef, useEffect, useState, ReactElement, useContext} from 'react'
import WhiteBallHandle from '../handles/WhiteBallHandle'
import NodeToolBar from './nodeTopRightBar/NodeTopRightBar'
import {useNodesPerFlowContext} from '../../states/NodesPerFlowContext'
import ReactDOM from 'react-dom'
import { PuppyUpload } from '../../misc/PuppyUpload'
import { PuppyStorage_IP_address_for_uploadingFile } from '../../hooks/useJsonConstructUtils'
import {useFlowsPerUserContext} from "../../states/FlowsPerUserContext"
import useManageUserWorkspacesUtils from '../../hooks/useManageUserWorkSpacesUtils'
import useJsonConstructUtils from '../../hooks/useJsonConstructUtils'
import { WarnsContext } from '../../states/WarnMessageContext';
import { uploadFiles } from '@/app/utils/uploadthing'
import { SYSTEM_URLS } from "@/config/urls";
// import {WarnsContext,WarnsContainer} from "puppyui"

export type FileNodeData = {
  content: string,
  label: string,
  isLoading: boolean,
  locked: boolean,
  isInput: boolean,
  isOutput: boolean,
  editable: boolean,
  fileType?: string,
}

type FileNodeProps = NodeProps<Node<FileNodeData>>

function FileNode({data: {content, label, isLoading, locked, isInput, isOutput, editable}, type, isConnectable, id}: FileNodeProps ) {

  // const { addNode, deleteNode, activateNode, nodes, searchNode, inactivateNode, clear, isOnConnect, allowActivateNode, preventInactivateNode, allowInactivateNode, disallowEditLabel} = useNodeContext()
  const {activatedNode, isOnConnect, isOnGeneratingNewNode, setNodeUneditable, editNodeLabel, preventInactivateNode, allowInactivateNodeWhenClickOutside} = useNodesPerFlowContext()
  const {getEdges, setNodes, getNode} = useReactFlow()
  const [isTargetHandleTouched, setIsTargetHandleTouched] = useState(false)
  const componentRef = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const labelRef = useRef<HTMLInputElement | null>(null)
  const labelContainerRef = useRef<HTMLDivElement | null>(null)
  const [nodeLabel, setNodeLabel] = useState(label ?? id)
  const [isLocalEdit, setIsLocalEdit] = useState(false) 
  const measureSpanRef = useRef<HTMLSpanElement | null>(null) // 用于测量 labelContainer 的宽度
  const [borderColor, setBorderColor] = useState("border-main-deep-grey")
  const {userId} = useFlowsPerUserContext()
  const {fetchUserId} = useManageUserWorkspacesUtils()

  // 添加获取连接节点的工具函数
  const { getSourceNodeIdWithLabel, getTargetNodeIdWithLabel } = useJsonConstructUtils()
  
  // 获取连接的节点
  const sourceNodes = getSourceNodeIdWithLabel(id)
  const targetNodes = getTargetNodeIdWithLabel(id)
  
  // 根据连接节点动态确定 isInput 和 isOutput
  const dynamicIsInput = sourceNodes.length === 0 && targetNodes.length > 0
  const dynamicIsOutput = targetNodes.length === 0 && sourceNodes.length > 0
  
  // 使用已有属性或动态计算的值
  const effectiveIsInput = isInput || dynamicIsInput
  const effectiveIsOutput = isOutput || dynamicIsOutput

  useEffect(() => {
    if (activatedNode?.id === id) {
      setBorderColor("border-[#BF9A78]");
    }  else {
      setBorderColor(isOnConnect && isTargetHandleTouched ? "border-main-orange" : "border-main-deep-grey");
    }
  }, [activatedNode, isOnConnect, isTargetHandleTouched, locked, effectiveIsInput, effectiveIsOutput, id])

    // 管理labelContainer的宽度
    useEffect(() => {

      const onLabelContainerBlur = () => {
        
        if (labelContainerRef.current) {
          setNodeUneditable(id)
        }
      }
  
      if (labelContainerRef.current) {
  
        document.addEventListener("click", (e: MouseEvent) => {
          if (!labelContainerRef.current?.contains(e.target as HTMLElement) && !(e.target as HTMLElement).classList.contains("renameButton")) {
            onLabelContainerBlur()
          }
        })
      }
  
      return () => {
        if (labelContainerRef.current) {
          document.removeEventListener("click", (e: MouseEvent) => {
            if (!labelContainerRef.current?.contains(e.target as HTMLElement)) {
              onLabelContainerBlur()
            }
          })
        }
      }
    }, [])
    
    // 自动聚焦，同时需要让cursor focus 到input 的最后一位
  useEffect(() => {
    if (editable && labelRef.current) {
      labelRef.current?.focus();
      const length = labelRef.current.value.length;
      labelRef.current.setSelectionRange(length, length);
    }
  }, [editable, id]);
  
  
  
  
    // 管理 label onchange， 注意：若是当前的workflow中已经存在同样的id，那么不回重新对于这个node进行initialized，那么此时label就是改变了也不会rendering 最新的值，所以我们必须要通过这个useEffect来确保label的值是最新的，同时需要update measureSpanRef 中需要被测量的内容
    useEffect(() => {
      const currentLabel= getNode(id)?.data?.label as string | undefined
      if (currentLabel !== undefined && currentLabel !== nodeLabel && !isLocalEdit) {
          
          setNodeLabel(currentLabel)
          if (measureSpanRef.current) {
            measureSpanRef.current.textContent = currentLabel
          }
        }
    }, [label, id, isLocalEdit])
  

    const onFocus: () => void = () => {
      preventInactivateNode()
      const curRef = componentRef.current
      if (curRef && !curRef.classList.contains("nodrag")) {
          curRef.classList.add("nodrag")
          }
        
      }
  
      const onBlur: () => void = () => {
       
          allowInactivateNodeWhenClickOutside()  
          const curRef = componentRef.current
          if (curRef) {
              curRef.classList.remove("nodrag")
          }
          if (isLocalEdit){
            //  管理 node label onchange，只有 onBlur 的时候，才会更新 label
            // setNodes(nodes => nodes.map(node => node.id === id ? { ...node, data: { ...node.data, label: nodeLabel } } : node))
            editNodeLabel(id, nodeLabel)
            setIsLocalEdit(false)
          }
      }


  // for rendering diffent logo of upper right tag
  const renderTagLogo = () => {
    return (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="group">
        <path d="M4 6H10L12 8H20V18H4V6Z" className="fill-transparent stroke-[#9E7E5F]  group-active:stroke-[#BF9A78]" strokeWidth="1.5"/>
        <path d="M8 13.5H16" className="stroke-[#9E7E5F]  group-active:stroke-[#BF9A78]" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    )
  }

  const EditLabel = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (labelRef.current ) {
      setIsLocalEdit(true)
      setNodeLabel(labelRef.current.value)
    }
  }

    // 计算 measureSpanRef 的宽度，这个就是在计算input element内部内容的真实宽度，记得+4px不然所有内容无法完全的展现在input中，另外若是存在isInput, isOutput, locked，则需要考虑当整体的内容+icon width 溢出最大值时，我们必须设定 inputbox 的width = maxWidth - 21px，不然因为我们设置了 input 的 maxWidth = '100%', 他会把icon 给覆盖掉的，若是没有icon，则不需要担心，因为就算是设计他的宽度=文本宽度，但是一旦整体宽度 > maxWidth, css 会自动把文本宽度给压缩到 maxWidth 的，所以不用担心
    const calculateLabelWidth = () => {
      if (measureSpanRef.current) {
        if (effectiveIsInput || effectiveIsOutput || locked) {
          if (contentRef.current) {
            if (measureSpanRef.current.offsetWidth + 21 > contentRef.current.clientWidth - 32) {
              // console.log("hello")
              return `${contentRef.current.clientWidth - 53}px`
            }
        }
      }
        return `${measureSpanRef.current.offsetWidth + 4}px`;
    }
      return 'auto'
  }


    // 计算 <input> element 的宽度, input element 的宽度是根据 measureSpanRef 的宽度来决定的，分情况：若是editable，则需要拉到当前的最大width （若是前面有isInput, isOutput, locked，则需要减去53px，否则，则需要拉到当前的label的宽度（拖住文体即可）
    const calculateInputWidth = () => {
      if (contentRef.current) {
        if (editable) {
          if (effectiveIsInput || effectiveIsOutput || locked) {
            return `${contentRef.current.clientWidth - 53}px`
          }
          else {
            return `${contentRef.current.clientWidth - 32}px`
          }
        }
      }
      return calculateLabelWidth()
    }

    // 计算 labelContainer 的 最大宽度，最大宽度是由外部的container 的宽度决定的，同时需要减去 32px, 因为右边有一个menuIcon, 需要 - 他的宽度和右边的padding
    const calculateMaxLabelContainerWidth = () => {
      if (contentRef.current) {
        return `${contentRef.current.clientWidth - 48}px`
      }
      return '100%'
    }

    // const inputRef = useRef<HTMLInputElement>(null); // Create a ref for the file input

    // const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    //   console.log("handle file change")
    //   const files = event.target.files;
    //   if (files && files.length > 0) {
    //     console.log(files); // Log the selected files
    //     // Handle the files here (e.g., upload them)
    //   }
    // };

    const getuserid = async ():Promise<string> =>{
      if(userId.trim() !== ""){
        return userId
      }
      const res = await fetchUserId() as string
      return res
    }

    const {warns,setWarns} = useContext(WarnsContext) as any;

    const handleInputChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files;
      if (!files || files.length === 0) return;

      setIsOnUploading(true);

      try {
        // Process each file sequentially
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          
          // Get file extension
          const fileName = file.name;
          let fileExtension = fileName.substring(fileName.lastIndexOf('.') + 1);
          const supportedFileExtensions = ["json", "txt", "html", "css", "js", "png", "jpg", "gif", "svg", "mp3", "wav", "mp4", "webm", "pdf", "zip", "md", "markdown", "application"];

          if (!supportedFileExtensions.includes(fileExtension)) {
            fileExtension = "application";
          }
          if(fileExtension === "txt") {
            fileExtension = "text";
          }

          // Step 1: Get presigned URL and UUID
          const response = await fetch(`${PuppyStorage_IP_address_for_uploadingFile}/${fileExtension}`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                user_id: `${await getuserid()}`,
                content_name: fileName
              })
            }
          );
          
          if (!response.ok) {
            setWarns((prev: string[])=>[...prev,{time:Date.now(),text:`Fetch temporary upload info Error: ${response.status}`}]);
            continue; // Skip this file and try the next one
          }
        
          const data = await response.json();
          console.log(data);
          const upload_url = data.upload_url;
          const download_url = data.download_url;
          const content_id = data.content_id;
          const content_type_header = data.content_type_header;
          const expires_at = data.expires_at;
          
          // Step 2: Upload file to S3
          const uploadResponse = await fetch(upload_url, {
            method: 'PUT',
            headers: {
              'Content-Type': content_type_header,
            },
            body: file,
          });
          
          if (uploadResponse.ok) {
              console.log(`File ${fileName} uploaded successfully`);
              saveFileInformation(fileName, download_url, content_id, fileExtension, content_type_header, expires_at);
          } else {
              console.error(`Failed to upload file ${fileName}`);
              setWarns((prev: string[])=>[...prev,{time:Date.now(),text:`Failed to upload file ${fileName}`}]);
          }
        }
      } catch (error) {
        console.error('Error during upload process', error);
      } finally {
        setIsOnUploading(false); // Make sure to set loading state to false when all uploads are done
      }
    };

        // New handleDrop function to process dropped files
        const handleDrop = async (files: FileList | File[]) => {
          if (!files || files.length === 0) return;

          setIsOnUploading(true);
          
          try {
            // Process all dropped files sequentially
            for (let i = 0; i < files.length; i++) {
              const file = files[i];
              
              // Get file extension
              const fileName = file.name;
              let fileExtension = fileName.substring(fileName.lastIndexOf('.') + 1);
              const supportedFileExtensions = ["json", "txt", "html", "css", "js", "png", "jpg", "gif", "svg", "mp3", "wav", "mp4", "webm", "pdf", "zip", "md", "markdown", "application"];

              if (!supportedFileExtensions.includes(fileExtension)) {
                fileExtension = "application";
              }
              if(fileExtension === "txt") {
                fileExtension = "text";
              }
        
              try {
                  // Step 1: Get presigned URL and UUID
                  const response = await fetch(`${PuppyStorage_IP_address_for_uploadingFile}/${fileExtension}`,
                    {
                      method: 'POST',
                      headers: {
                        'Content-Type': 'application/json'
                      },
                      body: JSON.stringify({
                        user_id: `${await getuserid()}`,
                        content_name: fileName
                      })
                    }
                  );
                  
                  if (!response.ok) {
                    setWarns((prev: string[])=>[...prev,{time:Date.now(),text:`Fetch temporary upload info Error: ${response.status}`}]);
                    console.error(`Failed to get upload URL for file ${fileName}`);
                    continue; // Skip this file and try the next one
                  }
                  
                  const data = await response.json();
                  console.log(data);
                  const upload_url = data.upload_url;
                  const download_url = data.download_url;
                  const content_id = data.content_id;
                  const content_type_header = data.content_type_header;
                  const expires_at = data.expires_at;
                  
                  // Step 2: Upload file to S3
                  const uploadResponse = await fetch(upload_url, {
                    method: 'PUT',
                    headers: {
                      'Content-Type': content_type_header,
                    },
                    body: file,
                  });
                  
                  if (uploadResponse.ok) {
                      console.log(`File ${fileName} uploaded successfully`);
                      saveFileInformation(fileName, download_url, content_id, fileExtension, content_type_header, expires_at);
                  } else {
                      console.error(`Failed to upload file ${fileName}`);
                      setWarns((prev: string[])=>[...prev,{time:Date.now(),text:`Failed to upload file ${fileName}`}]);
                  }
              } catch (error) {
                  console.error(`Error uploading file ${file.name}:`, error);
                  setWarns((prev: string[])=>[...prev,{time:Date.now(),text:`Error uploading file ${file.name}`}]);
              }
            }
          } catch (error) {
              console.error('Error in file processing:', error);
          } finally {
              setIsOnUploading(false); // Make sure to set loading state to false when all uploads are done
          }
        };
    



    const saveFileInformation = (fileName:string, download_url:string ,task_id: string, fileType: string, content_type_header: string, expires_at: string) => {
        setNodes(prevNodes => prevNodes.map(node => node.id === id ? { ...node, data: { 
            ...node.data, content: Array.isArray(node.data?.content) 
                ? [...(node.data.content.filter((item: any) => item.task_id !== task_id)), 
                   { fileName: fileName, task_id: task_id, fileType: fileType, download_url:download_url, content_type_header: content_type_header, expires_at: expires_at }]
                : [{ fileName: fileName, task_id: task_id, fileType: fileType, download_url:download_url, content_type_header: content_type_header, expires_at: expires_at }]
            }} : node));
        setTimeout(() => {
            console.log("updated file node", getNode(id))
        }, 1000)
    }


    const [uploadedFiles, setUploadedFiles] = useState<{fileName:string ,task_id: string, fileType: string}[]>([]);
    const [isOnUploading, setIsOnUploading] = useState(false);

    useEffect(() => {
      const currentNode = getNode(id);
      if (currentNode?.data?.content && Array.isArray(currentNode.data.content)) {
        console.log("currentNode", currentNode)

        setUploadedFiles(currentNode.data.content);
      }
    }, [getNode(id)]);


    const handleDelete = async (file:{fileName: string|undefined, fileType: string, task_id:string}, index:number) => {

    //   - **Request Body Parameters:**
    // - `user_id (string)`: **REQUIRED** - User identifier
    // - `content_id (string)`: **REQUIRED** - Content identifier
    // - `content_name (string)`: **REQUIRED** - Name of the file to be deleted
      const response = await fetch(`${SYSTEM_URLS.PUPPY_STORAGE.BASE}/file/delete`,
        {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            user_id: `${await getuserid()}`,
            content_id: file.task_id,
            content_name: file.fileName
          })
        }
      );

      // console.log("delete res",response)
      // if the response is ok, then delete the file
      if (response.ok) {
        setNodes(prevNodes => prevNodes.map(node => {
          if (node.id === id) {
              return { ...node, data: { ...node.data, content: uploadedFiles.filter((_: {fileName:string, task_id: string, fileType: string}, i: number) => i !== index)} }
          }
          return node
      }))
      }
    }

  // 添加显示源节点标签的函数
  const displaySourceNodeLabels = () => {
    return sourceNodes.map(node => (
      <button
        key={`${node.id}-${id}-simple`}
        onClick={() => {
          navigator.clipboard.writeText(`{{${node.label}}}`);
        }}
        className="px-1.5 py-0.5 rounded text-[11px] bg-[#1A1A1A] border border-[#333333] 
                 text-gray-300 hover:bg-[#252525] hover:text-white transition-colors"
      >
        {node.label}
      </button>
    ))
  }

  // 添加显示目标节点标签的函数
  const displayTargetNodeLabels = () => {
    return targetNodes.map(node => (
      <button
        key={`${node.id}-${id}-simple`}
        onClick={() => {
          navigator.clipboard.writeText(`{{${node.label}}}`);
        }}
        className="px-1.5 py-0.5 rounded text-[11px] bg-[#1A1A1A] border border-[#333333] 
                 text-gray-300 hover:bg-[#252525] hover:text-white transition-colors"
      >
        {node.label}
      </button>
    ))
  }

  return (
    <div ref={componentRef} className={`relative w-full h-full min-w-[240px] min-h-[176px]  ${isOnGeneratingNewNode ? 'cursor-crosshair' : 'cursor-default'}`}>
        <div className="absolute -top-[28px] h-[24px] left-0 z-10 flex gap-1.5">
        {effectiveIsInput && (
          <div className="px-2 py-0.5 rounded-[8px] flex items-center gap-1 text-[10px] font-bold bg-[#84EB89] text-black">
            <svg width="16" height="16" viewBox="0 0 26 26" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="16" y="7" width="3" height="12" rx="1" fill="currentColor"/>
              <path d="M5 13H14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
              <path d="M10 9L14 13L10 17" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <span>INPUT</span>
          </div>
        )}
        
        {effectiveIsOutput && (
          <div className="px-2 py-0.5 rounded-[8px] flex items-center gap-1 text-[10px] font-bold bg-[#FF9267] text-black">
            <svg width="16" height="16" viewBox="0 0 26 26" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="7" y="7" width="3" height="12" rx="1" fill="currentColor"/>
              <path d="M12 13H21" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
              <path d="M17 9L21 13L17 17" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <span>OUTPUT</span>
          </div>
        )}
        
        {locked && (
          <div className="px-2 py-0.5 rounded-[8px] flex items-center gap-1 text-[10px] font-bold bg-[#3EDBC9] text-black">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M5 7V5C5 3.34315 6.34315 2 8 2C9.65685 2 11 3.34315 11 5V7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              <rect x="4" y="7" width="8" height="6" rx="1" fill="currentColor"/>
            </svg>
            <span>LOCKED</span>
          </div>
        )}
      </div>
      
      <div id={id} ref={contentRef}
        className={`flex flex-col w-full h-full border-[1.5px] border-solid border-[1.5px] min-w-[240px] min-h-[176px] p-[8px] rounded-[16px] flex justify-start ${borderColor} text-[#CDCDCD] bg-main-black-theme break-words font-plus-jakarta-sans text-base leading-5 font-[400] overflow-hidden shadow-[0_8px_16px_rgba(0,0,0,0.04),0_4px_24px_rgba(255,255,255,0.04)]`}>
          
        {/* the top bar of a block */}
        <div ref={labelContainerRef} 
          className={`h-[24px] w-full max-w-full rounded-[4px] flex items-center justify-between mb-2`}>
          
          {/* top-left wrapper */}
          <div className="flex items-center gap-[8px] hover:cursor-grab active:cursor-grabbing group"
            style={{
              maxWidth: calculateMaxLabelContainerWidth(),
            }}>
            <div className="min-w-[20px] min-h-[24px] flex items-center justify-center group-hover:text-[#CDCDCD] group-active:text-[#BF9A78]">
              {renderTagLogo()}
            </div>

            {/* measure label width span */}
            <span
              ref={measureSpanRef}
              style={{
                visibility: 'hidden',
                position: 'absolute',
                whiteSpace: 'pre',
                fontSize: '12px',
                lineHeight: '18px',
                fontWeight: '700',
                fontFamily: 'Plus Jakarta Sans',
              }}>
              {nodeLabel}
            </span>
            
            {editable ? (
              <input ref={labelRef} 
                autoFocus={editable} 
                className={`
                  flex items-center justify-start 
                  font-[600] text-[12px] leading-[18px] 
                  font-plus-jakarta-sans bg-transparent h-[18px] 
                  focus:outline-none truncate w-full text-[#6D7177] group-hover:text-[#CDCDCD] group-active:text-[#BF9A78]
                `}
                value={nodeLabel}
                readOnly={!editable}
                onChange={(e) => {
                  setIsLocalEdit(true);
                  setNodeLabel(e.target.value);
                }}
                onMouseDownCapture={onFocus}
                onBlur={onBlur}
              />
            ) : (
              <span 
                className={`
                  flex items-center justify-start 
                  font-[600] text-[12px] leading-[18px] 
                  font-plus-jakarta-sans truncate w-fit text-[#6D7177] group-hover:text-[#CDCDCD] group-active:text-[#BF9A78]
                `}
              >
                {nodeLabel}
              </span>
            )}
          </div>

          {/* top-right toolbar */}
          <div className="min-w-[24px] min-h-[24px] flex items-center justify-center">
            <NodeToolBar Parentnodeid={id} ParentNodetype={type}/>
          </div>
        </div>

        {/* <div 
              className={`cursor-pointer h-full w-full mx-auto my-2 rounded-[8px] border-dashed border-2 border-gray-400 hover:border-blue-400 hover:bg-gray-800/20 active:border-blue-500 transition-all duration-200 flex flex-col items-center justify-center gap-3 p-4`}
              onClick={(e) => {
                console.log(inputRef.current)
                
                inputRef.current?.click();
              }}
              onDragOver={(e) => {
                e.preventDefault(); // Prevent default to allow drop
                e.stopPropagation();
                e.currentTarget.classList.add('bg-gray-800/30', 'border-blue-400');
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                e.stopPropagation();
                e.currentTarget.classList.remove('bg-gray-800/30', 'border-blue-400');
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                e.currentTarget.classList.remove('bg-gray-800/30', 'border-blue-400');
                const files = e.dataTransfer.files;
                if (files.length > 0) {
                  // Handle the file(s) here
                  console.log(files);
                }
              }}
            >

              <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-gray-400 group-hover:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              
              <div className="text-center space-y-2">
                <p className="text-sm font-medium text-gray-300">Drag and drop files here</p>
                <p className="text-xs text-gray-500">or</p>
                <p className="text-xs font-medium text-blue-400 hover:text-blue-300">Browse files</p>
              </div>
              
              <p className="text-xs text-gray-500 mt-2">Supported formats: .json</p>
          </div> */}
          <PuppyUpload handleInputChange={handleInputChange} uploadedFiles={uploadedFiles} setUploadedFiles={setUploadedFiles} handleDrop={handleDrop} isOnUploading={isOnUploading} handleDelete={handleDelete}/>


        <NodeResizeControl
          minWidth={240}
          minHeight={176}
          style={{
            position: 'absolute', right: "0px", bottom: "0px", cursor: 'se-resize',
            background: 'transparent',
            border: 'none',
            display:isLoading?"none":"flex"
          }}
        >
          <div
            style={{
              position: "absolute",
              visibility: `${activatedNode?.id === id ? "visible" : "hidden"}`,
              right: "8px",
              bottom: "8px",
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              backgroundColor: 'transparent',
              zIndex: "200000",
              width: "26px",
              height: "26px",
            }}
          >
            <svg width="26" height="26" viewBox="0 0 26 26" fill="none" xmlns="http://www.w3.org/2000/svg" className="group active:group-[]:fill-[#BF9A78]">
              <path d="M10 5.99998H12V7.99998H10V5.99998Z" className="fill-[#9E7E5F] group-hover:fill-[#CDCDCD] group-active:fill-[#BF9A78]" />
              <path d="M10 2H12V4H10V2Z" className="fill-[#9E7E5F] group-hover:fill-[#CDCDCD] group-active:fill-[#BF9A78]" />
              <path d="M6 5.99998H8V7.99998H6V5.99998Z" className="fill-[#9E7E5F] group-hover:fill-[#CDCDCD] group-active:fill-[#BF9A78]" />
              <path d="M6 10H8V12H6V10Z" className="fill-[#9E7E5F] group-hover:fill-[#CDCDCD] group-active:fill-[#BF9A78]" />
              <path d="M2 10H4V12H2V10Z" className="fill-[#9E7E5F] group-hover:fill-[#CDCDCD] group-active:fill-[#BF9A78]" />
              <path d="M10 10H12V12H10V10Z" className="fill-[#9E7E5F] group-hover:fill-[#CDCDCD] group-active:fill-[#BF9A78]" />
            </svg>
          </div>
        </NodeResizeControl>

        <WhiteBallHandle id={`${id}-a`} type="source" sourceNodeId={id}
            isConnectable={isConnectable} position={Position.Top}  />
            <WhiteBallHandle id={`${id}-b`} type="source" sourceNodeId={id}
            isConnectable={isConnectable}
            position={Position.Right}  />
            <WhiteBallHandle id={`${id}-c`} type="source" sourceNodeId={id} isConnectable={isConnectable}  position={Position.Bottom}  />
            <WhiteBallHandle id={`${id}-d`} type="source" sourceNodeId={id}
            isConnectable={isConnectable} 
            position={Position.Left}  />
              <Handle
            id={`${id}-a`}
            type="target"
            position={Position.Top}
            style={{
              position: "absolute",
              width: "calc(100%)",
              height: "calc(100%)",
              top: "0",
              left: "0",
              borderRadius: "0",
              transform: "translate(0px, 0px)",
              background: "transparent",
              // border: isActivated ? "1px solid #4599DF" : "none",
              border: "3px solid transparent",
              zIndex: !isOnConnect ? "-1" : "1",
              // maybe consider about using stored isActivated
            }}
          isConnectable={isConnectable}
          onMouseEnter={() => setIsTargetHandleTouched(true)}
          onMouseLeave={() => setIsTargetHandleTouched(false)}
        />
        <Handle
            id={`${id}-b`}
            type="target"
            position={Position.Right}
            style={{
              position: "absolute",
              width: "calc(100%)",
              height: "calc(100%)",
              top: "0",
              left: "0",
              borderRadius: "0",
              transform: "translate(0px, 0px)",
              background: "transparent",
              // border: isActivated ? "1px solid #4599DF" : "none",
              border: "3px solid transparent",
              zIndex: !isOnConnect ? "-1" : "1",
              // maybe consider about using stored isActivated
            }}
          isConnectable={isConnectable}
          onMouseEnter={() => setIsTargetHandleTouched(true)}
          onMouseLeave={() => setIsTargetHandleTouched(false)}
        />
        <Handle
            id={`${id}-c`}
            type="target"
            position={Position.Bottom}
            style={{
              position: "absolute",
              width: "calc(100%)",
              height: "calc(100%)",
              top: "0",
              left: "0",
              borderRadius: "0",
              transform: "translate(0px, 0px)",
              background: "transparent",
              // border: isActivated ? "1px solid #4599DF" : "none",
              border: "3px solid transparent",
              zIndex: !isOnConnect ? "-1" : "1",
              // maybe consider about using stored isActivated
            }}
          isConnectable={isConnectable}
          onMouseEnter={() => setIsTargetHandleTouched(true)}
          onMouseLeave={() => setIsTargetHandleTouched(false)}
        />
        <Handle
            id={`${id}-d`}
            type="target"
            position={Position.Left}
            style={{
              position: "absolute",
              width: "calc(100%)",
              height: "calc(100%)",
              top: "0",
              left: "0",
              borderRadius: "0",
              transform: "translate(0px, 0px)",
              background: "transparent",
              // border: isActivated ? "1px solid #4599DF" : "none",
              border: "3px solid transparent",
              zIndex: !isOnConnect ? "-1" : "1",
              // maybe consider about using stored isActivated
            }}
          isConnectable={isConnectable}
          onMouseEnter={() => setIsTargetHandleTouched(true)}
          onMouseLeave={() => setIsTargetHandleTouched(false)}
        />
       
            
      </div>
      {/* {ReactDOM.createPortal(
            <input
                type="file"
                ref={inputRef}
                onChange={handleFileChange}
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
        )} */}

      {/* 添加 Source 和 Target 面板到组件底部 */}
      {/*
      <div className="absolute left-0 -bottom-[2px] transform translate-y-full w-full flex gap-2 z-10">
        {sourceNodes.length > 0 && (
          <div className="w-[48%] bg-[#101010] rounded-lg border border-[#333333] p-1.5 shadow-lg">
            <div className="text-xs text-[#A4C8F0] font-semibold pb-1 mb-1">
              Source Nodes
            </div>
            <div className="flex flex-wrap gap-1.5">
              {displaySourceNodeLabels()}
            </div>
          </div>
        )}

        {targetNodes.length > 0 && (
          <div className="w-[48%] ml-auto bg-[#101010] rounded-lg border border-[#333333] p-1.5 shadow-lg">
            <div className="text-xs text-[#A4C8F0] font-semibold pb-1 mb-1">
              Target Nodes
            </div>
            <div className="flex flex-wrap gap-1.5">
              {displayTargetNodeLabels()}
            </div>
          </div>
        )}
      </div>
      */}
    </div>
      

  )
}

export default FileNode