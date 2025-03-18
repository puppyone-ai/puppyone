import React, { useState, useCallback, useEffect }  from 'react'
import useJsonConstructUtils, {NodeJsonType, FileData} from './useJsonConstructUtils'
import { useReactFlow } from '@xyflow/react'
import {ChunkingAutoEdgeJsonType} from '../workflow/edgesNode/edgeNodeConfig/ChunkingAutoConfigMenu'
import {CodeEdgeJsonType} from '../workflow/edgesNode/edgeNodeConfig/CodeConfigMenu'
import {LLMEdgeJsonType} from '../workflow/edgesNode/edgeNodeConfig/NewLLM'
import {ModifyCopyEdgeJsonType} from '../workflow/edgesNode/edgeNodeConfig/ModifyCopyConfigMenu'
import {ModifyGetEdgeJsonType} from '../workflow/edgesNode/edgeNodeConfig/ModifyGetConfigMenu'
import {ModifyStructuredEdgeJsonType} from '../workflow/edgesNode/edgeNodeConfig/ModifyStructuredConfigMenu'
import {ModifyTextEdgeJsonType} from '../workflow/edgesNode/edgeNodeConfig/ModifyTextConfigMenu'
import {SearchGoogleEdgeJsonType} from '../workflow/edgesNode/edgeNodeConfig/SearchGoogleConfigMenu'
import {SearchPerplexityEdgeJsonType} from '../workflow/edgesNode/edgeNodeConfig/SearchPerplexityConfigMenu'
import {SearchByVectorEdgeJsonType} from '../workflow/edgesNode/edgeNodeConfig/SearchByVectorConfigMenu'
import {ChunkingByCharacterEdgeJsonType} from '../workflow/edgesNode/edgeNodeConfig/ChunkingByCharacterConfigMenu'
import {ChunkingByLengthEdgeJsonType} from '../workflow/edgesNode/edgeNodeConfig/ChunkingByLengthConfigMenu'
import {ChunkingLLMEdgeJsonType} from '../workflow/edgesNode/edgeNodeConfig/ChunkingByLLMConfigMenu'
import {ChunkingHTMLEdgeJsonType} from '../workflow/edgesNode/edgeNodeConfig/ChunkingForHTMLConfigMenu'
import {ChunkingMarkdownEdgeJsonType} from '../workflow/edgesNode/edgeNodeConfig/ChunkingForMarkdownConfigMenu'
import {ChooseEdgeJsonType} from '../workflow/edgesNode/edgeNodeConfig/ChooseConfigMenu'
import {ChunkingConfigNodeData} from '../workflow/edgesNode/edgeNodes/ChunkingConfig'
import {LLMConfigNodeData} from '../workflow/edgesNode/edgeNodes/LLMConfig'
import {ModifyConfigNodeData} from '../workflow/edgesNode/edgeNodes/ModifyConfig'
import {SearchConfigNodeData} from '../workflow/edgesNode/edgeNodes/SearchConfig'
import {ChooseConfigNodeData} from '../workflow/edgesNode/edgeNodes/ChooseConfig'
import {ProcessingData} from './useJsonConstructUtils'
import { CodeConfigNodeData } from '../workflow/edgesNode/edgeNodes/CodeConfig'
import {backend_IP_address_for_sendingData, backend_IP_address_for_receivingData} from './useJsonConstructUtils'

type validEdgeType = ChunkingAutoEdgeJsonType | LLMEdgeJsonType | ModifyCopyEdgeJsonType | ModifyGetEdgeJsonType | ModifyStructuredEdgeJsonType | ModifyTextEdgeJsonType | SearchGoogleEdgeJsonType | SearchPerplexityEdgeJsonType | SearchByVectorEdgeJsonType | ChunkingByCharacterEdgeJsonType | ChunkingByLengthEdgeJsonType | ChunkingLLMEdgeJsonType | ChunkingHTMLEdgeJsonType | ChunkingMarkdownEdgeJsonType | CodeEdgeJsonType | ChooseEdgeJsonType

