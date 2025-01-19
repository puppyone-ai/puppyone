'use client'
import { NodeProps, Node, Handle, Position, useReactFlow, NodeResizeControl } from '@xyflow/react'
import React,{useRef, useEffect, useState, ReactElement} from 'react'
// import { nodeState, useNodeContext } from '../../states/NodeContext'
import { useNodesPerFlowContext } from '../../states/NodesPerFlowContext'
import WhiteBallHandle from '../handles/WhiteBallHandle'
import JSONForm from '../../menu/tableComponent/JSONForm'
import NodeToolBar from '../nodeTopRightBar/NodeTopRightBar'
import SkeletonLoadingIcon from '../../loadingIcon/SkeletonLoadingIcon'
import { json } from 'stream/consumers'
import { get, set } from 'lodash'
import { PuppyStorage_IP_address_for_embedding } from '../../hooks/useJsonConstructUtils'
import useJsonConstructUtils from '../../hooks/useJsonConstructUtils'

type methodNames = "cosine"
type modelNames = "text-embedding-ada-002"
type vdb_typeNames = "pgvector"

const HEIGHT_STD = 500
const WIDTH_STD = 300

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

function JsonBlockNode({isConnectable, id, type, data: {content, label, isLoading, locked, isInput, isOutput, editable, index_name}}: JsonBlockNodeProps){

  // selectHandle = 1: TOP, 2: RIGHT, 3: BOTTOM, 4: LEFT. 
  // Initialization: 0
  // const [selectedHandle, setSelectedHandle] = useState<Position | null>(null)
  const {activatedNode, isOnConnect, isOnGeneratingNewNode, setNodeUneditable, editNodeLabel, preventInactivateNode, allowInactivateNodeWhenClickOutside, clearAll} = useNodesPerFlowContext()
  const {setNodes, setEdges, getEdges,getNode} = useReactFlow()
  // for linking to handle bar, it will be highlighed.
  const [isTargetHandleTouched, setIsTargetHandleTouched] = useState(false)
  const componentRef = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const [contentSize, setContentSize] = useState({ width: 0, height: 0})
  const labelContainerRef = useRef<HTMLDivElement | null>(null)
  const labelRef = useRef<HTMLInputElement | null>(null)
  const [nodeLabel, setNodeLabel] = useState(label ?? id)
  const [isLocalEdit, setIsLocalEdit] = useState(false); //使用 isLocalEdit 标志来区分本地编辑和外部更新。只有内部编辑：才能触发 更新 data.label, 只有外部更新才能触发 更新 nodeLabel
  const measureSpanRef = useRef<HTMLSpanElement | null>(null) // 用于测量 labelContainer 的宽度
  const [borderColor, setBorderColor] = useState("border-main-deep-grey")
  const [INPUT_VIEW_MODE, EMBED_VIEW_MODE] = ["input view", "embedding view"]
  const [viewMode, setViewMode] = useState(INPUT_VIEW_MODE); // State for button text
  const [isEmbedHidden, setIsEmbedHidden] = useState(true)
  const {cleanJsonString} = useJsonConstructUtils()



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
      // Prevent unnecessary updates by checking if size actually changed
      const { width, height } = entries[0].contentRect;
      const widthThreshold = 24; // Set a threshold of 10 pixels for width changes
      const heightThreshold = 25; 
      // Only update if the size is different from current state
      setContentSize(prevSize => {
        if (
          Math.abs(prevSize.width - width) > widthThreshold || // Check if width change exceeds threshold
          Math.abs(prevSize.height - height) > heightThreshold
        ) {
          return { width, height };
        }
        return prevSize;
      });
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
        <svg width="20" height="24" viewBox="0 0 20 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="4" y="12" width="12" height="7" fill="#3EDBC9"/>
        <rect x="6" y="6" width="8" height="11" rx="4" stroke="#3EDBC9" stroke-width="2"/>
        </svg>
      )
      else if (isInput) return (
        <svg width="20" height="24" viewBox="0 0 20 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M8.5 14V10L11.1667 12L8.5 14Z" fill="#6C98D5" stroke="#6C98D5"/>
        <path d="M9 11.9961L4 12.001" stroke="#6C98D5" stroke-width="2"/>
        <path d="M13.5 7H9.5V5.5H15.5V18.5H9.5V17H13.5H14V16.5V7.5V7H13.5Z" fill="#6C98D5" stroke="#6C98D5"/>
        </svg>

      )
      else if (isOutput) return (
        <svg width="20" height="24" viewBox="0 0 20 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12.5 14V10L15.1667 12L12.5 14Z" fill="#FF9267" stroke="#FF9267"/>
        <path d="M13 11.9961L8 12.001" stroke="#FF9267" stroke-width="2"/>
        <path d="M6.5 7H10.5V5.5H4.5V18.5H10.5V17H6.5H6V16.5V7.5V7H6.5Z" fill="#FF9267" stroke="#FF9267"/>
        </svg>
      )
      else return (
        <svg width="20" height="24" viewBox="0 0 20 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="group">
          <path d="M5.5 4.5H8.5V7.5H5.5V4.5Z" className="fill-[#6D7177] group-hover:fill-[#CDCDCD] group-active:fill-[#4599DF]"/>
          <path d="M5.5 16.5H8.5V19.5H5.5V16.5Z" className="fill-[#6D7177] group-hover:fill-[#CDCDCD] group-active:fill-[#4599DF]"/>
          <path d="M11.5 16.5H14.5V19.5H11.5V16.5Z" className="fill-[#6D7177] group-hover:fill-[#CDCDCD] group-active:fill-[#4599DF]"/>
          <path d="M11.5 10.5H14.5V13.5H11.5V10.5Z" className="fill-[#6D7177] group-hover:fill-[#CDCDCD] group-active:fill-[#4599DF]"/>
          <path d="M5.5 10.5H8.5V13.5H5.5V10.5Z" className="fill-[#6D7177] group-hover:fill-[#CDCDCD] group-active:fill-[#4599DF]"/>
          <path d="M11.5 4.5H14.5V7.5H11.5V4.5Z" className="fill-[#6D7177] group-hover:fill-[#CDCDCD] group-active:fill-[#4599DF]"/>
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
      return `${contentRef.current.clientWidth - 32}px`
    }
    return '100%'
  }

  const calculateMaxLabelContainerWidthN = () => {
    if (contentRef.current) {
      return `${contentRef.current.clientWidth-15.6}px`
    }
    return '100%'
  }

  // height by default: 304px, inner-box: 240px, resize-control: 304px, without embedding
  // height with embedding: 336px, inner-box: 272px, resize-control: 336px


  const [userInput,setUserInput] =useState<string|undefined>(getNode(id)?.data?.content as string|undefined)

  // TODO Auto resize of content box
  // TODO dialogue selection of content atttribute(key onl y, no index) 
  // embeding view switch button
  const handleInputViewClick = () => {

    setViewMode(INPUT_VIEW_MODE); // Toggle button text
  };
  const handleEmbedViewClick = () => {
    console.log(getNode(id)?.data?.content)


    setViewMode(EMBED_VIEW_MODE); // Toggle button text
  };

  useEffect(
    ()=>{
      if(viewMode==INPUT_VIEW_MODE){
        setUserInput(getNode(id)?.data?.content ? getNode(id)?.data?.content as string : undefined)
      }else{
        setUserInput(getNode(id)?.data?.chunks? JSON.stringify((getNode(id)?.data?.chunks)):undefined)
      }

    },
    [viewMode]
  )

  const [isEmbedded, setIsEmbedded] = useState(false)

  const handleAddTagPage = async () => {
    setIsEmbedHidden(!isEmbedHidden)
    await onEmbeddingClick()
    await onEmbeddingClick()
    setTimeout(() => {
      const newnode = getNode(id)
      if(newnode?.data.index_name){
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
          if (!metadata.path){
            metadata.path = []
          }
          metadata[`path`].push(step.substring(4));
        } else if (step.startsWith('list_')) {
          if (!metadata.path){
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
    
    for (let i = 0; i < path.length - 1; i++) {
        current = current[path[i]];
    }
    
    const lastKey = path[path.length - 1];
    if (Array.isArray(current)) {
        current.splice(Number(lastKey), 1);
    } else {
        delete current[lastKey];
    }
    
    return clone;
}

const constructMetadataInfo = (data:any, embeddingViewData: EmbeddingItem[]) => {
    
      embeddingViewData.forEach((item, index) => {
        if (item.metadata.path){
          // then append modified data to EmbeddingItem
          const path = item.metadata.path
          const result = removeItemFromData(data, path)
          item.metadata.info = result
          
        }
      })  

    return embeddingViewData
}

const getNodePromise = (id: string):any => {
  return new Promise((resolve) => {
    setTimeout(() => {
      const node = getNode(id);
      resolve(node);
    }, 0);
  });
};


const constructStructuredNodeEmbeddingData = async() => {

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
          console.log("embeddingnode data",embeddingNodeData)

          if (embeddingNodeData === "error") {
              throw new Error("Invalid node data")
          }

          
          const embeddingViewData=traverseJson(embeddingNodeData.data.content)

          const embeddingViewDataWithInfo = constructMetadataInfo(embeddingNodeData.data.content, embeddingViewData)
          console.log(embeddingViewData)
          console.log(embeddingViewDataWithInfo)

          setNodes(prevNodes => prevNodes.map(
              (node) => {
                if (node.id === id) {
                  return {...node, data: {...node.data, chunks: embeddingViewDataWithInfo}}
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

          console.log("payload",payloaddata)

          if(payloaddata.chunks==undefined){
            return
          }

          // TODO: 需要修改为动态的user_id
          const response = await fetch(`${PuppyStorage_IP_address_for_embedding}/Rose123`, {
              method:'POST',
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
              console.log("index_name",newnode)
            }, 1200);
            
        }
          
      } catch (error) {
          console.error("Error fetching embedding:", error);
      } finally {
          clearAll()
      }
  }

  return (
    <div ref={componentRef} className={`relative w-full h-full min-w-[400px] min-h-[560] p-[32px] ${isOnGeneratingNewNode ? 'cursor-crosshair' : 'cursor-default'}`}>

    
    <div ref={contentRef} id={id} className={`w-full h-full min-w-[176px] min-h-[176px] border-[1.5px] rounded-[8px] px-[8px] pt-[30px] pb-[8px]  ${borderColor} text-[#CDCDCD] bg-main-black-theme break-words font-plus-jakarta-sans text-base leading-5 font-[400] overflow-hidden`}  >
    <div className='rounded-tl-[8px] rounded-tr-[8px] ${borderColor} border-[1px]' 
      style={{
        borderRadius: "8px",
        border: "1px solid #6D7177",
        background: "#1C1D1F",
      }}
    >
      <div 
              style={{
                    width: "100%",
                    height: "32px",
                    top: "70px"
                  }}>
            <div style={{
                display: 'flex',
                justifyContent: 'left',
                width: '100%',
                height: '100%',
                borderTopLeftRadius: '8px',
                borderTopRightRadius: '8px',
              }}>
              {viewMode==INPUT_VIEW_MODE?
              <button style={{
                  paddingTop: '1px',
                  cursor: 'pointer',
                  paddingLeft:"8px",
                  paddingRight:"8px",
                }}
                className={`border-white border-b-[2px] text-[10px] text-[#A4A4A4]`}
                onClick={handleInputViewClick}
                >
                JSON View
              </button>:
              <button style={{
                paddingTop: '1px',
                cursor: 'pointer',
                paddingLeft:"8px",
                paddingRight:"8px",
              }}
              className={`text-[10px] text-[#A4A4A4]`}
              onClick={handleInputViewClick}
              >
              JSON View
            </button>
            }
            {viewMode==EMBED_VIEW_MODE?
              <button style={{
                paddingTop: '1px',
                cursor: 'pointer',
                paddingLeft:"8px",
                paddingRight:"8px",
                display:isEmbedHidden?"none":"inline"
              }}
              className={`border-white border-b-[2px] text-[10px] text-[#A4A4A4] justify-center items-center`}
                onClick={handleEmbedViewClick}
                >
<svg 
  style={{
    display: isEmbedded ? "none" : "inline",
    animation: "rotate 2s linear infinite", // Added inline animation
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
  <path d="M5 0V3" stroke="#A4A4A4"/>
  <path d="M5 7V10" stroke="#A4A4A4"/>
  <path d="M10 5H7" stroke="#A4A4A4"/>
  <path d="M3 5H0" stroke="#A4A4A4"/>
  <path d="M8.5 1.5L6.5 3.5" stroke="#A4A4A4"/>
  <path d="M8.5 8.5L6.5 6.5" stroke="#A4A4A4"/>
  <path d="M3.5 6.5L1.5 8.5" stroke="#A4A4A4"/>
  <path d="M3.5 3.5L1.5 1.5" stroke="#A4A4A4"/>
</svg>
                Embedding View
              </button>:
              <button style={{
                paddingTop: '1px',
                cursor: 'pointer',
                borderTopLeftRadius: '8px',
                borderTopRightRadius: '8px',
                borderWidth:"0px",
                paddingLeft:"8px",
                paddingRight:"8px",
                display:isEmbedHidden?"none":"inline"
              }}
              className={`text-[10px] text-[#A4A4A4] justify-center items-center`}
              onClick={handleEmbedViewClick}
              >
<svg 
  style={{
    display: isEmbedded ? "none" : "inline",
    animation: "rotate 2s linear infinite", // Added inline animation
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
  <path d="M5 0V3" stroke="#A4A4A4"/>
  <path d="M5 7V10" stroke="#A4A4A4"/>
  <path d="M10 5H7" stroke="#A4A4A4"/>
  <path d="M3 5H0" stroke="#A4A4A4"/>
  <path d="M8.5 1.5L6.5 3.5" stroke="#A4A4A4"/>
  <path d="M8.5 8.5L6.5 6.5" stroke="#A4A4A4"/>
  <path d="M3.5 6.5L1.5 8.5" stroke="#A4A4A4"/>
  <path d="M3.5 3.5L1.5 1.5" stroke="#A4A4A4"/>
</svg>
              Embedding View
            </button>
            }
            {
              isEmbedHidden?
              <div
              onClick={handleAddTagPage}
              className='cursor-pointer flex justify-center items-center'
              >
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg"
              >
              <path d="M11 6L11 16" stroke="#6D7177" strokeWidth="1.5"/>
              <path d="M6 11L16 10.9839" stroke="#6D7177" strokeWidth="1.5"/>
            </svg>
              </div>
              :
              <></>
            }

            </div>
          </div>
            {
              viewMode==EMBED_VIEW_MODE?
              <div style={{
                width: 'fit-content',
                maxWidth: calculateMaxLabelContainerWidth(),
                overflow:"hidden"
              }}>

              <JSONForm preventParentDrag={onFocus} allowParentDrag={onBlur} widthStyle={contentSize.width-3}
                              placeholder='["JSON"]'
                                      parentId={id}
                                      heightStyle={(contentSize.height-18>HEIGHT_STD-160)?contentSize.height-58:HEIGHT_STD-160}
                                      inputvalue={userInput}
                                      readonly={true}
                                      synced={false}
                                      />
              </div>
              :
              <div style={{
                width: 'fit-content',
                maxWidth: calculateMaxLabelContainerWidth(),
                overflow:"hidden"
              }}>
                  {isLoading ? <SkeletonLoadingIcon /> : 
                              <JSONForm preventParentDrag={onFocus} allowParentDrag={onBlur} widthStyle={contentSize.width-3>WIDTH_STD?contentSize.width-3:WIDTH_STD}
                              placeholder='["JSON"]'
                                      parentId={id}
                                      heightStyle={(contentSize.height-18>HEIGHT_STD-160)?contentSize.height-58:HEIGHT_STD-160}
                                      inputvalue={userInput}
                                      synced={true}
                                      />
                  }
            </div>
            }
    </div>
          


         
         <div ref={labelContainerRef} 
           style={{
            width: 'fit-content',
            maxWidth: calculateMaxLabelContainerWidth(),
           }}

        className={`absolute top-[40px] left-[40px] h-[24px] rounded-[4px]   px-[0px] flex items-center justify-center gap-[8px] z-[20000]`}>
          {renderTagLogo()}
          <span
          ref={measureSpanRef}
          style={{
            visibility: 'hidden',
            position: 'absolute',
            whiteSpace: 'pre',
            fontSize: '12px',
            lineHeight: '18px',
            fontWeight: '700',
            fontFamily: 'Plus Jakarta Sans'
          }}
          >
          {nodeLabel}
        </span>
          <input ref={labelRef}  autoFocus={editable} className={`flex items-center justify-start text-[#6D7177] font-[600] text-[12px] leading-[18px] font-plus-jakarta-sans bg-transparent h-[18px] focus:outline-none`}
            style={{
              boxSizing: "content-box",
              width: calculateInputWidth(),
              maxWidth: '100%',
      
    }}
    size={nodeLabel.length ?? 0}
    value={`${nodeLabel}`} readOnly={!editable} onChange={EditLabel} onMouseDownCapture={onFocus} onBlur={onBlur} />
           
          

        </div>

        <NodeToolBar Parentnodeid={id} ParentNodetype={type}/>
      
        <NodeResizeControl 
          minWidth={240} 
          minHeight={HEIGHT_STD}
          style={{ position: 'absolute', right: "0px", bottom: "0px", cursor: 'se-resize', 
            background: 'transparent',
            border: 'none' }}
        >
          <div 
            style={{
              position: "absolute",
              visibility: `${activatedNode?.id === id ? "visible" : "hidden"}`,
              right: "36px",
              bottom: "36px",
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              backgroundColor: 'transparent',
              zIndex: "200000",
              width:"26px",
              height:"26px",
            }}
          >
            <svg width="26" height="26" viewBox="0 0 26 26" fill="none" xmlns="http://www.w3.org/2000/svg" className="group active:group-[]:fill-[#4599DF]">
              <path d="M10 5.99998H12V7.99998H10V5.99998Z" className="fill-[#6D7177] group-hover:fill-[#CDCDCD] group-active:fill-[#4599DF]"/>
              <path d="M10 2H12V4H10V2Z" className="fill-[#6D7177] group-hover:fill-[#CDCDCD] group-active:fill-[#4599DF]"/>
              <path d="M6 5.99998H8V7.99998H6V5.99998Z" className="fill-[#6D7177] group-hover:fill-[#CDCDCD] group-active:fill-[#4599DF]"/>
              <path d="M6 10H8V12H6V10Z" className="fill-[#6D7177] group-hover:fill-[#CDCDCD] group-active:fill-[#4599DF]"/>
              <path d="M2 10H4V12H2V10Z" className="fill-[#6D7177] group-hover:fill-[#CDCDCD] group-active:fill-[#4599DF]"/>
              <path d="M10 10H12V12H10V10Z" className="fill-[#6D7177] group-hover:fill-[#CDCDCD] group-active:fill-[#4599DF]"/>
            </svg>
          </div>
        </NodeResizeControl>

        
        {index_name && 
        <div className='absolute bottom-[40px] left-[40px] h-[16px] font-plus-jakarta-sans px-[4px] py-[3px] flex items-center justify-center rounded-[4px] border-[0.5px] border-solid border-[#3E3E41] bg-gradient-to-r from-[#E55D87] to-[#5FC3E4]
         text-main-black-theme text-[8px] font-bold'>Embedded</div>
        }
        
        <WhiteBallHandle id={`${id}-a`} type="source" sourceNodeId={id}
            isConnectable={isConnectable} position={Position.Top}  />
            <WhiteBallHandle id={`${id}-b`} type="source" sourceNodeId={id}
            isConnectable={isConnectable}
            position={Position.Right}  />
            <WhiteBallHandle id={`${id}-c`} type="source" sourceNodeId={id} isConnectable={isConnectable}  position={Position.Bottom} />
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
      </div>

  )
}

export default JsonBlockNode