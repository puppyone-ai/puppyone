import React,{useEffect, useState} from 'react'
// import { useNodeContext } from '../../states/NodeContext'
import { useReactFlow , Position, Node} from '@xyflow/react'
import { useNodesPerFlowContext } from '../../states/NodesPerFlowContext'
import { PuppyStorage_IP_address_for_embedding } from '../../hooks/useJsonConstructUtils'
import useJsonConstructUtils from '../../hooks/useJsonConstructUtils'

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
            if (typeof index_name_response === 'object' && index_name_response !== null && index_name_response.isString) {
                setNodes(prevNodes => prevNodes.map(node => node.id === nodeid ? {
                  ...node,
                  data: {
                      ...node.data,
                      content: node.data.content,
                      index_name: index_name_response
                  }
              } : node))
              console.log("index_name",getNode(nodeid))
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
    <ul className={`flex flex-col absolute top-[24px] py-[8px] w-[128px] bg-[#3E3E41] rounded-[4px] left-0 z-[20000] ${showSettingMenu ? "" : "hidden"}`}>
        <li>
            <button className='flex flex-row items-center justify-start px-[16px]  gap-[8px] w-full h-[24px] bg-[#3E3E41] border-none rounded-t-[4px] '
            onClick={()=> manageNodeasInput(nodeid)}>
            <div className='flex items-center justify-center'>
            <svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 8 8" fill="none">
            <path d="M3 2L5.5 4L3 6V2Z" fill="#BEBEBE"/>
            <path d="M3 4H0" stroke="#BEBEBE" strokeWidth="1.5"/>
            <path d="M4 0H8V8H4V6.5H6.5V1.5H4V0Z" fill="#BEBEBE"/>
            </svg>
            </div>
            <div className='font-plus-jakarta-sans text-[12px] font-normal leading-normal text-[#BEBEBE] whitespace-nowrap'>
                {getNode(nodeid)?.data?.isInput ? "unset input" :"set as input"}
            </div>
            </button>
        </li>
        <li>
            <button className='flex flex-row items-center justify-start px-[16px]  gap-[8px] w-full h-[24px] bg-[#3E3E41] border-none'
            onClick={()=> manageNodeasOutput(nodeid)}>
            <div className='flex items-center justify-center'>
            <svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 8 8" fill="none">
            <path d="M5.5 2L8 4L5.5 6V2Z" fill="#BEBEBE"/>
            <path d="M6 4H3" stroke="#BEBEBE" strokeWidth="1.5"/>
            <path d="M0 0H4V1.5H1.5V6.5H4V8H0V0Z" fill="#BEBEBE"/>
            </svg>
            </div>
            <div className='font-plus-jakarta-sans text-[12px] font-normal leading-normal text-[#BEBEBE] whitespace-nowrap'>
                {getNode(nodeid)?.data?.isOutput ? "unset output" :"set as output"}
            </div>
            </button>
        </li>
        <li>
            <button className='flex flex-row items-center justify-start px-[16px] gap-[9px] w-full h-[24px] bg-[#3E3E41]'
            onClick={()=> manageNodeasLocked(nodeid)}>
            <div className='flex items-center justify-center'>
            <svg xmlns="http://www.w3.org/2000/svg" width="8" height="9" viewBox="0 0 8 9" fill="none">
            <rect y="4" width="8" height="5" fill="#BEBEBE"/>
            <rect x="1.75" y="0.75" width="4.5" height="6.5" rx="2.25" stroke="#BEBEBE" strokeWidth="1.5"/>
            </svg>
            </div>
            <div className='font-plus-jakarta-sans text-[12px] font-normal leading-normal text-[#BEBEBE] whitespace-nowrap'>
                {getNode(nodeid)?.data?.locked ? "Unlock the text" :"Lock the text"}
            </div>
            </button>
        </li>
        <li>
            <div className='h-[1px] w-full bg-[#181818] my-[8px]'></div>
        </li>
        <li>
            <button className='flex flex-row items-center justify-start px-[16px]  gap-[9px] w-full h-[24px] bg-[#3E3E41]'
            onClick={onEmbeddingClick}
            >
            <div className='flex items-center justify-center font-plus-jakarta-sans text-[12px] font-bold leading-normal text-[#BEBEBE] whitespace-nowrap'>
            E
            </div>
            <div className='font-plus-jakarta-sans text-[12px] font-normal leading-normal text-[#BEBEBE] whitespace-nowrap'>
                embedding
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
        <li >
            <button className='flex flex-row items-center justify-start px-[16px] gap-[7px] w-full h-[24px] bg-[#3E3E41] rounded-b-[4px]' onClick={deleteNode}>
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
  )
}

export default JsonNodeSettingMenu