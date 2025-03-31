import React, { useEffect, useRef, useState, useCallback } from 'react'
import { useReactFlow, useStore, ReactFlowState, MarkerType, Node } from '@xyflow/react'
import useJsonConstructUtils, { NodeJsonType, FileData } from '../../../hooks/useJsonConstructUtils'
// import { useNodeContext } from '../../states/NodeContext'
import { useNodesPerFlowContext } from '../../../states/NodesPerFlowContext'
import { ModifyConfigNodeData } from '../edgeNodes/ModifyConfig'
import { backend_IP_address_for_sendingData } from '../../../hooks/useJsonConstructUtils'
import { markerEnd } from '../../connectionLineStyles/ConfigToTargetEdge'
import { nanoid } from 'nanoid'

import { PuppyDropdown } from "../../../misc/PuppyDropDown"


type ModifyGetConfigProps = {
  show: boolean,
  parentId: string,
  type: string,
  MODIFY_GET_TYPE: string,
  MODIFY_DEL_TYPE: string,
  MODIFY_REPL_TYPE: string
}


export type ModifyGetEdgeJsonType = {
  // id: string,
  type: "modify",
  data: {
    content: string, // or dict
    modify_type: "edit_structured",
    extra_configs: {
      "operations": [{
        type: string,
        params: {
          max_depth?: number,
          path?: (string | number)[],  // Get the first user's name
          default?: string      // Default value if key doesn't exist
        }
      }
      ]
    },
    inputs: { [key: string]: string },
    // looped: boolean,
    outputs: { [key: string]: string }
  },

}

type ConstructedModifyGetJsonData = {
  blocks: { [key: string]: NodeJsonType },
  edges: { [key: string]: ModifyGetEdgeJsonType }
}

type modeNames = "list" | "dict"


// Add these new types for the tree structure
type PathNode = {
  id: string,
  key: string, // "key" or "num"
  value: string,
  children: PathNode[]
}

