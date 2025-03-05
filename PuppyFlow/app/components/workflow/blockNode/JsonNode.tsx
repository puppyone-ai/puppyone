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
import {useFlowsPerUserContext} from "../../states/FlowsPerUserContext"

type methodNames = "cosine"
type modelNames = "text-embedding-ada-002"
type vdb_typeNames = "pgvector"


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
  const {fetchUserId} = useManageUserWorkspacesUtils()
  const {userId} = useFlowsPerUserContext()

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
  const [INPUT_VIEW_MODE, EMBED_VIEW_MODE] = ["input view", "embedding view"]
  const [viewMode, setViewMode] = useState(INPUT_VIEW_MODE); // State for button text
  const [isEmbedHidden, setIsEmbedHidden] = useState(true)
  const { cleanJsonString } = useJsonConstructUtils()
  const [isLooped, setIsLooped] = useState<boolean>((getNode(id) as ExtendedNode)?.looped || false); // New state to track the position



  useEffect(() => {
    // console.log(activatedNode, isOnConnect, isTargetHandleTouched, "border color")
    if (activatedNode?.id === id) {
      setBorderColor("border-main-blue");
    } else {
      setBorderColor(isOnConnect && isTargetHandleTouched ? "border-main-orange" : "border-main-deep-grey");

    }
  }, [activatedNode, isOnConnect, isTargetHandleTouched])


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

      // if (isLocalEdit){
      //   console.log("rename label!!")
      //   console.log(isLocalEdit)
      //   setNodes(nodes => nodes.map(node => node.id === id ? { ...node, data: { ...node.data, label: nodeLabel } } : node))
      //   setIsLocalEdit(false)
      // }
      if (labelContainerRef.current) {
        // labelContainerRef.current.style.width = `60px`
        // labelContainerRef.current.style.width = `fit-content`
        // if (contentRef.current) {
        //   labelContainerRef.current.style.maxWidth = `${contentRef.current.clientWidth - 32}px`
        // }
        setNodeUneditable(id)
      }

      // if (labelRef.current) {
      //   // labelContainerRef.current.style.width = `60px`
      //   // labelContainerRef.current.style.width = `fit-content`
      //   if (contentRef.current) {
      //     labelRef.current.style.maxWidth = `${contentRef.current.clientWidth - 55}px`
      //   }
      //   disallowEditLabel(id)
      // }
    }

    if (labelContainerRef.current) {
      // labelContainerRef.current.addEventListener("click", onLabelContainerFocus)
      // labelRef.current.addEventListener("blur", onLabelBlur)
      // document.addEventListener("click", (e: MouseEvent) => {
      //   if (!labelContainerRef.current?.contains(e.target as HTMLElement) && !(e.target as HTMLElement).classList.contains("renameButton")) {
      //     onLabelContainerBlur()
      //   }
      // })

      document.addEventListener("click", (e: MouseEvent) => {
        if (!labelContainerRef.current?.contains(e.target as HTMLElement) && !(e.target as HTMLElement).classList.contains("renameButton")) {
          onLabelContainerBlur()
        }
      })
    }

    return () => {
      if (labelContainerRef.current) {
        // labelContainerRef.current.removeEventListener("click", onLabelContainerFocus)
        // labelRef.current.removeEventListener("blur", onLabelBlur)
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
      <svg width="20" height="24" viewBox="0 0 20 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="4" y="12" width="12" height="7" fill="#3EDBC9" />
        <rect x="6" y="6" width="8" height="11" rx="4" stroke="#3EDBC9" stroke-width="2" />
      </svg>
    )
    else if (isInput) return (
      <svg width="20" height="24" viewBox="0 0 20 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M8.5 14V10L11.1667 12L8.5 14Z" fill="#6C98D5" stroke="#6C98D5" />
        <path d="M9 11.9961L4 12.001" stroke="#6C98D5" stroke-width="2" />
        <path d="M13.5 7H9.5V5.5H15.5V18.5H9.5V17H13.5H14V16.5V7.5V7H13.5Z" fill="#6C98D5" stroke="#6C98D5" />
      </svg>

    )
    else if (isOutput) return (
      <svg width="20" height="24" viewBox="0 0 20 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12.5 14V10L15.1667 12L12.5 14Z" fill="#FF9267" stroke="#FF9267" />
        <path d="M13 11.9961L8 12.001" stroke="#FF9267" stroke-width="2" />
        <path d="M6.5 7H10.5V5.5H4.5V18.5H10.5V17H6.5H6V16.5V7.5V7H6.5Z" fill="#FF9267" stroke="#FF9267" />
      </svg>
    )
    else return (
      <svg width="20" height="24" viewBox="0 0 20 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="group">
        <path d="M5.5 4.5H8.5V7.5H5.5V4.5Z" className="fill-[#6D7177] group-hover:fill-[#CDCDCD] group-active:fill-[#4599DF]" />
        <path d="M5.5 16.5H8.5V19.5H5.5V16.5Z" className="fill-[#6D7177] group-hover:fill-[#CDCDCD] group-active:fill-[#4599DF]" />
        <path d="M11.5 16.5H14.5V19.5H11.5V16.5Z" className="fill-[#6D7177] group-hover:fill-[#CDCDCD] group-active:fill-[#4599DF]" />
        <path d="M11.5 10.5H14.5V13.5H11.5V10.5Z" className="fill-[#6D7177] group-hover:fill-[#CDCDCD] group-active:fill-[#4599DF]" />
        <path d="M5.5 10.5H8.5V13.5H5.5V10.5Z" className="fill-[#6D7177] group-hover:fill-[#CDCDCD] group-active:fill-[#4599DF]" />
        <path d="M11.5 4.5H14.5V7.5H11.5V4.5Z" className="fill-[#6D7177] group-hover:fill-[#CDCDCD] group-active:fill-[#4599DF]" />
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
    setViewMode(INPUT_VIEW_MODE); // Toggle button text
  };

  const handleEmbedViewClick = () => {
    console.log(getNode(id)?.data?.content)
    if (viewMode == EMBED_VIEW_MODE) {
      setShowSettingMenu((showSettingMenu) => !showSettingMenu)
    } else {
      setViewMode(EMBED_VIEW_MODE); // Toggle button text
    }
  };

  useEffect(
    () => {
      if (viewMode == INPUT_VIEW_MODE) {
        setUserInput("input view")
        setShowSettingMenu(false)
      } else {
        setUserInput("embedding view")
      }

    },
    [viewMode]
  )

  const [isEmbedded, setIsEmbedded] = useState(false)

  const handleAddTagPage = async () => {
    setIsEmbedHidden(!isEmbedHidden)
    const response = await onEmbeddingClick()
    if (response == undefined) {
      //retry
      await onEmbeddingClick()
    }
    setTimeout(() => {
      const newnode = getNode(id)
      if (newnode?.data.index_name) {
        setIsEmbedded(true)
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

      const transformPayload = (originalPayload: any) => {
        return {
          chunks: originalPayload.data.chunks,
          create_new: true, // Indicates that a new entry is being created
          vdb_type: originalPayload.data.vdb_type,
          model: originalPayload.data.model
        };
      };

      const payloaddata = transformPayload(embeddingNodeData)

      console.log("payload", payloaddata)

      if (payloaddata.chunks == undefined) {
        return undefined
      }
      

      const getuserid = async ():Promise<string> =>{
        if(userId.trim() !== ""){
          return userId
        }
        const res = await fetchUserId() as string
        return res
      }


      // TODO: 需要修改为动态的user_id
      const response = await fetch(`${PuppyStorage_IP_address_for_embedding}/${await getuserid()}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payloaddata)
      })

      if (!response.ok) {
        throw new Error(`HTTP Error: ${response.status}`)
      }

      // // 5. updateNode
      const index_name_response = await response.json()
      if (typeof index_name_response === 'string') {
        setNodes(prevNodes => prevNodes.map(node => node.id === id ? {
          ...node,
          data: {
            ...node.data,
            index_name: index_name_response
          }
        } : node))


        setTimeout(() => {
          const newnode = getNode(id)
          console.log("index_name", newnode)
        }, 1200);

      }

    } catch (error) {
      console.error("Error fetching embedding:", error);
    } finally {
      clearAll()
    }
  }

  useEffect(
    () => {
      console.log("setisloop step2 onchange",isLooped)

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
      console.log("jsonndoe isloading",isLoading)
    }
    , []
  )

  useEffect(
    ()=>{

    },[]
  )


  return (
    <div ref={componentRef} className={`relative w-full h-full min-w-[240px] min-h-[176px] ${isOnGeneratingNewNode ? 'cursor-crosshair' : 'cursor-default'}`}>


      <div ref={contentRef} id={id} className={`w-full h-full min-w-[240px] min-h-[176px] border-[1.5px] rounded-[16px] px-[8px] pt-[8px] pb-[8px]  ${borderColor} text-[#CDCDCD] bg-main-black-theme break-words font-plus-jakarta-sans text-base leading-5 font-[400] overflow-hidden`}  >


        {/* the top bar of a block */}
        <div ref={labelContainerRef}
          className={`h-[24px] w-full max-w-full rounded-[4px]  flex items-center justify-between mb-2`}>

          {/* top-left wrapper */}
          <div className="flex items-center gap-[8px] hover:cursor-grab active:cursor-grabbing group" 
               style={{
                 maxWidth: `calc(${calculateMaxLabelContainerWidth()} - 44px)`,
               }}>
            <div className="min-w-[20px] min-h-[24px] flex items-center justify-center group-hover:text-[#CDCDCD] group-active:text-[#4599DF]">
              {renderTagLogo()}
            </div>
            
            {editable ? (
              <input
                ref={labelRef}
                className={`
                  flex items-center justify-start 
                  font-[600] text-[12px] leading-[18px] 
                  font-plus-jakarta-sans bg-transparent h-[18px] 
                  focus:outline-none truncate
                  ${locked ? 'text-[#3EDBC9] group-hover:text-[#CDCDCD] group-active:text-[#4599DF]' : 'text-[#6D7177] group-hover:text-[#CDCDCD] group-active:text-[#4599DF]'}
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
                  font-plus-jakarta-sans truncate
                  ${locked ? 'text-[#3EDBC9] group-hover:text-[#CDCDCD] group-active:text-[#4599DF]' : 'text-[#6D7177] group-hover:text-[#CDCDCD] group-active:text-[#4599DF]'}
                `}
              >
                {nodeLabel}
              </span>
            )}
          </div>



          {/* top-right toolbar */}
          <div className="min-w-[56px] min-h-[24px] flex items-center justify-end gap-[8px]">
            {/* NodeToolBar */}
            <NodeToolBar Parentnodeid={id} ParentNodetype={type} />
            {/* Loop Switch */}
            <div className='w-[24px] h-[24px] cursor-pointer flex items-center'
              onClick={() => {
                setIsLooped(prev => {
                  console.log("setislooped step1 click",!prev)
                  return !prev
                })
              }}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="1.5" y="1.5" width="21" height="11" rx="5.5" stroke={`${isLooped?'#39BC66':'#6D7177'}`} />
                <rect 
                    x="4" 
                    y="4" 
                    width="6" 
                    height="6" 
                    rx="3" 
                    fill={`${isLooped?'#39BC66':'#6D7177'}`}
                    className={`transition-transform duration-300 ${isLooped ? 'translate-x-2.5' : 'translate-x-0'}`}
                  />
                <path d="M5.25817 20.6387V16.1687H6.07417V19.9187H7.98817V20.6387H5.25817ZM10.046 20.7107C9.72598 20.7107 9.43398 20.6367 9.16998 20.4887C8.90998 20.3407 8.70198 20.1387 8.54598 19.8827C8.39398 19.6267 8.31798 19.3347 8.31798 19.0067C8.31798 18.6787 8.39398 18.3867 8.54598 18.1307C8.70198 17.8747 8.90998 17.6727 9.16998 17.5247C9.42998 17.3767 9.72198 17.3027 10.046 17.3027C10.366 17.3027 10.656 17.3767 10.916 17.5247C11.176 17.6727 11.382 17.8747 11.534 18.1307C11.69 18.3827 11.768 18.6747 11.768 19.0067C11.768 19.3347 11.69 19.6267 11.534 19.8827C11.378 20.1387 11.17 20.3407 10.91 20.4887C10.65 20.6367 10.362 20.7107 10.046 20.7107ZM10.046 19.9907C10.222 19.9907 10.376 19.9487 10.508 19.8647C10.644 19.7807 10.75 19.6647 10.826 19.5167C10.906 19.3647 10.946 19.1947 10.946 19.0067C10.946 18.8147 10.906 18.6467 10.826 18.5027C10.75 18.3547 10.644 18.2387 10.508 18.1547C10.376 18.0667 10.222 18.0227 10.046 18.0227C9.86598 18.0227 9.70798 18.0667 9.57198 18.1547C9.43598 18.2387 9.32798 18.3547 9.24798 18.5027C9.17198 18.6467 9.13398 18.8147 9.13398 19.0067C9.13398 19.1947 9.17198 19.3647 9.24798 19.5167C9.32798 19.6647 9.43598 19.7807 9.57198 19.8647C9.70798 19.9487 9.86598 19.9907 10.046 19.9907ZM13.96 20.7107C13.64 20.7107 13.348 20.6367 13.084 20.4887C12.824 20.3407 12.616 20.1387 12.46 19.8827C12.308 19.6267 12.232 19.3347 12.232 19.0067C12.232 18.6787 12.308 18.3867 12.46 18.1307C12.616 17.8747 12.824 17.6727 13.084 17.5247C13.344 17.3767 13.636 17.3027 13.96 17.3027C14.28 17.3027 14.57 17.3767 14.83 17.5247C15.09 17.6727 15.296 17.8747 15.448 18.1307C15.604 18.3827 15.682 18.6747 15.682 19.0067C15.682 19.3347 15.604 19.6267 15.448 19.8827C15.292 20.1387 15.084 20.3407 14.824 20.4887C14.564 20.6367 14.276 20.7107 13.96 20.7107ZM13.96 19.9907C14.136 19.9907 14.29 19.9487 14.422 19.8647C14.558 19.7807 14.664 19.6647 14.74 19.5167C14.82 19.3647 14.86 19.1947 14.86 19.0067C14.86 18.8147 14.82 18.6467 14.74 18.5027C14.664 18.3547 14.558 18.2387 14.422 18.1547C14.29 18.0667 14.136 18.0227 13.96 18.0227C13.78 18.0227 13.622 18.0667 13.486 18.1547C13.35 18.2387 13.242 18.3547 13.162 18.5027C13.086 18.6467 13.048 18.8147 13.048 19.0067C13.048 19.1947 13.086 19.3647 13.162 19.5167C13.242 19.6647 13.35 19.7807 13.486 19.8647C13.622 19.9487 13.78 19.9907 13.96 19.9907ZM16.2781 21.8387V17.3747H17.0161V18.0227L16.9441 17.8607C17.0561 17.6847 17.2081 17.5487 17.4001 17.4527C17.5921 17.3527 17.8141 17.3027 18.0661 17.3027C18.3741 17.3027 18.6521 17.3787 18.9001 17.5307C19.1481 17.6827 19.3441 17.8867 19.4881 18.1427C19.6361 18.3987 19.7101 18.6867 19.7101 19.0067C19.7101 19.3227 19.6381 19.6107 19.4941 19.8707C19.3501 20.1307 19.1541 20.3367 18.9061 20.4887C18.6581 20.6367 18.3761 20.7107 18.0601 20.7107C17.8241 20.7107 17.6061 20.6647 17.4061 20.5727C17.2101 20.4767 17.0541 20.3407 16.9381 20.1647L17.0641 20.0087V21.8387H16.2781ZM17.9701 19.9907C18.1501 19.9907 18.3101 19.9487 18.4501 19.8647C18.5901 19.7807 18.6981 19.6647 18.7741 19.5167C18.8541 19.3687 18.8941 19.1987 18.8941 19.0067C18.8941 18.8147 18.8541 18.6467 18.7741 18.5027C18.6981 18.3547 18.5901 18.2387 18.4501 18.1547C18.3101 18.0667 18.1501 18.0227 17.9701 18.0227C17.7981 18.0227 17.6421 18.0647 17.5021 18.1487C17.3661 18.2327 17.2581 18.3507 17.1781 18.5027C17.1021 18.6507 17.0641 18.8187 17.0641 19.0067C17.0641 19.1987 17.1021 19.3687 17.1781 19.5167C17.2581 19.6647 17.3661 19.7807 17.5021 19.8647C17.6421 19.9487 17.7981 19.9907 17.9701 19.9907Z" fill={`${isLooped?'#39BC66':'#6D7177'}`} />
              </svg>
            </div>

          </div>
        </div>

        {/* JSON Editor */}
        {isLoading ? <SkeletonLoadingIcon /> :
          <div className='rounded-tl-[8px] rounded-tr-[8px] ${borderColor} border-[1px]'
            style={{
              borderRadius: "8px",
              border: "1px solid #6D7177",
              background: "#1C1D1F",
            }}
          >
              {
                viewMode == EMBED_VIEW_MODE ?
                  <div style={{
                    width: 'fit-content',
                    maxWidth: calculateMaxLabelContainerWidth(),
                    overflow: "hidden"
                  }}>

                    <JSONForm preventParentDrag={onFocus} allowParentDrag={onBlur}

                      placeholder='["JSON"]'
                      parentId={id}
                      widthStyle={contentSize.width - 16}
                      heightStyle={contentSize.height - 68}
                      inputvalue={userInput}
                      readonly={true}
                      synced={false}
                    />
                  </div>
                  :
                  <div style={{
                    width: 'fit-content',
                    maxWidth: calculateMaxLabelContainerWidth(),
                    overflow: "hidden"
                  }}>
                    
                      <JSONForm preventParentDrag={onFocus} allowParentDrag={onBlur}
                        placeholder='["JSON"]'
                        parentId={id}
                        widthStyle={contentSize.width - 16}
                        heightStyle={contentSize.height - 68}
                        inputvalue={userInput}
                        synced={true}
                      />
                    
                  </div>
              }

            {/*View Mode Switching Bar at the bottom*/}
            <div
              style={{
                width: "100%",
                height: "32px",
                top: "70px",
                display:isLoading?"none":"flex"
              }}>
              <div style={{
                display: 'flex',
                justifyContent: 'left',
                width: '100%',
                height: '100%',
                borderBottomLeftRadius: '8px',
                borderBottomRightRadius: '8px',
                borderTop: '1px solid #323232',
              }}>
                {viewMode == INPUT_VIEW_MODE ?
                  <button style={{
                    paddingTop: '1px',
                    cursor: 'pointer',
                    paddingLeft: "8px",
                    paddingRight: "8px",
                    position: 'relative', // 添加相对定位
                  }}
                    className={`h-[32px] text-[12px] text-[#A4A4A4] before:content-[''] before:absolute before:top-[-2px] before:left-0 before:w-full before:h-[2px] before:bg-[#A4A4A4] font-semibold flex items-center gap-[8px]`}
                    onClick={handleInputViewClick}
                  >
                    JSON
                  </button> :
                  <button style={{
                    paddingTop: '1px',
                    cursor: 'pointer',
                    paddingLeft: "8px",
                    paddingRight: "8px",
                  }}
                    className={`h-[32px] text-[12px] text-[#6D7177] font-semibold flex items-center gap-[8px]`}
                    onClick={handleInputViewClick}
                  >
                    JSON
                  </button>
                }
                {viewMode == EMBED_VIEW_MODE ?

                <div style={{
                  position: 'relative', // 添加相对定位
                  display: isEmbedHidden ? "none" : "flex"
                }}
                >
                  <button style={{
                    paddingTop: '1px',
                    cursor: 'pointer',
                    paddingLeft: "8px",
                    paddingRight: "8px"
                  }}
                  className={`h-[32px] text-[12px] text-[#A4A4A4] before:content-[''] before:absolute before:top-[-2px] before:left-0 before:w-full before:h-[2px] before:bg-[#A4A4A4] font-semibold flex items-center gap-[8px]`}
                    onClick={handleEmbedViewClick}
                  >
                    <svg
                      style={{
                        display: isEmbedded ? "none" : "inline",
                        animation: "rotate 2s linear infinite",
                      }}
                      width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
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
                      <path d="M5 0V3" stroke="#A4A4A4" />
                      <path d="M5 7V10" stroke="#A4A4A4" />
                      <path d="M10 5H7" stroke="#A4A4A4" />
                      <path d="M3 5H0" stroke="#A4A4A4" />
                      <path d="M8.5 1.5L6.5 3.5" stroke="#A4A4A4" />
                      <path d="M8.5 8.5L6.5 6.5" stroke="#A4A4A4" />
                      <path d="M3.5 6.5L1.5 8.5" stroke="#A4A4A4" />
                      <path d="M3.5 3.5L1.5 1.5" stroke="#A4A4A4" />
                    </svg>
                    <span>Embedding</span>
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
                      <div style={{position: "fixed", zIndex: 20000}}>
                        <ul className='flex flex-col absolute top-[32px] p-[8px] w-[160px] gap-[4px] bg-[#252525] border-[1px] border-[#404040] rounded-[8px] left-[0px] z-[20000]'>
                          <li>
                            <button className='renameButton flex flex-row items-center justify-start gap-[8px] w-full h-[26px] hover:bg-[#3E3E41] rounded-[4px] border-none text-[#CDCDCD] hover:text-white'
                              onClick={
                                async () => {
                                  setIsEmbedded(false)
                                  setShowSettingMenu(false)
                                  const embeddingNodeData = await constructStructuredNodeEmbeddingData()
                                  console.log("embeddingnode data", embeddingNodeData)

                                  if (embeddingNodeData === "error") {
                                    throw new Error("Invalid node data")
                                  }

                                  const embeddingViewData = traverseJson(embeddingNodeData.data.content)

                                  const embeddingViewDataWithInfo = constructMetadataInfo(embeddingNodeData.data.content, embeddingViewData)

                                  setNodes(prevNodes => prevNodes.map(node => {
                                    if (node.id === id){
                                        return {...node, data: {
                                            ...node.data, 
                                            chunks: JSON.stringify(embeddingViewDataWithInfo, null, 2)
                                        }}
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
                                      setIsEmbedded(true)
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
                                  setIsEmbedHidden(true)
                                  setViewMode(INPUT_VIEW_MODE)
                                  setIsEmbedded(false)
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
                  <button style={{
                    paddingTop: '1px',
                    cursor: 'pointer',
                    borderTopLeftRadius: '8px',
                    borderTopRightRadius: '8px',
                    borderWidth: "0px",
                    paddingLeft: "8px",
                    paddingRight: "8px",
                    position: 'relative', // 添加相对定位
                    display: isEmbedHidden ? "none" : "flex"
                  }}
                  className={`text-[12px] text-[#6D7177] font-semibold flex items-center gap-[8px] h-[32px]`}
                    onClick={handleEmbedViewClick}
                  >
                    <svg
                      style={{
                        display: isEmbedded ? "none" : "inline",
                        animation: "rotate 2s linear infinite",
                      }}
                      width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
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
                      <path d="M5 0V3" stroke="#A4A4A4" />
                      <path d="M5 7V10" stroke="#A4A4A4" />
                      <path d="M10 5H7" stroke="#A4A4A4" />
                      <path d="M3 5H0" stroke="#A4A4A4" />
                      <path d="M8.5 1.5L6.5 3.5" stroke="#A4A4A4" />
                      <path d="M8.5 8.5L6.5 6.5" stroke="#A4A4A4" />
                      <path d="M3.5 6.5L1.5 8.5" stroke="#A4A4A4" />
                      <path d="M3.5 3.5L1.5 1.5" stroke="#A4A4A4" />
                    </svg>
                    <span>Embedding</span>
                  </button>
                }
                {
                  isEmbedHidden ?
                    <div
                      onClick={handleAddTagPage}
                      className='cursor-pointer flex justify-center items-center'
                    >
                      <svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg"
                      >
                        <path d="M11 6L11 16" stroke="#6D7177" strokeWidth="1.5" />
                        <path d="M6 11L16 10.9839" stroke="#6D7177" strokeWidth="1.5" />
                      </svg>
                    </div>
                    :
                    <></>
                }

              </div>
            </div>

          </div>
        }










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
    </div>

  )
}

export default JsonBlockNode