type validWholeWorkflowJsonType = {
    blocks: { [key: string]: NodeJsonType },
    edges: { [key: string]: validEdgeType }
}

/* send whole workflow data to backend and get updated result , update all results, used only for one file: StartCodeController.tsx */
export default function useWholeWorkflowJsonConstructUtils() {

    
  
    const {getNodes, getNode, setNodes} = useReactFlow()
    const {getSourceNodeIdWithLabel, cleanJsonString} = useJsonConstructUtils()
    const [isComplete, setIsComplete] = useState(true)

    
    const sendWholeWorkflowJsonDataToBackend = async  () => {
        try {
            const jsonData = constructWholeWorkflowJsonData()
            console.log(jsonData, "whole json data in Workflow")
            const response = await fetch(`${backend_IP_address_for_sendingData}`, {
                method:'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(jsonData)
            })
  
            if (!response.ok) {
                throw new Error(`HTTP Error: ${response.status}`)
            }
            
            // console.log(response)
            const result = await response.json();  // 解析响应的 JSON 数据
            // console.log('Success:', result);
            await streamWholeWorkflowResult(result.task_id)
            
            } catch (error) {
                console.warn(`Get Error: ${error}`)
                window.alert(`Get Error: ${error}`)
            } finally {
                // console.log("set isComplete to true")
                setIsComplete(true)
            }   
    }

    /* Possible Error: 
    1. typeError, ResultNode.nodeid undefind, 原因是因为没有生成最终的所有resultNode的情况下传递了json 会报错 
    */
    const constructWholeWorkflowJsonData = (): validWholeWorkflowJsonType | Error => {
        const nodesInWorkflow = getNodes()
    
        let blocks: { [key: string]: NodeJsonType } = {}
        let edges: { [key: string]: validEdgeType } = {}
        for (let nodeInfo of nodesInWorkflow) {
           let nodeContent = ""
           let nodejson: NodeJsonType
           let edgejson: validEdgeType
           let sourceNodeIdWithLabelGroup: {id: string, label: string}[] = []
           let subMenuType = ""
           switch (nodeInfo.type) {
            case "none":
              nodeContent = nodeInfo.data?.subType === "structured" ? cleanJsonString(nodeInfo.data.content as string | any) : nodeInfo.data.content as string
              if (nodeContent === "error") return new Error("Error in Parsing JSON Content")
              nodejson = {
                  // id: nodeInfo.id,
                  label: (nodeInfo.data.label as string | undefined) ?? nodeInfo.id,
                  type: nodeInfo.type!,
                  data: {
                      content: nodeContent,
                      subtype: nodeInfo.data?.subtype as string ?? "text"
                  }
              }
              blocks[nodeInfo.id] = nodejson
              break
            case "structured":
              nodeContent = cleanJsonString(nodeInfo.data.content as string | any)
              if (nodeContent === "error") return new Error("Error in Parsing JSON Content")
              nodejson = {
                  // id: nodeInfo.id,
                  label: (nodeInfo.data.label as string | undefined) ?? nodeInfo.id,
                  type: nodeInfo.type!,
                  data: {
                      content: nodeContent,
                      model: nodeInfo.data.model as string | undefined,
                      method: nodeInfo.data.method as string | undefined,
                      vdb_type: nodeInfo.data.vdb_type as string | undefined,
                      index_name: nodeInfo.data.index_name as string | undefined
                  },
                  looped: (nodeInfo as { looped?: boolean }).looped ?? false
              }
              blocks[nodeInfo.id] = nodejson
              break
            case "text":
            case "file":   
            case "switch":
            case "weblink":
            case "vector":
            case "vector_database":
            case "database":
              nodeContent = nodeInfo.data.content as string
              nodejson = {
                  // id: nodeInfo.id,
                  label: (nodeInfo.data.label as string | undefined) ?? nodeInfo.id,
                  type: nodeInfo.type!,
                  data: {
                      content: nodeContent
                  },
                  looped: (nodeInfo as { looped?: boolean }).looped ?? false
              }
              blocks[nodeInfo.id] = nodejson
              break
            case "load":
              break
            case "chunk":
              subMenuType = (nodeInfo.data as ChunkingConfigNodeData).subMenuType as string ?? ""
              sourceNodeIdWithLabelGroup = getSourceNodeIdWithLabel(nodeInfo.id)
              if (subMenuType === "chunk-Auto") {
                edgejson = {
                  // id: nodeInfo.id,
                  type: "chunk",
                  data: {  
                      inputs: Object.fromEntries(sourceNodeIdWithLabelGroup.map((node: {id: string, label: string}) => ([node.id, node.label]))),
                      chunking_mode: "auto",
                      extra_configs: {},
                      looped: (nodeInfo.data as ChunkingConfigNodeData).looped ?? false,
                      outputs: {[(nodeInfo.data as ChunkingConfigNodeData).resultNode as string]: getNode((nodeInfo.data as ChunkingConfigNodeData).resultNode as string)?.data?.label as string ?? (nodeInfo.data as ChunkingConfigNodeData).resultNode as string}
                  },
                  
                } as ChunkingAutoEdgeJsonType
                edges[nodeInfo.id] = edgejson
          
              }
              else if (subMenuType === "chunk-Bylength") {
                edgejson = {
                  // id: nodeInfo.id,
                  type: "chunk",
                  data: {  
                      inputs: Object.fromEntries(sourceNodeIdWithLabelGroup.map((node: {id: string, label: string}) => ([node.id, node.label]))),
                      chunking_mode: "length",
                      sub_chunking_mode: (nodeInfo.data as ChunkingConfigNodeData).sub_chunking_mode,
                      extra_configs: {
                          chunk_size: (nodeInfo.data as ChunkingConfigNodeData)?.extra_configs?.chunk_size ?? 200,
                          overlap: (nodeInfo.data as ChunkingConfigNodeData)?.extra_configs?.overlap ?? 20,
                          handle_half_word: (nodeInfo.data as ChunkingConfigNodeData)?.extra_configs?.handle_half_word ?? false,
                      },
                      looped: (nodeInfo.data as ChunkingConfigNodeData).looped ?? false,
                      outputs: {[(nodeInfo.data as ChunkingConfigNodeData).resultNode as string]: getNode((nodeInfo.data as ChunkingConfigNodeData).resultNode as string)?.data?.label as string ?? (nodeInfo.data as ChunkingConfigNodeData).resultNode as string}
                  },
                } as ChunkingByLengthEdgeJsonType
                edges[nodeInfo.id] = edgejson
               
              }
              else if (subMenuType === "chunk-Bycharacter") {
                const delimiterConfig = cleanJsonString((nodeInfo.data as ChunkingConfigNodeData)?.content as string) as string[]
                edgejson = {
                  // id: nodeInfo.id,
                  type: "chunk",
                  data: {  
                      inputs: Object.fromEntries(sourceNodeIdWithLabelGroup.map((node: {id: string, label: string}) => ([node.id, node.label]))),
                      chunking_mode: "character",
                      sub_chunking_mode: "character",
                      extra_configs: {delimiters: delimiterConfig},
                      looped: (nodeInfo.data as ChunkingConfigNodeData).looped ?? false,
                      outputs: {[(nodeInfo.data as ChunkingConfigNodeData).resultNode as string]: getNode((nodeInfo.data as ChunkingConfigNodeData).resultNode as string)?.data?.label as string ?? (nodeInfo.data as ChunkingConfigNodeData).resultNode as string}
                      
                  },
                } as ChunkingByCharacterEdgeJsonType
                edges[nodeInfo.id] = edgejson
               
              } 
              else if (subMenuType === "chunk-ByLLM") {
                  edgejson = {
                    // id: nodeInfo.id,
                    type: "chunk",
                    data: {  
                        inputs: Object.fromEntries(sourceNodeIdWithLabelGroup.map((node: {id: string, label: string}) => ([node.id, node.label]))),
                        chunking_mode: "llm",
                        sub_chunking_mode: "llm",
                        extra_configs: {
                            model: (nodeInfo.data as ChunkingConfigNodeData)?.extra_configs?.model ?? "gpt-4o",
                            prompt: (nodeInfo.data as ChunkingConfigNodeData)?.content as string ?? ""
                        },
                        looped: (nodeInfo.data as ChunkingConfigNodeData).looped ?? false,
                        outputs: {[(nodeInfo.data as ChunkingConfigNodeData).resultNode as string]: (getNode((nodeInfo.data as ChunkingConfigNodeData).resultNode as string)?.data?.label as string ?? (nodeInfo.data as ChunkingConfigNodeData).resultNode as string)}
                    },
                  } as ChunkingLLMEdgeJsonType
                  edges[nodeInfo.id] = edgejson
                
              }
              else if (subMenuType === "chunk-ForHTML") {
                const tagValue = cleanJsonString((nodeInfo.data as ChunkingConfigNodeData)?.content as string) || []
                edgejson = {
                  // id: nodeInfo.id,
                  type: "chunk",
                  data: {  
                      inputs: Object.fromEntries(sourceNodeIdWithLabelGroup.map((node: {id: string, label: string}) => ([node.id, node.label]))),
                      chunking_mode: "advanced",
                      sub_chunking_mode: "html",
                      extra_configs: {
                          tags: tagValue
                      },
                      looped: (nodeInfo.data as ChunkingConfigNodeData).looped ?? false,
                      outputs: {[(nodeInfo.data as ChunkingConfigNodeData).resultNode as string]: (getNode((nodeInfo.data as ChunkingConfigNodeData).resultNode as string)?.data?.label as string ?? (nodeInfo.data as ChunkingConfigNodeData).resultNode as string)}
                  },
                 
                } as ChunkingHTMLEdgeJsonType
                edges[nodeInfo.id] = edgejson
              
              }
              else if (subMenuType === "chunk-ForMarkdown") {
                const tagValue = cleanJsonString((nodeInfo.data as ChunkingConfigNodeData)?.content as string) || []
                edgejson = {
                  // id: nodeInfo.id,
                  type: "chunk",
                  data: {  
                      inputs: Object.fromEntries(sourceNodeIdWithLabelGroup.map((node: {id: string, label: string}) => ([node.id, node.label]))),
                      chunking_mode: "advanced",
                      sub_chunking_mode: "markdown",
                      extra_configs: {
                          tags: tagValue
                      },
                      looped: (nodeInfo.data as ChunkingConfigNodeData).looped ?? false,
                      outputs: {[(nodeInfo.data as ChunkingConfigNodeData).resultNode as string]: getNode((nodeInfo.data as ChunkingConfigNodeData).resultNode as string)?.data?.label as string ?? (nodeInfo.data as ChunkingConfigNodeData).resultNode as string}
                      
                  },
                } as ChunkingMarkdownEdgeJsonType
                edges[nodeInfo.id] = edgejson
      
              }
              break
            case "generate":
              break     
            case "llm":
              const messageContent = cleanJsonString(nodeInfo.data.content as string)
              sourceNodeIdWithLabelGroup = getSourceNodeIdWithLabel(nodeInfo.id)
              edgejson = {
                // id: nodeInfo.id,
                type: "llm",
                data: {
                    messages: messageContent !== "error" ? messageContent : [
                        {"role": "system", 
                         "content": "You are an AI"},
                        {"role": "user", 
                        "content": "Answer the question by {{input_ID}}"}
                       ],
                    model: (nodeInfo.data as LLMConfigNodeData)?.model ?? "gpt-4o",
                    base_url: (nodeInfo.data as LLMConfigNodeData)?.base_url ?? "",
                    max_tokens: 4096,
                    temperature: 0.7,
                    structured_output: (nodeInfo.data as LLMConfigNodeData)?.structured_output ?? false,
                    inputs: Object.fromEntries(sourceNodeIdWithLabelGroup.map((node: {id: string, label: string}) => ([node.id, node.label]))),
                    looped: (nodeInfo.data as LLMConfigNodeData).looped ?? false,
                    outputs: {[(nodeInfo.data as LLMConfigNodeData).resultNode as string]: getNode((nodeInfo.data as LLMConfigNodeData).resultNode as string)?.data?.label as string ?? (nodeInfo.data as LLMConfigNodeData).resultNode as string}
                    
                },
              } as LLMEdgeJsonType
              edges[nodeInfo.id] = edgejson
              break
            case "modify":
              subMenuType = (nodeInfo.data as ModifyConfigNodeData).subMenuType as string ?? ""
              sourceNodeIdWithLabelGroup = getSourceNodeIdWithLabel(nodeInfo.id)
              if (subMenuType === "modify-copy") {
                edgejson = {
                  // id: nodeInfo.id,
                  type: "modify",
                  data: { 
                      modify_type: "copy",
                      extra_configs: {}, 
                      inputs: Object.fromEntries(sourceNodeIdWithLabelGroup.map((node: {id: string, label: string}) => ([node.id, node.label]))),
                      looped: (nodeInfo.data as ModifyConfigNodeData).looped ?? false,
                      outputs: {[(nodeInfo.data as ModifyConfigNodeData).resultNode as string]: getNode((nodeInfo.data as ModifyConfigNodeData).resultNode as string)?.data?.label as string ?? (nodeInfo.data as ModifyConfigNodeData).resultNode as string}
                  },
                } as ModifyCopyEdgeJsonType
                edges[nodeInfo.id] = edgejson
              } 
              else if (subMenuType === "modify-get") {
                const mode = (nodeInfo.data as ModifyConfigNodeData).content_type as string ?? "list"

                console.log("modify-get-node-data", nodeInfo)
                edgejson = {
                  // id: nodeInfo.id,
                  type: "modify",
                  data: {  
                      content: `{{${sourceNodeIdWithLabelGroup.map((node: {id: string, label: string}) => (node.label?node.label:node.id))[0]}}}`,
                      modify_type: "edit_structured",
                      extra_configs: {
                        operations:[
                                      {
                                          type:"get",
                                          params: {
                                              path: [...(nodeInfo as any).data.getConfigData.map((el:{value:(string|number)})=>{
                                                  const num = Number(el.value);
                                                  return isNaN(num) ? el.value : num;
                                              })],  // Get the first user's name
                                              default: "Get Failed, value not exist"   // Default value if key doesn't exist
                                          }
                                      }
                                    ]
                      },
                      inputs: Object.fromEntries(sourceNodeIdWithLabelGroup.map((node: {id: string, label: string}) => ([node.id, node.label]))),
                      looped: (nodeInfo.data as ModifyConfigNodeData).looped ?? false,
                      outputs: {[(nodeInfo.data as ModifyConfigNodeData).resultNode as string]: getNode((nodeInfo.data as ModifyConfigNodeData).resultNode as string)?.data?.label as string ?? (nodeInfo.data as ModifyConfigNodeData).resultNode as string}
                  },
                } as ModifyGetEdgeJsonType
                edges[nodeInfo.id] = edgejson
                console.log("modify-get-node-data", edgejson)
              }   
              else if (subMenuType === "modify-structured") {
                edgejson = {
                  // id: nodeInfo.id,
                  type: "modify",
                  data: {  
                    modify_type: "modify_structured",
                    extra_configs: {},
                    content: cleanJsonString(nodeInfo.data.content as string),
                    inputs: Object.fromEntries(sourceNodeIdWithLabelGroup.map((node: {id: string, label: string}) => ([node.id, node.label]))),
                    looped: (nodeInfo.data as ModifyConfigNodeData).looped ?? false,
                    outputs: {[(nodeInfo.data as ModifyConfigNodeData).resultNode as string]: getNode((nodeInfo.data as ModifyConfigNodeData).resultNode as string)?.data?.label as string ?? (nodeInfo.data as ModifyConfigNodeData).resultNode as string}
                  },
                } as ModifyStructuredEdgeJsonType
                edges[nodeInfo.id] = edgejson
              }
              else if (subMenuType === "modify-text") {
                edgejson = {
                  // id: nodeInfo.id,
                  type: "modify",
                  data: {  
                      modify_type: "edit_text",
                      extra_configs: {},
                      content: nodeInfo.data.content as string,
                      inputs: Object.fromEntries(sourceNodeIdWithLabelGroup.map((node: {id: string, label: string}) => ([node.id, node.label]))),
                      looped: (nodeInfo.data as ModifyConfigNodeData).looped ?? false,
                      outputs: {[(nodeInfo.data as ModifyConfigNodeData).resultNode as string]: getNode((nodeInfo.data as ModifyConfigNodeData).resultNode as string)?.data?.label as string ?? (nodeInfo.data as ModifyConfigNodeData).resultNode as string}
                  },
                } as ModifyTextEdgeJsonType
                edges[nodeInfo.id] = edgejson
              }
              break
            case "search":
              subMenuType = (nodeInfo.data as SearchConfigNodeData).subMenuType as string ?? ""
              sourceNodeIdWithLabelGroup = getSourceNodeIdWithLabel(nodeInfo.id)
              if (subMenuType === "search-Vector") {
                const vectorDB_id = (nodeInfo.data as SearchConfigNodeData)?.vector_db?.id
                const vectorDB_label = vectorDB_id ? getNode(vectorDB_id)?.data?.label as string | undefined ?? vectorDB_id : undefined
                const query_id = (nodeInfo.data as SearchConfigNodeData)?.query_id?.id
                const query_label = query_id ? getNode(query_id)?.data?.label as string | undefined ?? query_id : undefined
              // "search-1728709343180": {
              // "type": "search",
              // "data": {
              //     "search_type": "vector",
              //     "inputs": {
              //         "3": "",
              //         "4": ""
              //     },
              //     "outputs": { "5": "" },
              //     "top_k": 10,
              //     "threshold": 0.5,
              //     "extra_configs": {
              //     "model": "text-embedding-ada-002",
              //     "db_type": "pgvector",
              //     "collection_name": "test_collection",
              //     },
              //     "docs_id": {"3": ""},
              //     "query_id": {"4": ""}
              // }
              // }
              // id: parentId,
                edgejson = {
                  // id: nodeInfo.id,
                  type: "search",
                  data: {  
                      search_type: "vector", //vector?
                      // sub_search_type: "vector",
                      inputs: Object.fromEntries(sourceNodeIdWithLabelGroup.map((node: {id: string, label: string}) => ([node.id, node.label]))),
                      outputs: {[(nodeInfo.data as SearchConfigNodeData).resultNode as string]: getNode((nodeInfo.data as SearchConfigNodeData).resultNode as string)?.data?.label as string ?? (nodeInfo.data as SearchConfigNodeData).resultNode as string},
                      top_k: (nodeInfo.data as SearchConfigNodeData)?.top_k ?? 5,
                      threshold: (nodeInfo.data as SearchConfigNodeData)?.extra_configs?.threshold ?? 0.7,
                      extra_configs: {
                        provider: "openai",
                        model: "text-embedding-ada-002",
                        db_type: "pinecone",
                        collection_name: "test_collection"
                      },
                      doc_ids: (getNode(nodeInfo.id)?.data as SearchConfigNodeData)?.nodeLabels?.map((node: {id: string, label: string}) => node.id),
                      query_id: {[query_id as string]: query_label as string},
                      looped: (nodeInfo.data as SearchConfigNodeData).looped ?? false,
                  },
                  id:nodeInfo.id
                } as SearchByVectorEdgeJsonType
                edges[nodeInfo.id] = edgejson
              }
              else if (subMenuType === "search-Elastic") {
    
              }
              else if (subMenuType === "search-Perplexity") {
                edgejson = {
                  // id: nodeInfo.id,
                  type: "search",
                  data: { 
                      search_type:"llm", 
                      sub_search_type:"perplexity",
                      inputs: Object.fromEntries(sourceNodeIdWithLabelGroup.map((node: {id: string, label: string}) => ([node.id, node.label]))),
                      query_id: sourceNodeIdWithLabelGroup.length > 0 ? {[sourceNodeIdWithLabelGroup[0].id]: sourceNodeIdWithLabelGroup[0].label} : {},
                      extra_configs: {model: (nodeInfo.data as SearchConfigNodeData)?.extra_configs?.model ?? "llama-3.1-sonar-small-128k-online"},
                      looped: (nodeInfo.data as SearchConfigNodeData).looped ?? false,
                      outputs: {[(nodeInfo.data as SearchConfigNodeData).resultNode as string]: getNode((nodeInfo.data as SearchConfigNodeData).resultNode as string)?.data?.label as string ?? (nodeInfo.data as SearchConfigNodeData).resultNode as string}
                  },
                } as SearchPerplexityEdgeJsonType
                edges[nodeInfo.id] = edgejson
              }
              else if (subMenuType === "search-Google") {
                edgejson = {
                  // id: nodeInfo.id,
                  type: "search",
                  data: { 
                      search_type:"web", 
                      sub_search_type:"google",
                      top_k: (nodeInfo.data as SearchConfigNodeData)?.top_k ?? 5,
                      inputs: Object.fromEntries(sourceNodeIdWithLabelGroup.map((node: {id: string, label: string}) => ([node.id, node.label]))),
                      query_id: sourceNodeIdWithLabelGroup.length > 0 ? {[sourceNodeIdWithLabelGroup[0].id]: sourceNodeIdWithLabelGroup[0].label} : {},
                      extra_configs: {},
                      looped: (nodeInfo.data as SearchConfigNodeData).looped ?? false,
                      outputs: {[(nodeInfo.data as SearchConfigNodeData).resultNode as string]: getNode((nodeInfo.data as SearchConfigNodeData).resultNode as string)?.data?.label as string ?? (nodeInfo.data as SearchConfigNodeData).resultNode as string}
                  },
                } as SearchGoogleEdgeJsonType
                edges[nodeInfo.id] = edgejson
              }
              break 
            case "code":
              sourceNodeIdWithLabelGroup = getSourceNodeIdWithLabel(nodeInfo.id)
              edgejson = {
                // id: nodeInfo.id,
                type: "code",
                data: {  
                    inputs: Object.fromEntries(sourceNodeIdWithLabelGroup.map((node: {id: string, label: string}) => ([node.id, node.label]))),
                    code: (nodeInfo.data as CodeConfigNodeData).code as string ?? `def func(${sourceNodeIdWithLabelGroup.map(node => `arg_${node.label}`).join(",")}):\n    # write your code here\n    return`,
                    looped: (nodeInfo.data as CodeConfigNodeData).looped ?? false,
                    outputs: {[(nodeInfo.data as CodeConfigNodeData).resultNode as string]: getNode((nodeInfo.data as CodeConfigNodeData).resultNode as string)?.data?.label as string ?? (nodeInfo.data as CodeConfigNodeData).resultNode as string}
                },
              } as CodeEdgeJsonType
              edges[nodeInfo.id] = edgejson
              break
            case "choose":
              sourceNodeIdWithLabelGroup = getSourceNodeIdWithLabel(nodeInfo.id)
              const chooseSwitch = (nodeInfo.data as ChooseConfigNodeData).switch
              const chooseContent = (nodeInfo.data as ChooseConfigNodeData).content
              const chooseOutputs = (nodeInfo.data as ChooseConfigNodeData).resultNodes
              const chooseON = (nodeInfo.data as ChooseConfigNodeData).ON
              const chooseOFF = (nodeInfo.data as ChooseConfigNodeData).OFF
              edgejson = {
                // id: nodeInfo.id,
                type: "choose",
                data: {  
                    switch: chooseSwitch ? {[chooseSwitch as string]: (getNode(chooseSwitch as string)?.data?.label as string ?? chooseSwitch as string)} : undefined,
                    content: chooseContent ? {[chooseContent as string]: (getNode(chooseContent as string)?.data?.label as string ?? chooseContent as string)} : undefined,
                    inputs: Object.fromEntries(sourceNodeIdWithLabelGroup.map((node: {id: string, label: string}) => ([node.id, node.label]))),
                    outputs: chooseOutputs ? Object.fromEntries(chooseOutputs.map((node: string) => ([node, (getNode(node)?.data?.label as string ?? node as string)]))) : {},
                    looped: false,
                    ON: chooseON ? Object.fromEntries(chooseON.map((node: string) => ([node, (getNode(node)?.data?.label as string ?? node as string)]))) : {},
                    OFF: chooseOFF ? Object.fromEntries(chooseOFF.map((node: string) => ([node, (getNode(node)?.data?.label as string ?? node as string)]))) : {}
                },
              } as ChooseEdgeJsonType
              edges[nodeInfo.id] = edgejson
              break
           }  
            
        }
    
        return {
            blocks,
            edges
        }
      }

   
       /*
        开放一个持久化的通话session，持续的更新所有resultblock的结果，用于
        整体run 一遍结果更新所有resultNode, session 持续时长 5min
    */
        const streamWholeWorkflowResult = useCallback(async (taskId: string) => {
          return new Promise((resolve, reject) => { 
            const eventSource = new EventSource(`${backend_IP_address_for_receivingData}/${taskId}`);
        
            eventSource.onmessage = (event) => {
                // console.log('Raw event data:', typeof event.data, event.data);
                
                try {
                    // const data = deepParseJSON(event.data)
                    const data = JSON.parse(event.data)
                    
                    
        
                    // 解析数据
                    // const data: ProcessingData = JSON.parse(jsonString);
                    
                    // console.log('Parsed data:', data);
        
                    // 检查是否收到完成信号
                    if (data.is_complete === true) {
                        // console.log(getNodes())
                        // console.log('Processing completed');
                        eventSource.close();
                        resolve(true)
                        return;
                    }
        
                    // 更新UI或进行其他操作
                    updateWholeWorkflowUI(data);
                } catch (error) {
                    console.error('Error processing event data:', error);
                    reject(error)
                }
            };
        
            eventSource.onerror = (error) => {
                console.error('EventSource failed:', error);
                eventSource.close();
                reject(error)
            };
        
            // 可选：添加一个超时机制
            const timeout = setTimeout(() => {
                console.log('Connection timed out');
                eventSource.close();
                reject(new Error("Connection timed out"))
            }, 300000); // 5分钟超时
        
            // 使用 addEventListener 来监听 'close' 事件
            eventSource.addEventListener('close', () => {
                clearTimeout(timeout);
                console.log('EventSource connection closed');
                // 可以在这里添加其他清理工作或状态更新
            });
          })
        }, []);

     /*
       获取新的结果需要更新前端content
    */
       const updateWholeWorkflowUI = useCallback(async (jsonResult: ProcessingData) => {
        const data = jsonResult.data;
        // console.log(`Received ${data.length} file(s)`);
        // console.log(getNodes(), "current nodes in reactflow")
        
        for (let [nodeid, nodeProps] of Object.entries(data)) {
          
            // console.log(item.id,item.data.content, typeof item.data.content, "check the content type")
            setNodes(prevNodes => (prevNodes.map(node => node.id === nodeid ? {
                ...node,
                type: nodeProps.type ?? node.type,
                data: {
                    ...node.data,
                    // content: item.type === "structured" || (!item.type && node.type === "structured") ? JSON.stringify(item.data.content) : typeof item.data.content === "string" ? item.data.content : JSON.stringify(item.data.content),
                    content: nodeProps.data.content,
                    ...(node.type === "none" ? {subtype: nodeProps.type} : {})
                }
            }: node)))
           
            
            // console.log("Attempting to fetch:", item.data.content);
        }
    }, []);


    return {sendWholeWorkflowJsonDataToBackend, isComplete, setIsComplete, constructWholeWorkflowJsonData}
}