// Replace the PathEditor component with this new TreePathEditor
const TreePathEditor = ({ paths, setPaths }: {
  paths: PathNode[],
  setPaths: React.Dispatch<React.SetStateAction<PathNode[]>>
}) => {

  const addNode = (parentId: string) => {
    setPaths((prevPaths) => {
      const newPaths = JSON.parse(JSON.stringify(prevPaths));
      const findAndAddNode = (nodes: PathNode[]) => {
        for (let node of nodes) {
          if (node.id === parentId) {
            node.children.push({
              id: nanoid(6),
              key: "key",
              value: "",
              children: [],
            });
            return true;
          }
          if (node.children.length && findAndAddNode(node.children)) {
            return true;
          }
        }
        return false;
      };
      findAndAddNode(newPaths);
      return newPaths;
    });
  };

  const deleteNode = (nodeId: string) => {
    setPaths((prevPaths) => {
      const newPaths = JSON.parse(JSON.stringify(prevPaths));
      const findAndDeleteNode = (nodes: PathNode[]) => {
        for (let i = 0; i < nodes.length; i++) {
          if (nodes[i].id === nodeId) {
            nodes.splice(i, 1);
            return true;
          }
          if (nodes[i].children.length && findAndDeleteNode(nodes[i].children)) {
            return true;
          }
        }
        return false;
      };
      findAndDeleteNode(newPaths);
      return newPaths;
    });
  };

  const updateNodeValue = (nodeId: string, value: string) => {
    setPaths((prevPaths) => {
      const newPaths = JSON.parse(JSON.stringify(prevPaths));
      const findAndUpdateNode = (nodes: PathNode[]) => {
        for (let node of nodes) {
          if (node.id === nodeId) {
            node.value = value;
            return true;
          }
          if (node.children.length && findAndUpdateNode(node.children)) {
            return true;
          }
        }
        return false;
      };
      findAndUpdateNode(newPaths);
      return newPaths;
    });
  };

  const updateNodeKey = (nodeId: string, key: string) => {
    setPaths((prevPaths) => {
      const newPaths = JSON.parse(JSON.stringify(prevPaths));
      const findAndUpdateNode = (nodes: PathNode[]) => {
        for (let node of nodes) {
          if (node.id === nodeId) {
            node.key = key;
            return true;
          }
          if (node.children.length && findAndUpdateNode(node.children)) {
            return true;
          }
        }
        return false;
      };
      findAndUpdateNode(newPaths);
      return newPaths;
    });
  };

  const renderNode = (node: PathNode, level = 0) => {
    const isLeafNode = node.children.length === 0;

    return (
      <div key={node.id} className="relative group">
        <div
          className="relative"
          style={{ marginLeft: `${level * 32}px` }}
        >
          {/* SVG connector lines for non-root nodes */}
          {level > 0 && (
            <svg
              className="absolute -left-[16px] top-[-6px]"
              width="17"
              height="21"
              viewBox="0 0 17 21"
              fill="none"
            >
              <path
                d="M1 0L1 20H17"
                stroke="#6D7177"
                strokeWidth="1"
                strokeOpacity="0.5"
                fill="none"
              />
            </svg>
          )}

          <div className="flex items-center gap-2 mb-1.5">
            <div className="flex-1 relative h-[32px] bg-[#252525] rounded-[6px] border-[1px] border-[#6D7177]/30 hover:border-[#6D7177]/50 transition-colors overflow-hidden">
              <input
                value={node.value}
                onChange={(e) => updateNodeValue(node.id, e.target.value)}
                className='w-full h-full bg-transparent border-none outline-none pl-[72px] pr-2
                         text-[#CDCDCD] text-[12px] font-medium appearance-none'
                placeholder={node.key === 'num' ? 'Enter number...' : 'Enter key...'}
              />

              {/* Floating type selector */}
              <div
                className={`absolute left-[6px] top-1/2 -translate-y-1/2 h-[20px] flex items-center 
                           px-2 rounded-[4px] cursor-pointer transition-colors
                           ${node.key === 'key'
                    ? 'bg-[#2D2544] border border-[#9B6DFF]/30 hover:border-[#9B6DFF]/50 hover:bg-[#2D2544]/80'
                    : 'bg-[#443425] border border-[#FF9B4D]/30 hover:border-[#FF9B4D]/50 hover:bg-[#443425]/80'}`}
                onClick={() => {
                  updateNodeKey(node.id, node.key === 'key' ? 'num' : 'key');
                }}
              >
                <div className={`text-[10px] font-semibold min-w-[24px] text-center
                               ${node.key === 'key'
                    ? 'text-[#9B6DFF]'
                    : 'text-[#FF9B4D]'}`}>
                  {node.key}
                </div>
              </div>
            </div>

            <button
              onClick={() => deleteNode(node.id)}
              className='p-0.5 w-6 h-6 flex items-center justify-center text-[#6D7177] hover:text-[#ff4d4d] transition-colors'
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path d="M18 6L6 18M6 6l12 12" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>

        <div className="relative">
          {node.children.map((child) => renderNode(child, level + 1))}

          {isLeafNode && level < 5 && (
            <div className="flex items-center" style={{ marginLeft: `${level * 32 + 32}px` }}>
              <button
                onClick={() => addNode(node.id)}
                className='w-6 h-6 flex items-center justify-center rounded-md
                          bg-[#252525] border-[1px] border-[#6D7177]/30
                          text-[#6D7177]
                          hover:border-[#6D7177]/50 hover:bg-[#1E1E1E] 
                          transition-colors'
              >
                <svg width="10" height="10" viewBox="0 0 14 14">
                  <path d="M7 0v14M0 7h14" stroke="currentColor" strokeWidth="2" />
                </svg>
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className='flex flex-col gap-3'>
      {paths.length === 0 ? (
        <button
          onClick={() => setPaths([{ id: nanoid(6), key: "key", value: "", children: [] }])}
          className='w-full h-[32px] flex items-center justify-center gap-2 rounded-[6px] 
                   border border-[#6D7177]/30 bg-[#252525] text-[#CDCDCD] text-[12px] font-medium 
                   hover:border-[#6D7177]/50 hover:bg-[#1E1E1E] transition-colors'
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#6D7177">
            <path d="M12 5v14M5 12h14" strokeWidth="2" strokeLinecap="round" />
          </svg>
          Create Root Node
        </button>
      ) : (
        paths.map((path) => renderNode(path))
      )}
    </div>
  );
};

function ModifyGetConfigMenu({ show, parentId }: ModifyGetConfigProps) {
  const menuRef = useRef<HTMLUListElement>(null)
  const { getNode, setNodes, setEdges } = useReactFlow()
  const { getSourceNodeIdWithLabel, getTargetNodeIdWithLabel, cleanJsonString, streamResult, reportError, resetLoadingUI, transformBlocksFromSourceNodeIdWithLabelGroup } = useJsonConstructUtils()
  // const {addNode, addCount, allowActivateNode, clear, totalCount} = useNodeContext()
  const { clearAll } = useNodesPerFlowContext()
  const modeRef = useRef<HTMLSelectElement>(null)
  const [mode, setMode] = useState<modeNames>(
    (getNode(parentId)?.data as ModifyConfigNodeData).content_type === "dict" ? "dict" : "list"
  )
  const numKeyRef = useRef<HTMLInputElement>(null)
  const [numKeyValue, setNumKeyValue] = useState<string | number>(
    (getNode(parentId) as Node)?.data.content_type === "list"
      ? ((getNode(parentId)?.data as ModifyConfigNodeData).extra_configs.index as number) :
      (getNode(parentId)?.data.content_type === "dict")
        ? ((getNode(parentId)?.data as ModifyConfigNodeData).extra_configs.key as string) : ""
  )
  const [resultNode, setResultNode] = useState<string | null>((getNode(parentId)?.data as ModifyConfigNodeData)?.resultNode ?? null)
  // const [isAddContext, setIsAddContext] = useState(true)
  const [isAddFlow, setIsAddFlow] = useState(true)
  const [isComplete, setIsComplete] = useState(true)
  // const [isLoop, setIsLoop] = useState((getNode(parentId)?.data as ModifyConfigNodeData)?.looped ?? false)


  const MODIFY_GET_TYPE = "get"
  const MODIFY_DEL_TYPE = "delete"
  const MODIFY_REPL_TYPE = "replace"
  const MODIFY_GET_ALL_KEYS = "get_keys"
  const MODIFY_GET_ALL_VAL = "get_values"

  const [execMode, setExecMode] = useState(getNode(parentId)?.data.type as string || MODIFY_GET_TYPE)

  // 添加复制功能状态
  const [copiedLabel, setCopiedLabel] = useState<string | null>(null);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(`{{${text}}}`).then(() => {
      setCopiedLabel(text);
      setTimeout(() => setCopiedLabel(null), 1000);
    }).catch(err => {
      console.warn('Failed to copy:', err);
    });
  };

  useEffect(
    () => {
      setNodes(prevNodes => prevNodes.map(node => {
        if (node.id === parentId) {
          return { ...node, data: { ...node.data, type: execMode } }; // Update the cases in the node's data
        }
        return node;
      }))
    }, [execMode]
  )

  const onFocus: () => void = () => {
    const curRef = menuRef.current
    if (curRef && !curRef.classList.contains("nodrag")) {
      curRef.classList.add("nodrag")
    }
  }

  const onBlur: () => void = () => {
    const curRef = menuRef.current
    if (curRef) {
      curRef.classList.remove("nodrag")
    }
  }

  // trigger when states change, reactflow ConfigNodes data properties should be updated
  useEffect(() => {
    onModeChange()
  }, [mode])

  useEffect(() => {
    onNumKeyChange()
  }, [numKeyValue])

  // useEffect(() => {
  //     onLoopChange(isLoop)
  // }, [isLoop])

  // useEffect(() => {
  //     onResultNodeChange()
  // }, [resultNode])

  useEffect(() => {
    if (isComplete) return;

    const runWithTargetNodes = async () => {
      // Get target nodes
      const targetNodeIdWithLabelGroup = getTargetNodeIdWithLabel(parentId);

      if (targetNodeIdWithLabelGroup.length === 0 && !isAddFlow) {
        // No target nodes, need to create one
        await createNewTargetNode();
        setIsAddFlow(true);
      } else if (isAddFlow) {
        // Target nodes exist, send data
        await sendDataToTargets();
      }
    };

    runWithTargetNodes();
  }, [isAddFlow, isComplete, parentId]);

  const createNewTargetNode = async () => {
    const parentEdgeNode = getNode(parentId);
    if (!parentEdgeNode) return;

    const newTargetId = nanoid(6);
    setResultNode(newTargetId);

    const location = {
      x: parentEdgeNode.position.x + 160,
      y: parentEdgeNode.position.y - 64,
    };

    const newNode = {
      id: newTargetId,
      position: location,
      data: {
        content: "",
        label: newTargetId,
        isLoading: true,
        locked: false,
        isInput: false,
        isOutput: false,
        editable: false,
      },
      type: 'structured',
    };

    const newEdge = {
      id: `connection-${Date.now()}`,
      source: parentId,
      target: newTargetId,
      type: "floating",
      data: {
        connectionType: "CTT",
      },
      markerEnd: markerEnd,
    };

    await Promise.all([
      new Promise(resolve => {
        setNodes(prevNodes => {
          resolve(null);
          return [...prevNodes, newNode];
        });
      }),
      new Promise(resolve => {
        setEdges(prevEdges => {
          resolve(null);
          return [...prevEdges, newEdge];
        });
      }),
    ]);

    // Update parent node to reference the result node
    setNodes(prevNodes => prevNodes.map(node => {
      if (node.id === parentId) {
        return { ...node, data: { ...node.data, resultNode: newTargetId } };
      }
      return node;
    }));
  };

  const sendDataToTargets = async () => {
    const targetNodeIdWithLabelGroup = getTargetNodeIdWithLabel(parentId);
    if (targetNodeIdWithLabelGroup.length === 0) return;

    // Mark all target nodes as loading
    setNodes(prevNodes => prevNodes.map(node => {
      if (targetNodeIdWithLabelGroup.some(targetNode => targetNode.id === node.id)) {
        return { ...node, data: { ...node.data, content: "", isLoading: true } };
      }
      return node;
    }));

    try {
      const jsonData = constructJsonData();
      console.log(jsonData);
      const response = await fetch(`${backend_IP_address_for_sendingData}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(jsonData)
      });

      if (!response.ok) {
        // Report error for all target nodes
        targetNodeIdWithLabelGroup.forEach(node => {
          reportError(node.id, `HTTP Error: ${response.status}`);
        });
      }

      console.log(response);
      const result = await response.json();
      console.log('Success:', result);

      // Stream results to all target nodes
      await Promise.all(targetNodeIdWithLabelGroup.map(node =>
        streamResult(result.task_id, node.id)
      ));
    } catch (error) {
      console.warn(error);
      window.alert(error);
    } finally {
      // Reset loading state for all target nodes
      targetNodeIdWithLabelGroup.forEach(node => {
        resetLoadingUI(node.id);
      });
      setIsComplete(true);
    }
  };

  const displaySourceNodeLabels = () => {
    const sourceNodeIdWithLabelGroup = getSourceNodeIdWithLabel(parentId)
    return sourceNodeIdWithLabelGroup.map((node: { id: string, label: string }) => {
      // Get the node type from the node data
      const nodeInfo = getNode(node.id)
      const nodeType = nodeInfo?.type || 'text' // Default to text if type not found

      // Define colors based on node type
      let colorClasses = {
        text: {
          active: 'bg-[#3B9BFF]/20 border-[#3B9BFF] text-[#39BC66]',
          default: 'bg-[#252525] border-[#3B9BFF]/50 text-[#3B9BFF] hover:border-[#3B9BFF]/80 hover:bg-[#3B9BFF]/5'
        },
        file: {
          active: 'bg-[#9E7E5F]/20 border-[#9E7E5F] text-[#39BC66]',
          default: 'bg-[#252525] border-[#9E7E5F]/50 text-[#9E7E5F] hover:border-[#9E7E5F]/80 hover:bg-[#9E7E5F]/5'
        },
        structured: {
          active: 'bg-[#9B7EDB]/20 border-[#9B7EDB] text-[#39BC66]',
          default: 'bg-[#252525] border-[#9B7EDB]/50 text-[#9B7EDB] hover:border-[#9B7EDB]/80 hover:bg-[#B0A4E3]/5'
        }
      }

      // Define SVG icons for each node type, using the provided references
      const nodeIcons = {
        text: (
          <svg width="12" height="12" viewBox="0 0 20 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="group">
            <path d="M3 8H17" className="stroke-current" strokeWidth="1.5" strokeLinecap="round" />
            <path d="M3 12H15" className="stroke-current" strokeWidth="1.5" strokeLinecap="round" />
            <path d="M3 16H13" className="stroke-current" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        ),
        file: (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="group">
            <path d="M4 6H10L12 8H20V18H4V6Z" className="fill-transparent stroke-current" strokeWidth="1.5" />
            <path d="M8 13.5H16" className="stroke-current" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        ),
        structured: (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="group">
            <path d="M8 6.5V5H4V7.5V16.5V19H8V17.5H5.5V6.5H8Z" className="fill-current" />
            <path d="M16 6.5V5H20V7.5V16.5V19H16V17.5H18.5V6.5H16Z" className="fill-current" />
            <path d="M9 9H11V11H9V9Z" className="fill-current" />
            <path d="M9 13H11V15H9V13Z" className="fill-current" />
            <path d="M13 9H15V11H13V9Z" className="fill-current" />
            <path d="M13 13H15V15H13V13Z" className="fill-current" />
          </svg>
        )
      }

      // Choose the appropriate color classes based on node type
      const colors = colorClasses[nodeType as keyof typeof colorClasses] || colorClasses.text

      // Choose the appropriate icon based on node type
      const icon = nodeIcons[nodeType as keyof typeof nodeIcons] || nodeIcons.text

      return (
        <button
          key={`${node.id}-${parentId}`}
          onClick={() => copyToClipboard(node.label)}
          className={`flex items-center gap-[4px] px-[8px] h-[20px] rounded-[4px] 
                             border-[1px] text-[10px] font-medium transition-all duration-200
                             ${copiedLabel === node.label
              ? colors.active
              : colors.default}`}
        >
          <div className="flex-shrink-0">
            {icon}
          </div>
          <span className="truncate max-w-[100px]">
            {copiedLabel === node.label ? 'Copied!' : `{{${node.label}}}`}
          </span>
        </button>
      )
    })
  }

  const displayTargetNodeLabels = () => {
    const targetNodeIdWithLabelGroup = getTargetNodeIdWithLabel(parentId)
    return targetNodeIdWithLabelGroup.map((node: { id: string, label: string }) => {
      // Get the node type from the node data
      const nodeInfo = getNode(node.id)
      const nodeType = nodeInfo?.type || 'text'

      // 使用与 displaySourceNodeLabels 相同的样式配置
      let colorClasses = {
        text: {
          active: 'bg-[#3B9BFF]/20 border-[#3B9BFF] text-[#39BC66]',
          default: 'bg-[#252525] border-[#3B9BFF]/50 text-[#3B9BFF] hover:border-[#3B9BFF]/80 hover:bg-[#3B9BFF]/5'
        },
        file: {
          active: 'bg-[#9E7E5F]/20 border-[#9E7E5F] text-[#39BC66]',
          default: 'bg-[#252525] border-[#9E7E5F]/50 text-[#9E7E5F] hover:border-[#9E7E5F]/80 hover:bg-[#9E7E5F]/5'
        },
        structured: {
          active: 'bg-[#9B7EDB]/20 border-[#9B7EDB] text-[#39BC66]',
          default: 'bg-[#252525] border-[#9B7EDB]/50 text-[#9B7EDB] hover:border-[#9B7EDB]/80 hover:bg-[#B0A4E3]/5'
        }
      }

      // 使用相同的图标
      const nodeIcons = {
        text: (
          <svg width="12" height="12" viewBox="0 0 20 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="group">
            <path d="M3 8H17" className="stroke-current" strokeWidth="1.5" strokeLinecap="round" />
            <path d="M3 12H15" className="stroke-current" strokeWidth="1.5" strokeLinecap="round" />
            <path d="M3 16H13" className="stroke-current" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        ),
        file: (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="group">
            <path d="M4 6H10L12 8H20V18H4V6Z" className="fill-transparent stroke-current" strokeWidth="1.5" />
            <path d="M8 13.5H16" className="stroke-current" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        ),
        structured: (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="group">
            <path d="M8 6.5V5H4V7.5V16.5V19H8V17.5H5.5V6.5H8Z" className="fill-current" />
            <path d="M16 6.5V5H20V7.5V16.5V19H16V17.5H18.5V6.5H16Z" className="fill-current" />
            <path d="M9 9H11V11H9V9Z" className="fill-current" />
            <path d="M9 13H11V15H9V13Z" className="fill-current" />
            <path d="M13 9H15V11H13V9Z" className="fill-current" />
            <path d="M13 13H15V15H13V13Z" className="fill-current" />
          </svg>
        )
      }

      const colors = colorClasses[nodeType as keyof typeof colorClasses] || colorClasses.text
      const icon = nodeIcons[nodeType as keyof typeof nodeIcons] || nodeIcons.text

      return (
        <button
          key={`${node.id}-${parentId}`}
          onClick={() => copyToClipboard(node.label)}
          className={`flex items-center gap-[4px] px-[8px] h-[20px] rounded-[4px] 
                             border-[1px] text-[10px] font-medium transition-all duration-200
                             ${copiedLabel === node.label
              ? colors.active
              : colors.default}`}
        >
          <div className="flex-shrink-0">
            {icon}
          </div>
          <span className="truncate max-w-[100px]">
            {copiedLabel === node.label ? 'Copied!' : `{{${node.label}}}`}
          </span>
        </button>
      )
    })
  }

  const constructJsonData = (): ConstructedModifyGetJsonData => {
    const sourceNodeIdWithLabelGroup = getSourceNodeIdWithLabel(parentId);
    const targetNodeIdWithLabelGroup = getTargetNodeIdWithLabel(parentId);

    // 创建包含所有连接节点的 blocks
    let blocks: { [key: string]: NodeJsonType } = {};

    // 添加源节点的信息
    transformBlocksFromSourceNodeIdWithLabelGroup(blocks, sourceNodeIdWithLabelGroup);

    // 添加目标节点的信息
    targetNodeIdWithLabelGroup.forEach(({ id: nodeId, label: nodeLabel }) => {
      blocks[nodeId] = {
        label: nodeLabel,
        type: "structured",
        data: { content: "" }
      };
    });

    // 创建 edges
    let edges: { [key: string]: ModifyGetEdgeJsonType } = {};

    const inputs = Object.fromEntries(sourceNodeIdWithLabelGroup.map((node: { id: string, label: string }) => ([node.id, node.label])));
    const input_label = sourceNodeIdWithLabelGroup.map((node: { id: string, label: string }) => (node.label || node.id))[0];

    const edgejson: ModifyGetEdgeJsonType = {
      type: "modify",
      data: {
        content: `{{${input_label}}}`,
        modify_type: "edit_structured",
        extra_configs: {
          operations: [
            {
              type: execMode === MODIFY_REPL_TYPE ? "set_value" : execMode,
              params: (execMode === MODIFY_GET_ALL_KEYS || execMode === MODIFY_GET_ALL_VAL) ? {
                "max_depth": 100
              } : {
                path: [...getConfigDataa().map(({ key, value }) => {
                  const num = Number(value);
                  return isNaN(num) ? value : num;
                })],
                ...(execMode === MODIFY_GET_TYPE && { default: "Get Failed, value not exist" }),
                ...(execMode === MODIFY_REPL_TYPE && { value: paramv })
              }
            }
          ]
        },
        inputs: inputs,
        outputs: Object.fromEntries(targetNodeIdWithLabelGroup.map(node => ([node.id, node.label])))
      },
    };

    edges[parentId] = edgejson;
    console.log("ModifyGet JSON Data:", { blocks, edges });

    return {
      blocks,
      edges
    };
  };

  const onDataSubmit = async () => {
    // Clear activation
    await new Promise(resolve => {
      clearAll();
      resolve(null);
    });

    const targetNodeIdWithLabelGroup = getTargetNodeIdWithLabel(parentId);
    console.log(targetNodeIdWithLabelGroup, "target nodes");

    // Check if there are target nodes
    if (targetNodeIdWithLabelGroup.length === 0) {
      // No target nodes, need to create one
      setIsAddFlow(false);
    } else {
      // Target nodes exist, update them
      setIsAddFlow(true);
    }

    setIsComplete(false);
  };

  const onModeChange = () => {
    setNodes(prevNodes => prevNodes.map(node => {
      if (node.id === parentId) {
        // return {...node, data: {...node.data, content_type: modeRef.current.value as modeNames}}
        return { ...node, data: { ...node.data, content_type: mode } }
      }
      return node
    }))
  }

  const onNumKeyChange = () => {
    setNodes(prevNodes => prevNodes.map(node => {
      if (node.id === parentId) {
        // return {...node, data: {...node.data, extra_configs: { index: mode === "list" ? Number(numKeyRef.current.value) : undefined, key: mode === "dict" ? numKeyRef.current.value : undefined}}
        return { ...node, data: { ...node.data, extra_configs: { index: (typeof numKeyValue === "number" ? numKeyValue : undefined), key: (typeof numKeyValue === "string" ? numKeyValue : undefined) } } }
      }
      return node
    }))
  }


  const onLoopChange = (newLoop: boolean) => {
    setNodes(prevNodes => prevNodes.map(node => {
      if (node.id === parentId) {
        return { ...node, data: { ...node.data, looped: newLoop } }
      }
      return node
    }))
  }

  const onResultNodeChange = (newResultNode: string) => {
    setNodes(prevNodes => prevNodes.map(node => {
      if (node.id === parentId) {
        return { ...node, data: { ...node.data, resultNode: newResultNode } }
      }
      return node
    }))
  }

  //   const[getConfigData, setGetConfigData ]=useState<{ key: string, value: string }[]>(getNode(parentId)?.data.getConfigData as [] || [
  //     {
  //         key:"key",
  //         value:""
  //     },
  //   ])

  const setGetConfigDataa = (resolveData: (data: { key: string; value: string; }[]) => { key: string; value: string; }[]) => {
    setNodes(prevNodes => prevNodes.map(node => {
      if (node.id === parentId) {
        return { ...node, data: { ...node.data, getConfigData: resolveData(getConfigDataa()) } }; // Update the cases in the node's data
      }
      return node;
    }))
  }

  const getConfigDataa = (): Array<{ key: string, value: string }> =>
    (getNode(parentId)?.data.getConfigData as Array<{ key: string, value: string }>) || [
      {
        key: "key",
        value: ""
      },
    ];

  const [paramv, setParamv] = useState("")

  useEffect(
    () => {
      setNodes(prevNodes => prevNodes.map(node => {
        if (node.id === parentId) {
          return {
            ...node, data: {
              ...node.data,
              params: {
                ...node.data.params as object,
                value: paramv
              }
            }
          }
        }
        return node
      }))
    },
    [paramv]
  )

  // Add this new state for tree path structure
  const [pathTree, setPathTree] = useState<PathNode[]>(() => {
    // Try to convert existing flat path to tree structure if available
    const existingData = getConfigDataa();
    if (existingData && existingData.length > 0) {
      // Create a simple tree with the existing path items
      const rootNode: PathNode = {
        id: nanoid(6),
        key: existingData[0]?.key || "key",
        value: existingData[0]?.value || "",
        children: []
      };

      let currentNode = rootNode;
      for (let i = 1; i < existingData.length; i++) {
        const item = existingData[i];
        if (item) {
          const newNode: PathNode = {
            id: nanoid(6),
            key: item.key || "key",
            value: item.value || "",
            children: []
          };
          currentNode.children.push(newNode);
          currentNode = newNode;
        }
      }

      return [rootNode];
    }

    // Default empty tree with one root node
    return [{
      id: nanoid(6),
      key: "key",
      value: "",
      children: []
    }];
  });

  // Function to flatten the tree structure into a path array
  const flattenPathTree = (nodes: PathNode[]): { key: string, value: string }[] => {
    const result: { key: string, value: string }[] = [];

    const traverse = (node: PathNode) => {
      result.push({ key: node.key, value: node.value });
      if (node.children.length > 0) {
        traverse(node.children[0]); // We only follow the first child in each level
      }
    };

    if (nodes.length > 0) {
      traverse(nodes[0]);
    }

    return result;
  };

  // Effect to update the flat path when tree changes
  useEffect(() => {
    const flatPath = flattenPathTree(pathTree);
    setGetConfigDataa(() => flatPath);
  }, [pathTree]);

  return (

    <ul ref={menuRef} className={`absolute top-[58px] left-0 text-white w-[416px] rounded-[16px] border-[1px] border-[#6D7177] bg-[#1A1A1A] p-[12px] font-plus-jakarta-sans flex flex-col gap-[16px] ${show ? "" : "hidden"} shadow-lg`} >
      <li className='flex h-[28px] gap-1 items-center justify-between font-plus-jakarta-sans'>

        <div className='flex flex-row gap-[12px]'>
          <div className='flex flex-row gap-[8px] justify-center items-center'>
            <div className='w-[24px] h-[24px] border-[1px] border-main-grey bg-main-black-theme rounded-[8px] flex items-center justify-center'>
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M2 10H10" stroke="#CDCDCD" strokeWidth="1.5" />
                <path d="M8.5 2L9.5 3L5 7.5L3 8L3.5 6L8 1.5L9 2.5" stroke="#CDCDCD" strokeWidth="1.5" />
              </svg>

            </div>
            <div className='flex items-center justify-center text-[14px] font-semibold text-main-grey font-plus-jakarta-sans leading-normal'>
              Modify
            </div>
          </div>
          <div className='flex flex-row gap-[8px] justify-center items-center'>
            <div className='w-[24px] h-[24px] border-[1px] border-main-grey bg-main-black-theme rounded-[8px] flex items-center justify-center'>
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M8.5 2.5L11.5 5.5L5 12H2V9L8.5 2.5Z" stroke="#CDCDCD" strokeWidth="1.5" />
                <path d="M8.5 2.5L9.5 1.5L12.5 4.5L11.5 5.5" stroke="#CDCDCD" strokeWidth="1.5" />
              </svg>
            </div>
            <div className='flex items-center justify-center text-[14px] font-semibold text-main-grey font-plus-jakarta-sans leading-normal'>
              Edit
            </div>
          </div>
        </div>
        <div className='flex flex-row gap-[8px] items-center justify-center'>
          <button className='w-[57px] h-[26px] rounded-[8px] bg-[#39BC66] text-[#000] text-[12px] font-semibold font-plus-jakarta-sans flex flex-row items-center justify-center gap-[7px]'
            onClick={onDataSubmit}>
            <span>
              <svg xmlns="http://www.w3.org/2000/svg" width="8" height="10" viewBox="0 0 8 10" fill="none">
                <path d="M8 5L0 10V0L8 5Z" fill="black" />
              </svg>
            </span>
            <span>
              Run
            </span>
          </button>
        </div>
      </li>
      {/* Side-by-side Input/Output section with labels outside */}
      <li className='flex flex-row gap-[12px]'>
        {/* Input section - left side */}
        <div className='flex-1 flex flex-col gap-1'>
          <label className='text-[11px] font-regular text-[#6D7177] ml-1'>Input</label>

          <div className='p-[8px] bg-transparent rounded-[8px] border-[1px] border-dashed border-[#6D7177]/30 hover:border-[#6D7177]/50 transition-colors min-h-[36px]'>
            <div className='flex flex-wrap gap-2'>
              {displaySourceNodeLabels()}
            </div>
          </div>
        </div>

        {/* Output section - right side */}
        <div className='flex-1 flex flex-col gap-1'>
          <label className='text-[11px] font-regular text-[#6D7177] ml-1'>Output</label>
          <div className='p-[8px] bg-transparent rounded-[8px] border-[1px] border-dashed border-[#6D7177]/30 hover:border-[#6D7177]/50 transition-colors min-h-[36px]'>
            <div className='flex flex-wrap gap-2'>
              {displayTargetNodeLabels()}
            </div>
          </div>
        </div>
      </li>
      <li className='flex flex-col gap-2'>
        <div className='flex items-center gap-2'>
          <label className='text-[13px] font-semibold text-[#6D7177]'>Mode</label>
          <div className='w-[5px] h-[5px] rounded-full bg-[#FF4D4D]'></div>
        </div>
        <div className='flex gap-2 bg-[#1E1E1E] rounded-[8px] border-[1px] border-[#6D7177]/30 hover:border-[#6D7177]/50 transition-colors'>
          <PuppyDropdown
            options={[MODIFY_GET_TYPE, MODIFY_DEL_TYPE, MODIFY_REPL_TYPE, MODIFY_GET_ALL_KEYS, MODIFY_GET_ALL_VAL]}
            onSelect={(option: string) => setExecMode(option)}
            selectedValue={execMode}
            listWidth={"200px"}
            mapValueTodisplay={(v: string) => {
              if (v === MODIFY_GET_ALL_KEYS) return "get all keys"
              if (v === MODIFY_GET_ALL_VAL) return "get all values"
              return v
            }}
          />
        </div>
      </li>

      {!(execMode === MODIFY_GET_ALL_KEYS || execMode === MODIFY_GET_ALL_VAL) && (
        <li className='flex flex-col gap-2'>
          <div className='flex items-center gap-2'>
            <label className='text-[13px] font-semibold text-[#6D7177]'>Path</label>
            <div className='w-[5px] h-[5px] rounded-full bg-[#FF4D4D]'></div>
          </div>
          <div className='flex flex-col gap-4 p-2 bg-[#1E1E1E] rounded-[8px] border-[1px] border-[#6D7177]/30'>
            <TreePathEditor paths={pathTree} setPaths={setPathTree} />
          </div>
        </li>
      )}

      {execMode === MODIFY_REPL_TYPE && (
        <li className='flex flex-col gap-2'>
          <div className='flex items-center gap-2'>
            <label className='text-[12px] font-medium text-[#6D7177]'>Replace With</label>
            <div className='w-[5px] h-[5px] rounded-full bg-[#FF4D4D]'></div>
          </div>
          <input
            value={paramv}
            onChange={(e) => setParamv(e.target.value)}
            type='string'
            className='w-full h-[32px] px-3 bg-[#252525] rounded-[6px] border-[1px] border-[#6D7177]/30 
                             text-[#CDCDCD] text-[12px] font-medium appearance-none cursor-pointer 
                             hover:border-[#6D7177]/50 transition-colors'
            autoComplete='off'
          />
        </li>
      )}
    </ul>

  )
}

export default ModifyGetConfigMenu
