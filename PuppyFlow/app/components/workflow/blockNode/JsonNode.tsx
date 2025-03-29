'use client'
import { NodeProps, Node, Handle, Position, useReactFlow, NodeResizeControl } from '@xyflow/react'
import React, { useRef, useEffect, useState, ReactElement, Fragment } from 'react'
// import { nodeState, useNodeContext } from '../../states/NodeContext'
import { useNodesPerFlowContext } from '../../states/NodesPerFlowContext'
import WhiteBallHandle from '../handles/WhiteBallHandle'
import JSONForm from '../../tableComponent/JSONForm'
import NodeToolBar from './nodeTopRightBar/NodeTopRightBar'
import SkeletonLoadingIcon from '../../loadingIcon/SkeletonLoadingIcon'
import { json } from 'stream/consumers'
import { get, set } from 'lodash'
import { PuppyStorage_IP_address_for_embedding } from '../../hooks/useJsonConstructUtils'
import useJsonConstructUtils from '../../hooks/useJsonConstructUtils'
import { Transition } from '@headlessui/react'
import useManageUserWorkspacesUtils from '../../hooks/useManageUserWorkSpacesUtils'
import { useFlowsPerUserContext } from "../../states/FlowsPerUserContext"

type methodNames = "cosine"
type modelNames = "text-embedding-ada-002"
type vdb_typeNames = "pgvector"

// 添加这个类型定义
type VectorIndexingStatus = 'notStarted' | 'processing' | 'completed';

export type JsonNodeData = {
  content: string,
  label: string,
  isLoading: boolean,
  locked: boolean,
  isInput: boolean,
  isOutput: boolean,
  editable: boolean,
  // embedding configurations
  model?: modelNames | undefined,
  method?: methodNames | undefined,
  vdb_type?: vdb_typeNames | undefined,
  index_name?: string | undefined, // 用于存储embedding 的index_name
}


type JsonBlockNodeProps = NodeProps<Node<JsonNodeData>>

