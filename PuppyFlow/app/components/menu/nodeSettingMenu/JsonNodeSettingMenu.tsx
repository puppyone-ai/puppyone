import React,{useEffect, useState, Fragment} from 'react'
// import { useNodeContext } from '../../states/NodeContext'
import { useReactFlow , Position, Node} from '@xyflow/react'
import { useNodesPerFlowContext } from '../../states/NodesPerFlowContext'
import { PuppyStorage_IP_address_for_embedding } from '../../hooks/useJsonConstructUtils'
import useJsonConstructUtils from '../../hooks/useJsonConstructUtils'
import { Transition } from '@headlessui/react'

type JsonNodeSettingMenuProps = {
    showSettingMenu: number,
    clearMenu: () => void,
    nodeid: string,

}

function JsonNodeSettingMenu({showSettingMenu, clearMenu, nodeid}: JsonNodeSettingMenuProps) {

    // const {nodes, searchNode, deleteNode, lockNode, unlockNode,setHandleDisconnected, clear, markNodeAsInput, unmarkNodeAsInput, markNodeAsOutput, unmarkNodeAsOutput, allowEditLabel, disallowEditLabel, preventInactivateNode} = useNodeContext()
    const { manageNodeasInput, manageNodeasLocked, manageNodeasOutput, setNodeEditable, preventInactivateNode, clearAll} = useNodesPerFlowContext()
    const {setNodes, setEdges, getEdges, getNode}  = useReactFlow()
    const {cleanJsonString} = useJsonConstructUtils()
   
    const deleteNode = () => {
        setEdges(prevEdges => prevEdges.filter(edge => edge.source !== nodeid && edge.target !== nodeid));
        setNodes(prevNodes => prevNodes.filter(node => node.id !== nodeid));
    }

    const manageEditLabel = () => {
        setNodeEditable(nodeid)
        preventInactivateNode()
        clearMenu()
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

    const onEmbeddingClick = async () => {
      /**
       * 1. clear menu
       * 2. construct embeddingNodeData
       * 3. construct embeddingViewData
       * 4. setNodes
       */

      // 1. clear menu
        clearMenu()
      // 2. construct embeddingNodeData
        try {
            const embeddingNodeData = constructStructuredNodeEmbeddingData()
            console.log(embeddingNodeData)

            if (embeddingNodeData === "error") {
                throw new Error("Invalid node data")
            }

            
            const embeddingViewData=traverseJson(embeddingNodeData.data.content)

            const embeddingViewDataWithInfo = constructMetadataInfo(embeddingNodeData.data.content, embeddingViewData)

            setNodes(prevNodes => prevNodes.map(
                (node) => {
                  if (node.id === nodeid) {
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
                setNodes(prevNodes => prevNodes.map(node => node.id === nodeid ? {
                  ...node,
                  data: {
                      ...node.data,
                      content: node.data.content,
                      index_name: index_name_response
                  }
              } : node))

              
              setTimeout(() => {
                const newnode = getNode(nodeid)
                console.log("index_name",newnode)
              }, 1200);
              
          }
            
        } catch (error) {
            console.error("Error fetching embedding:", error);
        } finally {
            clearAll()
        }
    }

    const constructStructuredNodeEmbeddingData = () => {
        const node = getNode(nodeid)
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

    const updateNode = (newNode: Node) => {
        setNodes(prevNodes => prevNodes.map(node => node.id === newNode.id ? {
            ...newNode,
            data: {
                ...newNode.data,
                content: node.data.content,
            }
        } : node))
    }

  return (
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
        <ul className='flex flex-col absolute top-[32px] p-[8px] w-[160px] gap-[4px] bg-[#252525] border-[1px] border-[#404040] rounded-[8px] left-0 z-[20000]'>
              {/* <li>
                <button className='flex flex-row items-center justify-start   gap-[8px] w-full h-[26px]  border-none rounded-t-[4px]'
                onClick={()=> manageNodeasInput(nodeid)}>
                <div className='flex items-center justify-center'>
                <svg width="26" height="26" viewBox="0 0 26 26" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M11.5 15V11L14.1667 13L11.5 15Z" fill="#BEBEBE" stroke="#BEBEBE"/>
                <path d="M12 12.9961L7 13.001" stroke="#BEBEBE" stroke-width="2"/>
                <path d="M16.5 8H12.5V6.5H18.5V19.5H12.5V18H16.5H17V17.5V8.5V8H16.5Z" fill="#BEBEBE" stroke="#BEBEBE"/>
                </svg>

                </div>
                <div className='font-plus-jakarta-sans text-[12px] font-normal leading-normal text-[#BEBEBE] whitespace-nowrap'>
                    {getNode(nodeid)?.data?.isInput ? "Unset input" :"Set as input"}
                </div>
                </button>
            </li>
            <li>
                <button className='flex flex-row items-center justify-start  gap-[8px] w-full h-[26px]  border-none'
                onClick={()=> manageNodeasOutput(nodeid)}>
                <div className='flex items-center justify-center'>
                <svg width="26" height="26" viewBox="0 0 26 26" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M15.5 15V11L18.1667 13L15.5 15Z" fill="#BEBEBE" stroke="#BEBEBE"/>
                <path d="M16 12.9961L11 13.001" stroke="#BEBEBE" stroke-width="2"/>
                <path d="M9.5 8H13.5V6.5H7.5V19.5H13.5V18H9.5H9V17.5V8.5V8H9.5Z" fill="#BEBEBE" stroke="#BEBEBE"/>
                </svg>

                </div>
                <div className='font-plus-jakarta-sans text-[12px] font-normal leading-normal text-[#BEBEBE] whitespace-nowrap'>
                    {getNode(nodeid)?.data?.isOutput ? "Unset output" :"Set as output"}
                </div>
                </button>
            </li> */}
            
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
                        {getNode(nodeid)?.data?.locked ? "Unlock the text" : "Lock the text"}
                    </div>
                </button>
            </li>
            {/* <li>
                <button className='flex flex-row items-center justify-start gap-[8px] w-full h-[26px] hover:bg-[#3E3E41] rounded-[4px] border-none text-[#CDCDCD] hover:text-white'
                onClick={onEmbeddingClick}>
                    <div className='flex items-center justify-center w-[26px] h-[26px]'>
                        <span className='font-bold'>E</span>
                    </div>
                    <div className='font-plus-jakarta-sans text-[12px] font-normal leading-normal whitespace-nowrap'>
                        Embedding
                    </div>
                </button>
            </li>
            <li className='w-full h-[1px] bg-[#404040] my-[2px]'></li> */}
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
  )
}

export default JsonNodeSettingMenu