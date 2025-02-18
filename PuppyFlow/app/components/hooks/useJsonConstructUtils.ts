/*
    用于处理局部 workflow 的json 数据 (every step)
*/
import React, { Children } from "react";
import { useReactFlow, Node } from "@xyflow/react";
import { useCallback, useRef } from "react";
import {JsonNodeData} from "../workflow/blockNode/JsonNode"
import {FileNodeData} from "../workflow/blockNode/FileNode"
import {ResultNodeData} from "../workflow/blockNode/ResultNode"
import {SwitchNodeData} from "../workflow/blockNode/SwitchNode"
import {TextBlockNodeData} from "../workflow/blockNode/TextBlockNode"
import {VectorDatabaseNodeData} from "../workflow/blockNode/VectorDatabaseNode"
import {VectorNodeData} from "../workflow/blockNode/VectorNode"
import {WebLinkNodeData} from "../workflow/blockNode/WebLinkNode"
import { SYSTEM_URLS } from "@/config/urls";

// all sourceNodes type connected to edgeNodes (except for load type), 所有可以进行处理的node的type都是json或者text

export const backend_IP_address_for_sendingData = `${SYSTEM_URLS.PUPPY_ENGINE.BASE}/send_data`
export const backend_IP_address_for_receivingData = `${SYSTEM_URLS.PUPPY_ENGINE.BASE}/get_data`
export const PuppyStorage_IP_address_for_uploadingFile = `${SYSTEM_URLS.PUPPY_STORAGE.BASE}/generate_presigned_url`
export const PuppyStorage_IP_address_for_embedding = `${SYSTEM_URLS.PUPPY_STORAGE.BASE}/vector/embed`

export type BasicNodeData = JsonNodeData | FileNodeData | ResultNodeData |  SwitchNodeData | TextBlockNodeData | VectorDatabaseNodeData | VectorNodeData | WebLinkNodeData | {content: string | any, subtype?: string, model?: string, method?: string, vdb_type?: string, index_name?: string}

export interface NodeJsonType {
    // id: string,
    type: string,
    label: string,
    data: BasicNodeData,
    looped?: string|boolean   
}


export interface FileData {
    // id: string;
    type: "text" | "structured" | "switch" | "vector" | "vector_database" | "database" | "file" | "weblink";
    data: {
        content: string | any;
    };
}

export type ProcessingData = {
    // data: FileData[],
    data: { [key: string]: FileData },
    is_complete: boolean,
};