function JsonBlockNode({ isConnectable, id, type, data: { content, label, isLoading, locked, isInput, isOutput, editable, index_name } }: JsonBlockNodeProps) {
  const { fetchUserId } = useManageUserWorkspacesUtils()
  const { userId } = useFlowsPerUserContext()

  type ExtendedNode = Node<JsonNodeData> & { looped?: boolean };
  // selectHandle = 1: TOP, 2: RIGHT, 3: BOTTOM, 4: LEFT. 
  // Initialization: 0
  // const [selectedHandle, setSelectedHandle] = useState<Position | null>(null)
  const { activatedNode, isOnConnect, isOnGeneratingNewNode, setNodeUneditable, editNodeLabel, preventInactivateNode, allowInactivateNodeWhenClickOutside, clearAll } = useNodesPerFlowContext()
  const { setNodes, setEdges, getEdges, getNode } = useReactFlow()
  // for linking to handle bar, it will be highlighed.
  const [isTargetHandleTouched, setIsTargetHandleTouched] = useState(false)
  const componentRef = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const [contentSize, setContentSize] = useState({ width: 0, height: 0 })
  const labelContainerRef = useRef<HTMLDivElement | null>(null)
  const labelRef = useRef<HTMLInputElement | null>(null)
  const [nodeLabel, setNodeLabel] = useState(label ?? id)
  const [isLocalEdit, setIsLocalEdit] = useState(false); //使用 isLocalEdit 标志来区分本地编辑和外部更新。只有内部编辑：才能触发 更新 data.label, 只有外部更新才能触发 更新 nodeLabel
  const [isEditing, setIsEditing] = useState(false)
  const [borderColor, setBorderColor] = useState("border-main-deep-grey")
  const [vectorIndexingStatus, setVectorIndexingStatus] = useState<VectorIndexingStatus>('notStarted');
  const { cleanJsonString } = useJsonConstructUtils()
  const [isLooped, setIsLooped] = useState<boolean>((getNode(id) as ExtendedNode)?.looped || false); // New state to track the position



  useEffect(() => {
    if (activatedNode?.id === id) {
      setBorderColor("border-[#9B7EDB]");
    } else if (locked) {
      setBorderColor("border-[#3EDBC9]");
    } else if (isInput) {
      setBorderColor("border-[#84EB89]");
    } else if (isOutput) {
      setBorderColor("border-[#FF9267]");
    } else {
      setBorderColor(isOnConnect && isTargetHandleTouched ? "border-main-orange" : "border-main-deep-grey");
    }
  }, [activatedNode, isOnConnect, isTargetHandleTouched, locked, isInput, isOutput, id])

  useEffect(() => {
    if (!contentRef.current) return;

    const resizeObserver = new ResizeObserver(entries => {
      for (let entry of entries) {
        const { width, height } = entry.contentRect;
        setContentSize({ width, height });
      }
    });

    resizeObserver.observe(contentRef.current);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  // 管理labelContainer的宽度
  useEffect(() => {
    // const onLabelContainerFocus = () => {
    //   if (labelContainerRef.current) {
    //     if (contentRef.current) {
    //       labelContainerRef.current.style.width = `${contentRef.current.clientWidth - 16}px`
    //     }
    //   }
    // }

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
    const currentLabel = getNode(id)?.data?.label as string | undefined
    if (currentLabel !== undefined && currentLabel !== nodeLabel && !isLocalEdit) {

      setNodeLabel(currentLabel)
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
    if (isLocalEdit) {
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
        <path d="M8 6.5V5H4V7.5V16.5V19H8V17.5H5.5V6.5H8Z" className="fill-[#B0A4E3] group-active:fill-[#9B7EDB]" />
        <path d="M16 6.5V5H20V7.5V16.5V19H16V17.5H18.5V6.5H16Z" className="fill-[#B0A4E3] group-active:fill-[#9B7EDB]" />
        <path d="M9 9H11V11H9V9Z" className="fill-[#B0A4E3] group-active:fill-[#9B7EDB]" />
        <path d="M9 13H11V15H9V13Z" className="fill-[#B0A4E3] group-active:fill-[#9B7EDB]" />
        <path d="M13 9H15V11H13V9Z" className="fill-[#B0A4E3] group-active:fill-[#9B7EDB]" />
        <path d="M13 13H15V15H13V13Z" className="fill-[#B0A4E3] group-active:fill-[#9B7EDB]" />
      </svg>
    )
  }

  const EditLabel = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (labelRef.current) {
      setIsLocalEdit(true)
      setNodeLabel(labelRef.current.value)
    }
  }

  // 计算 labelContainer 的 最大宽度，最大宽度是由外部的container 的宽度决定的，同时需要减去 32px, 因为右边有一个menuIcon, 需要 - 他的宽度和右边的padding
  const calculateMaxLabelContainerWidth = () => {
    if (contentRef.current) {
      return `${contentRef.current.clientWidth - 32}px`
    }
    return '100%'
  }

  const calculateMaxLabelContainerWidthN = () => {
    if (contentRef.current) {
      return `${contentRef.current.clientWidth - 15.6}px`
    }
    return '100%'
  }

  // height by default: 304px, inner-box: 240px, resize-control: 304px, without embedding
  // height with embedding: 336px, inner-box: 272px, resize-control: 336px


  const [userInput, setUserInput] = useState<string | undefined>("input view")

  // TODO Auto resize of content box
  // TODO dialogue selection of content atttribute(key onl y, no index) 
  // embeding view switch button
  const [showSettingMenu, setShowSettingMenu] = useState(false)
  const handleInputViewClick = () => {
    setVectorIndexingStatus('notStarted');
  };

  const handleEmbedViewClick = () => {
    console.log(getNode(id)?.data?.content)
    if (vectorIndexingStatus === 'completed') {
      setShowSettingMenu((showSettingMenu) => !showSettingMenu)
    } else if (vectorIndexingStatus === 'notStarted') {
      setVectorIndexingStatus('processing')
    }
  };


  useEffect(() => {
    if (vectorIndexingStatus !== 'notStarted') {

    } else {
      setShowSettingMenu(false)
    }
  }, [vectorIndexingStatus])

  const handleAddTagPage = async () => {
    setVectorIndexingStatus('processing')
    const response = await onEmbeddingClick()
    if (response == undefined) {
      //retry
      await onEmbeddingClick()
    }
    setTimeout(() => {
      const newnode = getNode(id)
      if (newnode?.data.index_name) {
        setVectorIndexingStatus('completed')
      }
    }, 600);
  }

  interface EmbeddingItem {
    content: string;
    metadata: {
      id?: string;
      [key: string]: any;
    }
  }
  function traverseJson(
    data: any,
    result: EmbeddingItem[] = [],
    path: string[] = [],
    idCounter: { value: number } = { value: 0 }
  ): EmbeddingItem[] {
    if (typeof data === 'string') {
      // We found a leaf string, create an embedding item
      const metadata: Record<string, any> = {
        id: String(idCounter.value++)
      };

      // Convert path to metadata keys
      path.forEach((step, index) => {
        if (step.startsWith('key_')) {
          metadata[`key_${index}`] = step.substring(4);
        } else if (step.startsWith('list_')) {
          metadata[`list_${index}`] = parseInt(step.substring(5));
        }
      });

      path.forEach((step, _) => {
        if (step.startsWith('key_')) {
          if (!metadata.path) {
            metadata.path = []
          }
          metadata[`path`].push(step.substring(4));
        } else if (step.startsWith('list_')) {
          if (!metadata.path) {
            metadata.path = []
          }
          metadata[`path`].push(parseInt(step.substring(5)));
        }
      });

      result.push({
        content: data,
        metadata: metadata
      });
    }
    else if (Array.isArray(data)) {
      // Traverse each array element
      data.forEach((item, index) => {
        traverseJson(item, result, [...path, `list_${index}`], idCounter);
      });
    }
    else if (data && typeof data === 'object') {
      // Traverse each object property
      Object.entries(data).forEach(([key, value]) => {
        traverseJson(value, result, [...path, `key_${key}`], idCounter);
      });
    }

    return result;
  }

  function removeItemFromData(data: any, path: (string | number)[]) {
    //remove the item content itself from data according to path
    /**
     * example:
     * data:
    {
      "name": "John",
      "details": {
        "hobbies": [
          "reading",
          "gaming"
        ],
        "address": {
          "street": "123 Main St",
          "city": "Springfield"
        }
      }
    }
    path: ["details", "hobbies", "0"]
    result:
    {
      "name": "John",
      "details": {
        "hobbies": [
          "gaming"
        ],
        "address": {
          "street": "123 Main St",
          "city": "Springfield"
        }
      }
    }
      * 
      */
    if (!path) return data;
    if (path.length === 0) return data;

    const clone = JSON.parse(JSON.stringify(data));
    let current = clone;
    if (Array.isArray(current) && path.length === 1) {
      return []
    }
    if (path.length === 1) {
      delete current[path[path.length - 1]];
      return clone
    }

    for (let i = 0; i < path.length - 2; i++) {
      current = current[path[i]];
    }
    console.log("current", current)

    const secondLastKey = path[path.length - 2];
    const lastKey = path[path.length - 1];
    if (!isNaN(Number(lastKey))) {
      if (Array.isArray(current)) {
        current.splice(Number(secondLastKey), 1);
      } else {
        delete current[secondLastKey];
      }
      console.log("current1", current)
    } else {
      console.log(secondLastKey)
      console.log("current2", current)
      current = current[secondLastKey]
      delete current[lastKey];
      console.log("current3", current)
    }
    console.log(clone)
    return clone;
  }

  const constructMetadataInfo = (data: any, embeddingViewData: EmbeddingItem[]) => {

    embeddingViewData.forEach((item, index) => {
      if (item.metadata.path) {
        // then append modified data to EmbeddingItem
        const path = item.metadata.path
        const result = removeItemFromData(data, path)
        item.metadata.info = result

      }
    })

    return embeddingViewData
  }

  const getNodePromise = (id: string): any => {
    return new Promise((resolve) => {
      setTimeout(() => {
        const node = getNode(id);
        resolve(node);
      }, 0);
    });
  };


  const constructStructuredNodeEmbeddingData = async () => {

    const node = await getNodePromise(id);

    const nodeContent = (node?.type === "structured" || node?.type === "none" && node?.data?.subType === "structured") ? cleanJsonString(node?.data.content as string | any) : node?.data.content as string

    if (nodeContent === "error") return "error"
    const embeddingData = {
      ...node?.data,
      content: nodeContent,
      vdb_type: "pgvector",
      model: "text-embedding-ada-002",
      method: "cosine",
    }
    const embeddingNode = {
      ...node,
      data: embeddingData,
    }
    return embeddingNode
  }

  const onEmbeddingClick = async () => {
    /**
     * 1. clear menu
     * 2. construct embeddingNodeData
     * 3. construct embeddingViewData
     * 4. setNodes
     */


    // 2. construct embeddingNodeData
    try {

      const embeddingNodeData = await constructStructuredNodeEmbeddingData()
      console.log("embeddingnode data", embeddingNodeData)

      if (embeddingNodeData === "error") {
        throw new Error("Invalid node data")
      }


      const embeddingViewData = traverseJson(embeddingNodeData.data.content)

      const embeddingViewDataWithInfo = constructMetadataInfo(embeddingNodeData.data.content, embeddingViewData)
      console.log(embeddingViewData)
      console.log(embeddingViewDataWithInfo)

      setNodes(prevNodes => prevNodes.map(
        (node) => {
          if (node.id === id) {
            return { ...node, data: { ...node.data, chunks: embeddingViewDataWithInfo } }
          }
          return node
        }
      ))

      const getuserid = async (): Promise<string | null> => {
        if (!userId || userId.trim() === "") {
          return null
        }
        return userId
      }

      const transformPayload = async (originalPayload: any) => {
        console.log("originalPayload", originalPayload)
        return {
          chunks: originalPayload.data.chunks,
          create_new: true, // Indicates that a new entry is being created
          vdb_type: originalPayload.data.vdb_type,
          model: originalPayload.data.model,
          method: originalPayload.data.method,
          user_id: await getuserid()
        };
      };

      const payloaddata = await transformPayload(embeddingNodeData)

      console.log("payload", payloaddata)

      if (payloaddata.chunks == undefined) {
        setVectorIndexingStatus('notStarted')
        return undefined
      }

      // Make sure to await the transformPayload call
      const response = await fetch(`${PuppyStorage_IP_address_for_embedding}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payloaddata)
      })

      if (!response.ok) {
        setVectorIndexingStatus('notStarted')
        throw new Error(`HTTP Error: ${response.status}`)
      }

      // // 5. updateNode
      const index_name_response = await response.json()
      if (typeof index_name_response === 'string') {
        setNodes(prevNodes => prevNodes.map(node => node.id === id ? {
          ...node,
          data: {
            ...node.data,
            index_name: index_name_response,
            collection_configs: {
              model: payloaddata.model,
              method: payloaddata.method,
              vdb_type: payloaddata.vdb_type,
              collection_name: index_name_response
            },
          }
        } : node))

        // 确保嵌入状态保持
        setVectorIndexingStatus('completed')

        setTimeout(() => {
          const newnode = getNode(id)
          console.log("updated json node status after received index_name", newnode)
        }, 1200);

      }

    } catch (error) {
      console.error("Error fetching embedding:", error);
      setVectorIndexingStatus('notStarted')
    } finally {
      clearAll()
    }
  }

  useEffect(
    () => {
      console.log("setisloop step2 onchange", isLooped)

      setNodes(prevNodes => prevNodes.map(
        (node) => {
          if (node.id === id) {
            return { ...node, looped: isLooped }
          }
          return node
        }
      ))

      setTimeout(
        () => {
          console.log("setislooped step3 finish", getNode(id))
        },
        2000
      )

    }
    , [isLooped]
  )

  useEffect(
    () => {
      console.log("jsonndoe isloading", isLoading)
    }
    , []
  )

  useEffect(
    () => {

    }, []
  )


  return (
    <div ref={componentRef} className={`relative w-full h-full min-w-[240px] min-h-[176px] ${isOnGeneratingNewNode ? 'cursor-crosshair' : 'cursor-default'}`}>
      {/* Add tags for input, output and locked states */}
      <div className="absolute -top-[28px] h-[24px] left-0 z-10 flex gap-1.5">
        {isInput && (
          <div className="px-2 py-0.5 rounded-[8px] flex items-center gap-1 text-[10px] font-bold bg-[#84EB89] text-black">
            <svg width="16" height="16" viewBox="0 0 26 26" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="16" y="7" width="3" height="12" rx="1" fill="currentColor"/>
              <path d="M5 13H14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
              <path d="M10 9L14 13L10 17" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <span>INPUT</span>
          </div>
        )}
        
        {isOutput && (
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

      <div ref={contentRef} id={id} className={`w-full h-full min-w-[240px] min-h-[176px] border-[1.5px] rounded-[16px] px-[8px] pt-[8px] pb-[8px] ${borderColor} text-[#CDCDCD] bg-main-black-theme break-words font-plus-jakarta-sans text-base leading-5 font-[400] overflow-hidden`}>


        {/* the top bar of a block */}
        <div ref={labelContainerRef}
          className={`h-[24px] w-full max-w-full rounded-[4px] flex items-center justify-between mb-2`}>

          {/* top-left wrapper */}
          <div className="flex items-center gap-[8px] hover:cursor-grab active:cursor-grabbing group"
            style={{
              maxWidth: `calc(${calculateMaxLabelContainerWidth()} - 44px)`,
            }}>
            <div className="min-w-[20px] min-h-[24px] flex items-center justify-center group-hover:text-[#CDCDCD] group-active:text-[#9B7EDB]">
              {renderTagLogo()}
            </div>

            {editable ? (
              <input
                ref={labelRef}
                className={`
                  flex items-center justify-start 
                  font-[600] text-[12px] leading-[18px] 
                  font-plus-jakarta-sans bg-transparent h-[18px] 
                  focus:outline-none truncate text-[#6D7177] group-hover:text-[#CDCDCD] group-active:text-[#9B7EDB]
                  w-full
                `}
                value={nodeLabel}
                onChange={(e) => {
                  setIsLocalEdit(true);
                  setNodeLabel(e.target.value);
                }}
                onFocus={() => {
                  setIsEditing(true);
                  onFocus();
                }}
                onBlur={() => {
                  setIsEditing(false);
                  if (isLocalEdit) {
                    editNodeLabel(id, nodeLabel);
                    setIsLocalEdit(false);
                  }
                  onBlur();
                }}
              />
            ) : (
              <span
                className={`
                  flex items-center justify-start 
                  font-[600] text-[12px] leading-[18px] 
                  font-plus-jakarta-sans truncate text-[#6D7177] group-hover:text-[#CDCDCD] group-active:text-[#9B7EDB]
                `}
              >
                {nodeLabel}
              </span>
            )}
          </div>

          {/* top-right toolbar */}
          <div className="min-w-[60px] min-h-[24px] flex items-center justify-end gap-[8px]">
            {/* NodeToolBar */}
            <NodeToolBar Parentnodeid={id} ParentNodetype={type} />





            {/*View Mode Switching Bar at the bottom*/}
            <div className={`cursor-pointer flex justify-center items-center w-[24px] h-[24px] rounded-[8px] hover:bg-[#3E3E41] ${vectorIndexingStatus !== 'notStarted' ? 'opacity-100' : (activatedNode?.id === id ? 'opacity-100' : 'opacity-0')}`}>

              {vectorIndexingStatus !== 'notStarted' ?

                <div>
                  <button style={{
                    paddingTop: '1px',
                    cursor: 'pointer',
                  }}
                    className={`h-[24px] w-[24px] text-[12px] text-[#A4A4A4] font-semibold flex items-center justify-center gap-[8px]`}
                    onClick={handleEmbedViewClick}
                  >
                    {vectorIndexingStatus === 'processing' ? (
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 16 16"
                        fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                        style={{
                          animation: "rotate 1.5s linear infinite",
                        }}
                      >
                        <style>
                          {`
                            @keyframes rotate {
                              from {
                                transform: rotate(0deg);
                              }
                              to {
                                transform: rotate(360deg);
                              }
                            }
                          `}
                        </style>
                        <circle cx="8" cy="8" r="7" stroke="#CDCDCD" strokeWidth="1.5" strokeOpacity="0.2" />
                        <path
                          d="M8 1A7 7 0 0 1 15 8"
                          stroke="#CDCDCD"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                        />
                      </svg>
                    ) : (
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <rect x="2" y="2" width="12" height="12" rx="3" stroke="#FF6B00" strokeWidth="1.5" fill="none" />
                        <text x="8" y="11.5" fontFamily="Arial" fontSize="9" fontWeight="bold" fill="#FF6B00" textAnchor="middle">I</text>
                        <line x1="5.5" y1="5" x2="10.5" y2="5" stroke="#FF6B00" strokeWidth="1.5" />
                        <line x1="5.5" y1="11" x2="10.5" y2="11" stroke="#FF6B00" strokeWidth="1.5" />
                      </svg>
                    )}
                  </button>


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
                    <div style={{ position: "fixed", zIndex: 20000 }}>
                      <ul className='flex flex-col absolute top-[26px] p-[8px] w-[160px] gap-[4px] bg-[#252525] border-[1px] border-[#404040] rounded-[8px] left-[0px] z-[20000]'>
                        <li>
                          <button className='renameButton flex flex-row items-center justify-start gap-[8px] w-full h-[26px] hover:bg-[#3E3E41] rounded-[4px] border-none text-[#CDCDCD] hover:text-white'
                            onClick={
                              async () => {
                                setVectorIndexingStatus('processing')
                                setShowSettingMenu(false)
                                const embeddingNodeData = await constructStructuredNodeEmbeddingData()
                                console.log("embeddingnode data", embeddingNodeData)

                                if (embeddingNodeData === "error") {
                                  throw new Error("Invalid node data")
                                }

                                const embeddingViewData = traverseJson(embeddingNodeData.data.content)

                                const embeddingViewDataWithInfo = constructMetadataInfo(embeddingNodeData.data.content, embeddingViewData)

                                setNodes(prevNodes => prevNodes.map(node => {
                                  if (node.id === id) {
                                    return {
                                      ...node, data: {
                                        ...node.data,
                                        chunks: JSON.stringify(embeddingViewDataWithInfo, null, 2)
                                      }
                                    }
                                  }
                                  return node
                                }))

                                setUserInput("embedding view")
                                const response = await onEmbeddingClick()
                                if (response == undefined) {
                                  //retry
                                  await onEmbeddingClick()
                                }
                                setTimeout(() => {
                                  const newnode = getNode(id)
                                  if (newnode?.data.index_name) {
                                    setVectorIndexingStatus('completed')
                                  }
                                }, 600);
                              }
                            }
                          >
                            <div className='renameButton flex items-center justify-center'>
                              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M12 8H12.2C13.8802 8 14.7202 8 15.362 8.32698C15.9265 8.6146 16.3854 9.07354 16.673 9.63803C17 10.2798 17 11.1198 17 12.8V16" stroke="#6D7177" stroke-width="1.5" />
                                <path d="M12 16H11.8C10.1198 16 9.27976 16 8.63803 15.673C8.07354 15.3854 7.6146 14.9265 7.32698 14.362C7 13.7202 7 12.8802 7 11.2V8" stroke="#6D7177" stroke-width="1.5" />
                                <path d="M14 13.9998L17.0305 17.0303L20.0609 13.9998" stroke="#6D7177" stroke-width="1.5" />
                                <path d="M10.061 10.0305L7.03058 7L4.00012 10.0305" stroke="#6D7177" stroke-width="1.5" />
                              </svg>
                            </div>
                            <div className='renameButton font-plus-jakarta-sans text-[12px] font-normal leading-normal whitespace-nowrap'>
                              Update
                            </div>
                          </button>
                        </li>
                        <li className='w-full h-[1px] bg-[#404040] my-[2px]'></li>
                        <li>
                          <button className='flex flex-row items-center justify-start gap-[8px] w-full h-[26px] hover:bg-[#3E3E41] rounded-[4px] border-none text-[#F44336] hover:text-[#FF6B64]'
                            onClick={
                              () => {
                                console.log("on embedding tab delete")
                                setVectorIndexingStatus('notStarted')
                              }
                            }
                          >
                            <div className='flex items-center justify-center'>
                              <svg width="26" height="26" viewBox="0 0 26 26" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M19 7L7 19" stroke="currentColor" strokeWidth="2" />
                                <path d="M19 19L7 7" stroke="currentColor" strokeWidth="2" />
                              </svg>
                            </div>
                            <div className='font-plus-jakarta-sans text-[12px] font-normal leading-normal whitespace-nowrap'>
                              Delete
                            </div>
                          </button>
                        </li>
                      </ul>
                    </div>
                  </Transition>
                </div>

                :

                <div
                  onClick={handleAddTagPage}
                  className='cursor-pointer flex justify-center items-center w-[24px] h-[24px] rounded-[8px] hover:bg-[#3E3E41]'
                >
                  <svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg" className="group">
                    <path d="M11 6L11 16" stroke="#6D7177" strokeWidth="1.5" className="group-hover:stroke-[#CDCDCD] group-active:stroke-[#9B7EDB]" />
                    <path d="M6 11L16 10.9839" stroke="#6D7177" strokeWidth="1.5" className="group-hover:stroke-[#CDCDCD] group-active:stroke-[#9B7EDB]" />
                  </svg>
                </div>

              }

            </div>






            {/* Loop Button */}
            <div
              className={`flex items-center justify-center min-w-[24px] min-h-[24px] rounded-[8px] cursor-pointer ${(activatedNode?.id === id || isLooped) ? 'opacity-100' : 'opacity-0'} hover:bg-[#3E3E41]`}
              onClick={() => {
                setIsLooped(prev => {
                  console.log("setislooped step1 click", !prev)
                  return !prev
                })
              }}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" className="group">
                <path
                  d="M10.0661 3.52107C12.3186 4.57139 13.2931 7.24881 12.2427 9.50124C11.1924 11.7537 8.51501 12.7282 6.26258 11.6778C4.92078 11.0521 4.00446 9.95798 3.67606 8.70632"
                  stroke={isLooped ? "#39BC66" : "#6D7177"}
                  strokeWidth="1.5"
                  strokeLinecap="square"
                  className={isLooped ? "" : "group-hover:stroke-[#CDCDCD] group-active:stroke-[#9B7EDB]"}
                />
                <path
                  d="M2.5 10L3.5 8L5.5 8.5"
                  stroke={isLooped ? "#39BC66" : "#6D7177"}
                  strokeWidth="1.5"
                  strokeLinecap="square"
                  className={isLooped ? "" : "group-hover:stroke-[#CDCDCD] group-active:stroke-[#9B7EDB]"}
                />
              </svg>
            </div>


          </div>
        </div>

        {/* JSON Editor */}
        {isLoading ? <SkeletonLoadingIcon /> :
          <div className={`rounded-[8px] ${borderColor} border-[1px]`}
            style={{
              border: "1px solid rgba(109, 113, 119, 0.5)",
              background: "linear-gradient(180deg, #1E2025 0%, #1A1B1F 100%)",
              boxShadow: "inset 0px 1px 2px rgba(0, 0, 0, 0.2)",
            }}
          >
            {
              <div style={{
                width: 'fit-content',
                maxWidth: calculateMaxLabelContainerWidth(),
                overflow: "hidden"
              }}>

                <JSONForm preventParentDrag={onFocus} allowParentDrag={onBlur}
                  placeholder='["JSON"]'
                  parentId={id}
                  widthStyle={contentSize.width - 16}
                  heightStyle={contentSize.height - 36}
                  inputvalue={userInput}
                  synced={true}
                />

              </div>
            }


          </div>
        }










        <NodeResizeControl
          minWidth={240}
          minHeight={176}
          style={{
            position: 'absolute', right: "0px", bottom: "0px", cursor: 'se-resize',
            background: 'transparent',
            border: 'none',
            display: isLoading ? "none" : "flex"
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
            <svg width="26" height="26" viewBox="0 0 26 26" fill="none" xmlns="http://www.w3.org/2000/svg" className="group active:group-[]:fill-[#9B7EDB]">
              <path d="M10 5.99998H12V7.99998H10V5.99998Z" className="fill-[#6D7177] group-hover:fill-[#CDCDCD] group-active:fill-[#9B7EDB]" />
              <path d="M10 2H12V4H10V2Z" className="fill-[#6D7177] group-hover:fill-[#CDCDCD] group-active:fill-[#9B7EDB]" />
              <path d="M6 5.99998H8V7.99998H6V5.99998Z" className="fill-[#6D7177] group-hover:fill-[#CDCDCD] group-active:fill-[#9B7EDB]" />
              <path d="M6 10H8V12H6V10Z" className="fill-[#6D7177] group-hover:fill-[#CDCDCD] group-active:fill-[#9B7EDB]" />
              <path d="M2 10H4V12H2V10Z" className="fill-[#6D7177] group-hover:fill-[#CDCDCD] group-active:fill-[#9B7EDB]" />
              <path d="M10 10H12V12H10V10Z" className="fill-[#6D7177] group-hover:fill-[#CDCDCD] group-active:fill-[#9B7EDB]" />
            </svg>
          </div>
        </NodeResizeControl>


        {/* {index_name && 
        <div className='absolute bottom-[40px] left-[40px] h-[16px] font-plus-jakarta-sans px-[4px] py-[3px] flex items-center justify-center rounded-[4px] border-[0.5px] border-solid border-[#3E3E41] bg-gradient-to-r from-[#E55D87] to-[#5FC3E4]
         text-main-black-theme text-[8px] font-bold'>Embedded</div>
        } */}

        <WhiteBallHandle id={`${id}-a`} type="source" sourceNodeId={id}
          isConnectable={isConnectable} position={Position.Top} />
        <WhiteBallHandle id={`${id}-b`} type="source" sourceNodeId={id}
          isConnectable={isConnectable}
          position={Position.Right} />
        <WhiteBallHandle id={`${id}-c`} type="source" sourceNodeId={id} isConnectable={isConnectable} position={Position.Bottom} />
        <WhiteBallHandle id={`${id}-d`} type="source" sourceNodeId={id}
          isConnectable={isConnectable}
          position={Position.Left} />
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
    </div >

  )
}

export default JsonBlockNode