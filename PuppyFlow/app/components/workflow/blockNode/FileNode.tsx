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
import { WarnsContext } from '../../states/WarnMessageContext';
import { uploadFiles } from '@/app/utils/uploadthing'
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

  useEffect(() => {
    console.log(activatedNode, isOnConnect, isTargetHandleTouched, "border color")
    if (activatedNode?.id === id) {
      setBorderColor("border-main-blue");
  } else {
      setBorderColor(isOnConnect && isTargetHandleTouched ? "border-main-orange" : "border-main-deep-grey");
     
    }
  }, [activatedNode, isOnConnect, isTargetHandleTouched])
 

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

   // for rendering different background color of upper right tag
   const renderTagStyle = () => {
    if (locked) return "bg-[#3EDBC9] w-fit"
    else if (isInput) return "bg-[#6C98D5] w-fit"
    else if (isOutput) return "bg-[#FF9267] w-fit"
    else return "border-[#6D7177] bg-[#6D7177] w-fit"
  } 

  // for rendering diffent logo of upper right tag
  const renderTagLogo = () => {
    if (locked) return (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="6" y="12" width="12" height="7" fill="#3EDBC9" />
        <rect x="8" y="6" width="8" height="11" rx="4" stroke="#3EDBC9" stroke-width="2" />
      </svg>
    )
    else if (isInput) return (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M9.5 14V10L12.1667 12L9.5 14Z" fill="#6C98D5" stroke="#6C98D5" />
        <path d="M10 11.9961L5 12.001" stroke="#6C98D5" stroke-width="2" />
        <path d="M14.5 7H10.5V5.5H16.5V18.5H10.5V17H14.5H15V16.5V7.5V7H14.5Z" fill="#6C98D5" stroke="#6C98D5" />
      </svg>
    )
    else if (isOutput) return (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M13.5 14V10L16.1667 12L13.5 14Z" fill="#FF9267" stroke="#FF9267" />
        <path d="M14 11.9961L9 12.001" stroke="#FF9267" stroke-width="2" />
        <path d="M7.5 7H11.5V5.5H5.5V18.5H11.5V17H7.5H7V16.5V7.5V7H7.5Z" fill="#FF9267" stroke="#FF9267" />
      </svg>
    )
    else return (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="group">
        <path d="M4 6H10L12 8H20V18H4V6Z" className="fill-transparent stroke-[#6D7177] group-hover:stroke-[#CDCDCD] group-active:stroke-[#4599DF]" strokeWidth="1.5"/>
        <path d="M8 13.5H16" className="stroke-[#6D7177] group-hover:stroke-[#CDCDCD] group-active:stroke-[#4599DF]" strokeWidth="1.5" strokeLinecap="round"/>
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
        if (isInput || isOutput || locked) {
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
          if (isInput || isOutput || locked) {
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
      const file = event.target.files?.[0];
      if (!file) return;

      setIsOnUploading(true)

      // 获取文件扩展名
      const fileName = file.name;
      const fileExtension = fileName.substring(fileName.lastIndexOf('.') + 1);


      try {
          // Step 1: 获取预签名URL和UUID, userid = Rose123
          // data = await request.json()
          // user_id = data.get("user_id", "Rose123")
          // content_name = data.get("content_name", "new_content")
          
          // Get file extension
          const fileName = file.name;
          let fileExtension = fileName.substring(fileName.lastIndexOf('.') + 1);
          const supportedFileExtensions = ["json", "txt", "html", "css", "js", "png", "jpg", "gif", "svg", "mp3", "wav", "mp4", "webm", "pdf", "zip", "application"]

          if (!supportedFileExtensions.includes(fileExtension)) {
            fileExtension = "application"
          }
          if(fileExtension === "txt") {
            fileExtension = "text"
          }
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

        //   return JSONResponse(
        //     content={
        //         "upload_url": upload_url,
        //         "download_url": download_url,
        //         "content_id": content_id,
        //         "content_type_header": content_type_header,
        //         "expires_at": {
        //             "upload": int(time.time()) + 300,
        //             "download": int(time.time()) + 86400
        //         }
        //     }, 
        //     status_code=200
        // )
        //above is the response from the python fastapi server,below is the reading of response from the python fastapi server

        
          if (!response.ok) {
            setWarns((prev: string[])=>[...prev,{time:Date.now(),text:`Fetch temporary upload info Error: ${response.status}`}])
            throw new Error(`Fetch temporary upload info Error: ${response.status}`)
          }
        
          const data = await response.json()
          console.log(data)
          const upload_url = data.upload_url
          const download_url = data.download_url
          const content_id = data.content_id
          const content_type_header = data.content_type_header
          const expires_at = data.expires_at
          // const { presigned_url, task_id } = await response.json(); //deprecated
          
          // Step 2: 上传文件到S3
          const uploadResponse = await fetch(upload_url, {
            method: 'PUT',
            headers: {
              'Content-Type': file.type,
              // 'x-amz-meta-uuid': task_id, // 保存UUID到metadata
            },
            body: file,
          });
          
          setIsOnUploading(false)

          if (uploadResponse.ok) {
              console.log('文件上传成功');
              saveFileInformation(fileName, download_url, content_id, fileExtension, content_type_header, expires_at)
              // 在这里可以将UUID保存到block的content
          } else {
              console.log(response)
              console.error('文件上传失败');
              setWarns((prev: string[])=>[...prev,{time:Date.now(),text:'fail to upload file'}])
          }
        } catch (error) {
            console.error('上传过程中发生错误', error);
        }
    };

        // New handleDrop function to process dropped files
        const handleDrop = async (files: FileList) => {
          if (!files || files.length === 0) return;

          setIsOnUploading(true)
          
          // Process the first file (or could loop through all files)
          const file = files[0];
          
          // Get file extension
          const fileName = file.name;
          let fileExtension = fileName.substring(fileName.lastIndexOf('.') + 1);

          // txt
          // html
          // css
          // js
          // json
          // png
          // jpg
          // gif
          // svg
          // mp3
          // wav
          // mp4
          // webm
          // pdf
          // zip
          // application
          const supportedFileExtensions = ["json", "txt", "html", "css", "js", "png", "jpg", "gif", "svg", "mp3", "wav", "mp4", "webm", "pdf", "zip", "application"]

          if (!supportedFileExtensions.includes(fileExtension)) {
            fileExtension = "application"
          }
          if(fileExtension === "txt") {
            fileExtension = "text"
          }
    
          try {
              // Step 1: Get presigned URL and UUID, userid = Rose123
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
                setWarns((prev: string[])=>[...prev,{time:Date.now(),text:`Fetch temporary upload info Error: ${response.status}`}])
                throw new Error(`Fetch temporary upload info Error: ${response.status}`);
              }
              
              const data = await response.json()
              console.log(data)
              const upload_url = data.upload_url
              const download_url = data.download_url
              const content_id = data.content_id
              const content_type_header = data.content_type_header
              const expires_at = data.expires_at
              
              // Step 2: Upload file to S3
              const uploadResponse = await fetch(upload_url, {
                method: 'PUT',
                headers: {
                  'Content-Type': file.type,
                  // 'x-amz-meta-uuid': task_id, // Save UUID to metadata
                },
                body: file,
              });
              
              
              setIsOnUploading(false)

              if (uploadResponse.ok) {
                  console.log('File upload successful');
                  saveFileInformation(fileName, download_url, content_id, fileExtension, content_type_header, expires_at);
                  // Here you can save the UUID to the block's content
              } else {
                  console.log(response);
                  console.error('File upload failed');
                  setWarns((prev: string[])=>[...prev,{time:Date.now(),text:'fail to upload file'}])
              }
          } catch (error) {
              console.error('Error during upload process', error);
              setWarns((prev: string[])=>[...prev,{time:Date.now(),text:'fail to upload file'}])
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


    const handleDelete = (file:string, index:number) => {
      setNodes(prevNodes => prevNodes.map(node => {
        if (node.id === id) {
            return { ...node, data: { ...node.data, content: uploadedFiles.filter((_: {fileName:string, task_id: string, fileType: string}, i: number) => i !== index)} }
        }
        return node
    }))
    }

  return (
    <div ref={componentRef} className={`relative w-full h-full min-w-[144px] min-h-[144px]  ${isOnGeneratingNewNode ? 'cursor-crosshair' : 'cursor-default'}`}>
      <div id={id} ref={contentRef}
        className={`flex flex-col w-full h-full border-[1.5px] ${
          content 
            ? "border-solid border-[1.5px]" 
            : "border-dashed border-[1.5px]"
        } min-w-[144px] min-h-[144px] p-[8px] rounded-[16px] flex justify-start ${borderColor} text-[#CDCDCD] bg-main-black-theme break-words font-plus-jakarta-sans text-base leading-5 font-[400] overflow-hidden`}>
          
        {/* the top bar of a block */}
        <div ref={labelContainerRef} 
          className={`h-[24px] w-full max-w-full rounded-[4px]  flex items-center justify-between mb-2`}>
          
          {/* top-left wrapper */}
          <div className="flex items-center gap-[8px]"
            style={{
              maxWidth: calculateMaxLabelContainerWidth(),
            }}>
            <div className="min-w-[20px] min-h-[24px] flex items-center justify-center">
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
            
            <input ref={labelRef} 
              autoFocus={editable} 
              className={`flex items-center justify-start text-[#6D7177] font-[700] text-[12px] leading-[18px] font-plus-jakarta-sans bg-transparent h-[18px] focus:outline-none`}
              style={{
                boxSizing: "content-box",
                width: calculateInputWidth(),
                maxWidth: `calc(${calculateMaxLabelContainerWidth()} - 16px)`,
              }}
              size={nodeLabel.length ?? 0}
              value={`${nodeLabel}`} 
              readOnly={!editable} 
              onChange={EditLabel} 
              onMouseDownCapture={onFocus} 
              onBlur={onBlur} 
            />
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

        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="13" viewBox="0 0 14 13" fill="none" className='fixed bottom-[8px] left-[8px] m-[8px]'>
          <path d="M0.5 0.5H8.87821L13.2838 12.5H0.5V0.5Z" stroke="#6D7177"/>
          <rect x="0.5" y="3.38916" width="13" height="9.11111"  stroke="#6D7177"/>
        </svg>

        <NodeResizeControl
          minWidth={240}
          minHeight={280}
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
            <svg width="26" height="26" viewBox="0 0 26 26" fill="none" xmlns="http://www.w3.org/2000/svg" className="group active:group-[]:fill-[#4599DF]">
              <path d="M10 5.99998H12V7.99998H10V5.99998Z" className="fill-[#6D7177] group-hover:fill-[#CDCDCD] group-active:fill-[#4599DF]" />
              <path d="M10 2H12V4H10V2Z" className="fill-[#6D7177] group-hover:fill-[#CDCDCD] group-active:fill-[#4599DF]" />
              <path d="M6 5.99998H8V7.99998H6V5.99998Z" className="fill-[#6D7177] group-hover:fill-[#CDCDCD] group-active:fill-[#4599DF]" />
              <path d="M6 10H8V12H6V10Z" className="fill-[#6D7177] group-hover:fill-[#CDCDCD] group-active:fill-[#4599DF]" />
              <path d="M2 10H4V12H2V10Z" className="fill-[#6D7177] group-hover:fill-[#CDCDCD] group-active:fill-[#4599DF]" />
              <path d="M10 10H12V12H10V10Z" className="fill-[#6D7177] group-hover:fill-[#CDCDCD] group-active:fill-[#4599DF]" />
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
    </div>
      

  )
}

export default FileNode