function useJsonConstructUtils() {
    const {getEdges, getNode, setNodes, getNodes, getViewport} = useReactFlow()
    // const {searchNode, totalCount} = useNodeContext()
    const fileInputRef = useRef<HTMLInputElement>(null);

    // const getSourceNodeIds = useCallback((parentId: string): string[] =>  {
    //     return getEdges().filter(edge => edge.target === parentId).map(edge => edge.source).sort((a, b) => Number(a) - Number(b));
    // }, [getEdges])
    /*
        获取edgeNode 的所有 sourceNodes, if label is not exist, then return childnodeid
    */
    // const getSourceNodeLabels = useCallback((parentId: string): string[] =>  {
    //     return getEdges().filter(edge => edge.target === parentId).map(edge => edge.source).map(childnodeid => (getNode(childnodeid)?.data?.label as string | undefined) ?? childnodeid).sort((a, b) => a.localeCompare(b));
    // }, [getEdges])
    
    /*
        获取edgeNode 的所有 sourceNodes, if label is not exist, then return no.childnodeid
    */
    // const getSourceNodeLabelsWithNo = useCallback((parentId: string): string[] =>  {
    //     return getEdges().filter(edge => edge.target === parentId).map(edge => edge.source).map(childnodeid => (getNode(childnodeid)?.data?.label as string | undefined) ?? `no.${childnodeid}`).sort((a, b) => a.localeCompare(b));
    // }, [getEdges])

    const transformBlocksFromSourceNodeIdWithLabelGroup = ( blocks: { [key: string]: NodeJsonType }, sourceNodeIdWithLabelGroup: any) => {
        for (let sourceNodeIdWithLabel of sourceNodeIdWithLabelGroup) {
            const nodeInfo = getNode(sourceNodeIdWithLabel.id);
            console.log("nodeinfo",getNode(sourceNodeIdWithLabel.id))
            if (!nodeInfo) continue;
            const nodeContent = (nodeInfo.type === "structured" || nodeInfo.type === "none" && nodeInfo.data?.subType === "structured") ? cleanJsonString(nodeInfo.data.content as string | any, nodeInfo.type) : nodeInfo.data.content as string;
            if (nodeContent === "error") return new Error("JSON Parsing Error, please check JSON format");
            const nodejson: NodeJsonType = {
                label: (nodeInfo.data.label as string | undefined) ?? nodeInfo.id,
                type: nodeInfo.type!,
                data: {
                    content: nodeContent,
                },
                looped: (nodeInfo as any).looped ? (nodeInfo as any).looped : false
            };
            blocks[nodeInfo.id] = nodejson;
        }
        return blocks
    }
    

    const getSourceNodeIdWithLabel = useCallback((parentId: string) => {
        return getEdges().filter(edge => edge.target === parentId).map(edge => edge.source).map(childnodeid => ({id: childnodeid, label: (getNode(childnodeid)?.data?.label as string | undefined) ?? childnodeid})).sort((a, b) => Number(a.id) - Number(b.id));
    }, [getEdges])

    /* 
        Editor 中获取的JSONString 有空格和空行符号，为了传输给后端没有这些符号，通过这个公式处理
    */
    const cleanJsonString = useCallback((jsonString: string, nodeType?: string) => {
        const type = nodeType?nodeType:"structured"
        
        if(type=="structured"){
            try {
              // 解析 JSON 字符串为 JavaScript 对象
              const jsonObject = JSON.parse(jsonString);
              // 将对象转换回 JSON 字符串，不包含额外的空白字符
              return jsonObject
            //   return JSON.stringify(jsonObject);
            } catch (error) {
              console.error("Invalid JSON:", error);
              return []; // 或者返回原始字符串，取决于你的错误处理策略
            }
        }

        return JSON.parse(`${jsonString}`);
      }, [])

    
    /*
    深度解析 JSONString，还原一个valid JSON 格式，用于从网页上get到的JSON content string -> valid JSON
    */
    // const deepParseJSON = useCallback((jsonString: string) => {
    // try {

    //     // const num = Number(jsonString)
    //     // if (!isNaN(num)) {
    //     //     return jsonString
    //     // }

    //     // 如果是普通数字字符串或纯文本，直接返回
    //     if (!/^[\{\[]/.test(jsonString.trim().replace(/^["']|["']$/g, ''))) {
    //         return jsonString;
    //     }

    //     // 首先尝试解析整个字符串
    //     return JSON.parse(jsonString, (key, value) => {
    //     if (typeof value === 'string') {
    //         // 对于字符串值，我们尝试进行进一步的解析
    //         try {
    //         // 移除首尾的引号（如果存在）
    //         const trimmed = value.trim().replace(/^["']|["']$/g, '');

    //         if (!/^[\{\[]/.test(trimmed)) {
    //             return value
    //         }
            
    //         // 递归调用 deepParseJSON
    //         return deepParseJSON(trimmed);
    //         } catch (e) {
    //         // 如果解析失败，就返回原始字符串
    //         return value;
    //         }
    //     }
    //     return value;
    //     });
    // } catch (e) {
    //     // 如果最外层的解析失败，我们返回原始字符串
    //     return jsonString;
    // }
    // }, [])



    /*
        开放一个持久化的通话session，持续的获得 message 展示在前端 ，session 持续时长 5min
    */
    const streamResult = useCallback(async (taskId: string, resultNode: string | null) => {
        return new Promise((resolve, reject) => {

        const eventSource = new EventSource(`${backend_IP_address_for_receivingData}/${taskId}`);
    
        eventSource.onmessage = (event) => {
            // console.log('!!Raw event data:', typeof event.data, event.data);
            
            try {
                // 步骤 1: 将单引号替换为双引号，python format not valid
                // let jsonString = event.data.replace(/'/g, '"');
                // const data = JSON.parse(jsonString, (key, value) => {
                //     if (typeof value === 'string') {
                //     return value.replace(/\\n/g, '\n');
                //     }
                //     return value;
                // });
                // console.log(data);
                const data = JSON.parse(event.data)
                
                
    
                // 解析数据
                // const data: ProcessingData = JSON.parse(jsonString);
                
                // console.log('Parsed data: !!', data);
    
                // 检查是否收到完成信号
                if (data.is_complete === true) {
                    // console.log(getNodes())
                    // console.log('Processing completed');
                    eventSource.close();
                    resolve(true)
                    return;
                }
    
                // 更新UI或进行其他操作
                // if (ifCodeConfigNodePass) {
                //     updateUIForCode(data, resultNode);
                // }
                // else {
                //     updateUI(data, resultNode);
                // }
                updateUI(data, resultNode);

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


    const streamResultForMultipleNodes = useCallback(async (taskId: string, resultNodes: string[]) => {
        
        return new Promise((resolve, reject) => {

        const eventSource = new EventSource(`${backend_IP_address_for_receivingData}/${taskId}`);
    
        eventSource.onmessage = (event) => {
            // console.log('Raw event data: !!', typeof event.data, event.data);
            
            try {
                // 步骤 1: 将单引号替换为双引号，python format not valid
                // let jsonString = event.data.replace(/'/g, '"');
                // const data = JSON.parse(jsonString, (key, value) => {
                //     if (typeof value === 'string') {
                //     return value.replace(/\\n/g, '\n');
                //     }
                //     return value;
                // });
                // console.log(data);
                // const data = deepParseJSON(event.data)

                let data
                try{
                    console.log("event",event)
                    //event.data ="{\"error\": \"[PE_ERROR_4101]: Error Evaluating Cases!\\nCause: 'conditions'\"}" ERROR
                    data = JSON.parse(event.data)
                }catch(error){
                    console.error('Error convert event data json to object by json parse:', error);
                    reject(error)
                }
                
                
    
                // 解析数据
                // const data: ProcessingData = JSON.parse(jsonString);
                
                // console.log('Parsed data: !!', data);
    
                // 检查是否收到完成信号
                if (data.is_complete === true) {
                    // console.log(getNodes())
                    // console.log('Processing completed');
                    eventSource.close();
                    resolve(true)
                    return;
                }
    
                // 更新UI或进行其他操作
                // if (ifCodeConfigNodePass) {
                //     updateUIForCode(data, resultNode);
                // }
                // else {
                //     updateUI(data, resultNode);
                // }
                updateUIForMultipleNodes(data, resultNodes);

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
    }, [])

  

     /*
       获取新的结果需要更新前端content
    */
       const updateUI = useCallback(async (jsonResult: ProcessingData, resultNode: string | null) => {
        // 将jsonResult.data 转换为 Map
        const data = new Map(Object.entries(jsonResult.data));
        // console.log(`Received ${data.length} file(s)`);
        // console.log(getNodes(), "current nodes in reactflow")
        if (!resultNode) return
        const target = getNode(resultNode)
        if (!target) return
        if (data.has(resultNode)) {
            const item = data.get(resultNode)
            if (item) {
                setNodes(prevNodes => (prevNodes.map(node => node.id === resultNode ? {
                    ...node,
                    type: item.type ?? node.type,
                    data: {
                        ...node.data,
                        content: item.data.content,
                        isLoading: false
                    }
                }: node)))
            }
        }
        // for (let item of data) {
        //     if (item.id !== resultNode) {
        //         continue
        //     }
        //     // console.log(item.id,item.data.content, typeof item.data.content, "check the content type !!")
        //     setNodes(prevNodes => (prevNodes.map(node => node.id === resultNode ? {
        //         ...node,
        //         type: item.type ?? node.type,
        //         data: {
        //             ...node.data,
        //             // content: item.type === "structured" || (!item.type && node.type === "structured") ? JSON.stringify(item.data.content) : typeof item.data.content === "string" ? item.data.content : JSON.stringify(item.data.content),
        //             content: item.data.content,
        //             ...(node.type === "none" ? {subtype: item.type} : {}),
        //             isLoading: false
        //         }
        //     }: node)))
           
            
        //     console.log("Attempting to fetch: !!", item.data.content);
        // }
    }, []);


        const updateUIForMultipleNodes = useCallback(async (jsonResult: ProcessingData, resultNodes: string[]) => {
            // 将jsonResult.data 转换为 Map
            console.log(jsonResult, "jsonResult from backend")
            const data = new Map(Object.entries(jsonResult.data));
            // console.log(`Received ${data.length} file(s)`);
            // console.log(getNodes(), "current nodes in reactflow")
            
            if (!resultNodes.length) return
            const targets = resultNodes.filter(resultNode => getNode(resultNode))
            if (!targets.length) return
            for (let resultNode of resultNodes) {
                console.log(data.has(resultNode), data, resultNode, "if resultNode in data")
                if (!data.has(resultNode)) {
                    continue
                }
                console.log(resultNode, "resultNode found in data from backend")
                const item = data.get(resultNode)
                console.log(item, "item found in data from backend")
                if (item) {
                    setNodes(prevNodes => (prevNodes.map(node => node.id === resultNode ? {
                        ...node,
                        type: item.type ?? node.type,
                        data: {
                            ...node.data,
                            content: item.data.content,
                            isLoading: false
                        }
                    }: node)))
                }
            }
            // for (let item of data) {
            //     if (!resultNodes.includes(item.id)) {
            //         continue
            //     }
            //     // console.log(item.id,item.data.content, typeof item.data.content, "check the content type !!")
            //     setNodes(prevNodes => (prevNodes.map(node => node.id === item.id ? {
            //         ...node,
            //         type: item.type ?? node.type,
            //         data: {
            //             ...node.data,
            //             // content: item.type === "structured" || (!item.type && node.type === "structured") ? JSON.stringify(item.data.content) : typeof item.data.content === "string" ? item.data.content : JSON.stringify(item.data.content),
            //             content: item.data.content,
            //             ...(node.type === "none" ? {subtype: item.type} : {}),
            //             isLoading: false
            //         }
            //     }: node)))
               
                
            //     // console.log("Attempting to fetch: !!", item.data.content);
            // }
    }, [])


    // const updateUIForCode = useCallback(async (jsonResult: ProcessingData, resultNode: nodeSmallProps | null) => {
    //     const data = jsonResult.data;
    //     // console.log(`Received ${data.length} file(s)`);
    //     // console.log(getNodes(), "current nodes in reactflow")
    //     if (!resultNode) return
    //     const target = getNode(resultNode.nodeid)
    //     if (!target) return
    //     for (let item of data) {
    //         if (item.id.toString() !== resultNode.nodeid) {
    //             continue
    //         }
    //         console.log(item.id,item.data.content, typeof item.data.content, "check the content type")
    //         setNodes(prevNodes => (prevNodes.map(node => node.id === resultNode.nodeid ? {
    //             ...node,
    //             type: item.type === "structured" ? "structured" : "text",
    //             data: {
    //                 ...node.data,
    //                 content: node.type === "structured" || item.type === "structured" ? JSON.stringify(item.data.content) : typeof item.data.content === "string" ? item.data.content : JSON.stringify(item.data.content),
    //                 // ...(node.type === "none" ? {subtype: item.type} : {})
    //             }
    //         }: node)))
           
            
    //         console.log("Attempting to fetch:", item.data.content);
    //     }
    // }, []);


    const resetLoadingUI = useCallback((nodeId: string) => {
        setNodes(prevNodes => (prevNodes.map(node => node.id === nodeId ? {...node, data: {...node.data, isLoading: false}} : node)))
    }, [])

    const resetLoadingUIForMultipleNodes = useCallback((nodeIds: string[]) => {
        setNodes(prevNodes => (prevNodes.map(node => nodeIds.includes(node.id) ? {...node, data: {...node.data, isLoading: false}} : node)))
    }, [])


    // for saving to local json file , not for passing to backend
    const constructWholeJsonWorkflow = useCallback(() => {
        const nodes = getNodes()
        const edges = getEdges()
        const viewport = getViewport()

        // for (let node of nodes) {
        //     const myContructNode = searchNode(node.id)
        //     if (myContructNode) {
        //         node.data.locked = myContructNode.locked
        //         node.data.isInput = myContructNode.isInput
        //         node.data.isOutput = myContructNode.isOutput
        //     }
        //     else {
        //         node.data.locked = false
        //         node.data.isInput = false
        //         node.data.isOutput = false
        //     }
        //     node.data.label = node.data.label ?? node.id
        // }
        return {blocks:nodes, edges:edges, viewport:viewport}

    }, [])


    const reportError = useCallback((resultNode: string | null, errorMessage: string) => {
        if (!resultNode) {
            throw new Error(errorMessage)
        }
        const resultNodeid = getNode(resultNode)
        if (resultNodeid) {
            setNodes(prevNodes => (prevNodes.map(node => node.id === resultNode ? {
                ...node,
                data: {
                        ...node.data,
                        content: errorMessage
                            }
                        } : node)))
        }
        throw new Error(errorMessage);
    }, [])


   

    const downloadJsonToLocal = useCallback((jsonData: any) => {
        const jsonString = JSON.stringify(jsonData);
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'data.json'; // 设置默认文件名
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }, []);


      const uploadJsonFromLocal = useCallback((fileName: string = 'workflow.json') => {
        return new Promise<any>((resolve, reject) => {
          if (fileInputRef.current) {
            // 设置 accept 属性以过滤文件类型
            fileInputRef.current.accept = '.json';
            fileInputRef.current.click();
            
            fileInputRef.current.onchange = (event) => {
              const file = (event.target as HTMLInputElement).files?.[0];
              if (file) {
                if (file.name !== fileName) {
                  const confirmUpload = window.confirm(`选择的文件名为 "${file.name}"，而不是 "${fileName}"。是否继续？`);
                  if (!confirmUpload) {
                    reject(new Error('用户取消了上传'));
                    return;
                  }
                }
    
                const reader = new FileReader();
                reader.onload = (e) => {
                  try {
                    const json = JSON.parse(e.target?.result as string);
                    // console.log(json, "json from local")
                    resolve(json);
                  } catch (error) {
                    reject(new Error('无法解析 JSON 文件'));
                  }
                };
                reader.onerror = () => reject(new Error('读取文件时发生错误'));
                reader.readAsText(file);
              } else {
                reject(new Error('��选择文件'));
              }
            };
          } else {
            reject(new Error('文件输入元素不可用'));
          }
        });
      }, []);
    

    return {transformBlocksFromSourceNodeIdWithLabelGroup, getSourceNodeIdWithLabel, cleanJsonString, streamResult, streamResultForMultipleNodes, updateUI, updateUIForMultipleNodes, reportError, resetLoadingUI, resetLoadingUIForMultipleNodes, constructWholeJsonWorkflow, downloadJsonToLocal, uploadJsonFromLocal}


}


export default useJsonConstructUtils
