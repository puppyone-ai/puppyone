import { Handle, Position, NodeProps, Node, useReactFlow } from '@xyflow/react';
import { useNodesPerFlowContext } from '@/app/components/states/NodesPerFlowContext';
import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from 'react';
import { createPortal } from 'react-dom';
import { markerEnd } from '../../connectionLineStyles/ConfigToTargetEdge';
import InputOutputDisplay from './components/InputOutputDisplay';
import { PuppyDropdown } from '@/app/components/misc/PuppyDropDown';
import { nanoid } from 'nanoid';
import { UI_COLORS } from '@/app/utils/colors';
import useGetSourceTarget from '@/app/components/hooks/useGetSourceTarget';
import useJsonConstructUtils from '@/app/components/hooks/useJsonConstructUtils';
import { useAppSettings } from '@/app/components/states/AppSettingsContext';
import {
  runSingleEdgeNode,
  RunSingleEdgeNodeContext,
} from './hook/runSingleEdgeNodeExecutor';

export type ChooseConfigNodeData = {
  looped?: boolean | undefined;
  content: string | null;
  switch?: string | undefined;
  ON?: string[] | undefined;
  OFF?: string[] | undefined;
};

type ChooseConfigNodeProps = NodeProps<Node<ChooseConfigNodeData>>;

// Define the types for case data structures
export interface Condition {
  id: string;
  label: string;
  condition: string;
  type?: string;
  cond_v: string;
  cond_input?: string;
  operation: string;
}

export interface Action {
  from_id: string;
  from_label: string;
  outputs: string[];
}

export interface CaseItem {
  conditions: Condition[];
  actions: Action[];
}

export interface TransformedCondition {
  block: string;
  condition: string;
  parameters: { [key: string]: string | number };
  operation: string;
}

export interface TransformedCase {
  conditions: TransformedCondition[];
  then: {
    from: string;
    to: string;
  };
}

export interface TransformedCases {
  [key: string]: TransformedCase;
}

export type ChooseEdgeJsonType = {
  type: 'choose' | 'ifelse';
  data: {
    switch?: { [key: string]: string };
    content?: { [key: string]: string };
    inputs: { [key: string]: string };
    outputs: { [key: string]: string };
    ON?: { [key: string]: string };
    OFF?: { [key: string]: string };
    cases?: any;
  };
};

export type ConstructedChooseJsonData = {
  blocks: { [key: string]: any };
  edges: { [key: string]: ChooseEdgeJsonType };
};

const IfElse: React.FC<ChooseConfigNodeProps> = React.memo(
  ({ isConnectable, id, data }) => {
    const {
      isOnConnect,
      activatedEdge,
      isOnGeneratingNewNode,
      clearEdgeActivation,
      activateEdge,
      clearAll,
    } = useNodesPerFlowContext();
    const [isTargetHandleTouched, setIsTargetHandleTouched] = useState(false);
    const { getNode, setNodes, setEdges } = useReactFlow();
    const { getSourceNodeIdWithLabel, getTargetNodeIdWithLabel } =
      useGetSourceTarget();
    const [isMenuOpen, setIsMenuOpen] = useState(true);
    const [isLoading, setIsLoading] = useState(false);
    const menuRef = useRef<HTMLUListElement>(null);
    const portalAnchorRef = useRef<HTMLDivElement | null>(null);
    const menuContainerRef = useRef<HTMLDivElement | null>(null);
    const [isHovered, setIsHovered] = useState(false);
    const [isRunButtonHovered, setIsRunButtonHovered] = useState(false);

    // 获取所有需要的依赖
    const { streamResult, reportError, resetLoadingUI } =
      useJsonConstructUtils();
    const {} = useAppSettings();

    // 使用 useRef 跟踪是否已挂载
    const hasMountedRef = useRef(false);

    // 优化状态初始化 - 使用函数形式避免重复计算
    const [cases, setCases] = useState<CaseItem[]>(() => {
      const nodeData = getNode(id)?.data;
      return (nodeData?.cases as CaseItem[]) || [];
    });

    const [switchValue, setSwitchValue] = useState<string>(() => {
      const nodeData = getNode(id)?.data;
      return (nodeData?.switch as string) || '';
    });

    const [contentValue, setContentValue] = useState<string>(() => {
      const nodeData = getNode(id)?.data;
      return (nodeData?.content as string) || '';
    });

    const [onValue, setOnValue] = useState<string[]>(() => {
      const nodeData = getNode(id)?.data;
      return (nodeData?.ON as string[]) || [];
    });

    const [offValue, setOffValue] = useState<string[]>(() => {
      const nodeData = getNode(id)?.data;
      return (nodeData?.OFF as string[]) || [];
    });

    // Source node labels with type info
    const [sourceNodeLabels, setSourceNodeLabels] = useState<
      { label: string; type: string }[]
    >([]);

    // 创建执行上下文 - 使用 useCallback 缓存
    const createExecutionContext = useCallback(
      (): RunSingleEdgeNodeContext => ({
        getNode,
        setNodes,
        setEdges,
        getSourceNodeIdWithLabel,
        getTargetNodeIdWithLabel,
        clearAll,
        streamResult,
        reportError,
        resetLoadingUI,
        isLocalDeployment: false,
      }),
      [
        getNode,
        setNodes,
        setEdges,
        getSourceNodeIdWithLabel,
        getTargetNodeIdWithLabel,
        clearAll,
        streamResult,
        reportError,
        resetLoadingUI,
      ]
    );

    // 使用执行函数的 handleDataSubmit - 使用 useCallback 缓存
    const handleDataSubmit = useCallback(async () => {
      if (isLoading) return;

      setIsLoading(true);
      try {
        const context = createExecutionContext();
        await runSingleEdgeNode({
          parentId: id,
          targetNodeType: 'ifelse',
          context,
        });
      } catch (error) {
        console.error('执行失败:', error);
      } finally {
        setIsLoading(false);
      }
    }, [id, isLoading, createExecutionContext]);

    // 组件初始化
    useEffect(() => {
      hasMountedRef.current = true;
    }, []);

    // Initialize component
    useEffect(() => {
      if (hasMountedRef.current && !isOnGeneratingNewNode) {
        clearAll();
        activateEdge(id);

        // 检查并初始化内容
        const nodeData = getNode(id)?.data;

        // 同步所有状态到节点数据
        requestAnimationFrame(() => {
          setNodes(prevNodes =>
            prevNodes.map(node => {
              if (node.id === id) {
                return {
                  ...node,
                  data: {
                    ...node.data,
                    cases: cases,
                    switch: switchValue,
                    content: contentValue,
                    ON: onValue,
                    OFF: offValue,
                  },
                };
              }
              return node;
            })
          );
        });
      }

      return () => {
        if (activatedEdge === id) {
          clearEdgeActivation();
        }
      };
    }, [isOnGeneratingNewNode]);

    // 监听所有状态变化 - 使用 requestAnimationFrame 延迟执行，避免在节点创建时干扰
    useEffect(() => {
      if (!isOnGeneratingNewNode && hasMountedRef.current) {
        requestAnimationFrame(() => {
          setNodes(prevNodes =>
            prevNodes.map(node => {
              if (node.id === id) {
                return {
                  ...node,
                  data: {
                    ...node.data,
                    cases: cases,
                    switch: switchValue,
                    content: contentValue,
                    ON: onValue,
                    OFF: offValue,
                  },
                };
              }
              return node;
            })
          );
        });
      }
    }, [
      cases,
      switchValue,
      contentValue,
      onValue,
      offValue,
      isOnGeneratingNewNode,
    ]);

    // Update sourceNodeLabels - 使用 useCallback 缓存
    const updateSourceNodeLabels = useCallback(() => {
      const sourceNodeIdWithLabelGroup = getSourceNodeIdWithLabel(id);
      // Collect labels and types
      const labelsWithTypes = sourceNodeIdWithLabelGroup.map(node => {
        const nodeInfo = getNode(node.id);
        const nodeType = nodeInfo?.type || 'text'; // Default to text if type not found
        return {
          label: node.label,
          type: nodeType,
        };
      });
      setSourceNodeLabels(labelsWithTypes);
    }, [id, getNode, getSourceNodeIdWithLabel]);

    useEffect(() => {
      updateSourceNodeLabels();
    }, [updateSourceNodeLabels]);

    // Initialize cases if not already set - 使用 useCallback 缓存
    const initializeCases = useCallback(() => {
      if (cases.length === 0 && sourceNodeLabels.length > 0) {
        const firstSourceNode = getSourceNodeIdWithLabel(id)[0];
        setCases([
          {
            conditions: [
              {
                id: firstSourceNode?.id || '',
                label: firstSourceNode?.label || '',
                condition: 'contains',
                cond_v: '',
                operation: 'AND',
              },
            ],
            actions: [
              {
                from_id: id,
                from_label: 'output',
                outputs: [],
              },
            ],
          },
        ]);
      }
    }, [cases.length, sourceNodeLabels, getSourceNodeIdWithLabel, id]);

    useEffect(() => {
      initializeCases();
    }, [initializeCases]);

    // UI interaction functions - 使用 useCallback 缓存
    const onClickButton = useCallback(() => {
      setIsMenuOpen(!isMenuOpen);

      if (isOnGeneratingNewNode) return;
      if (activatedEdge === id) {
        clearEdgeActivation();
      } else {
        clearAll();
        activateEdge(id);
      }
    }, [
      isMenuOpen,
      isOnGeneratingNewNode,
      activatedEdge,
      id,
      clearEdgeActivation,
      clearAll,
      activateEdge,
    ]);

    const onFocus = useCallback(() => {
      const curRef = menuRef.current;
      if (curRef && !curRef.classList.contains('nodrag')) {
        curRef.classList.add('nodrag');
      }
    }, []);

    const onBlur = useCallback(() => {
      const curRef = menuRef.current;
      if (curRef) {
        curRef.classList.remove('nodrag');
      }
    }, []);

    // Use a body-level fixed portal to prevent zoom scaling
    useEffect(() => {
      if (!isMenuOpen) return;
      let rafId: number | null = null;
      const GAP = 16; // node bottom to menu gap

      const positionMenu = () => {
        const anchorEl = portalAnchorRef.current as HTMLElement | null;
        const container = menuContainerRef.current as HTMLDivElement | null;
        if (!container || !anchorEl) {
          rafId = requestAnimationFrame(positionMenu);
          return;
        }
        const rect = anchorEl.getBoundingClientRect();
        const menuWidth = 535; // matches w-[535px]
        const left = Math.max(8, Math.min(rect.left, window.innerWidth - menuWidth - 8));
        const top = rect.bottom + GAP;

        container.style.position = 'fixed';
        container.style.left = `${left}px`;
        container.style.top = `${top}px`;
        container.style.zIndex = '2000000';
        container.style.pointerEvents = 'auto';

        rafId = requestAnimationFrame(positionMenu);
      };

      positionMenu();
      const onScroll = () => positionMenu();
      const onResize = () => positionMenu();
      window.addEventListener('scroll', onScroll, true);
      window.addEventListener('resize', onResize);
      return () => {
        if (rafId) cancelAnimationFrame(rafId);
        window.removeEventListener('scroll', onScroll, true);
        window.removeEventListener('resize', onResize);
      };
    }, [isMenuOpen]);

    // Data synchronization functions - 使用 useCallback 缓存
    const onSwitchValueChange = useCallback(
      (newValue: string) => {
        setSwitchValue(newValue);
        setNodes(prevNodes =>
          prevNodes.map(node => {
            if (node.id === id) {
              return { ...node, data: { ...node.data, switch: newValue } };
            }
            return node;
          })
        );
      },
      [id, setNodes]
    );

    const onContentValueChange = useCallback(
      (newValue: string) => {
        setContentValue(newValue);
        setNodes(prevNodes =>
          prevNodes.map(node => {
            if (node.id === id) {
              return { ...node, data: { ...node.data, content: newValue } };
            }
            return node;
          })
        );
      },
      [id, setNodes]
    );

    const onONValueChange = useCallback(
      (newValues: string[]) => {
        setOnValue(newValues);
        setNodes(prevNodes =>
          prevNodes.map(node => {
            if (node.id === id) {
              return { ...node, data: { ...node.data, ON: newValues } };
            }
            return node;
          })
        );
      },
      [id, setNodes]
    );

    const onOFFValueChange = useCallback(
      (newValues: string[]) => {
        setOffValue(newValues);
        setNodes(prevNodes =>
          prevNodes.map(node => {
            if (node.id === id) {
              return { ...node, data: { ...node.data, OFF: newValues } };
            }
            return node;
          })
        );
      },
      [id, setNodes]
    );

    const onCasesChange = useCallback((newCases: CaseItem[]) => {
      setCases(newCases);
      // No need to sync this to ReactFlow node data as it's handled separately
    }, []);

    // Case manipulation functions - 使用 useCallback 缓存
    const onCaseAdd = useCallback(() => {
      setCases(prevCases => {
        const newCases = [
          ...prevCases,
          {
            conditions: [
              {
                id: nanoid(6),
                label: sourceNodeLabels[0]?.label || '',
                condition: 'contains',
                cond_v: '',
                operation: 'AND',
              },
            ],
            actions: [
              {
                from_id: id,
                from_label: 'output',
                outputs: [],
              },
            ],
          },
        ];
        onCasesChange(newCases);
        return newCases;
      });
    }, [sourceNodeLabels, id, onCasesChange]);

    const onCaseDelete = useCallback(
      (caseIndex: number) => {
        setCases(prevCases => {
          const newCases = prevCases.filter((_, index) => index !== caseIndex);
          onCasesChange(newCases);
          return newCases;
        });
      },
      [onCasesChange]
    );

    const onConditionAdd = useCallback(
      (caseIndex: number) => (e: React.MouseEvent) => {
        e.stopPropagation();
        setCases(prevCases => {
          const newCases = [...prevCases];
          const firstSourceNode = getSourceNodeIdWithLabel(id)[0];
          newCases[caseIndex].conditions.push({
            id: firstSourceNode?.id || '',
            label: firstSourceNode?.label || '',
            condition: 'contains',
            cond_v: '',
            operation: 'AND',
          });
          onCasesChange(newCases);
          return newCases;
        });
      },
      [getSourceNodeIdWithLabel, id, onCasesChange]
    );

    const onConditionDelete = useCallback(
      (caseIndex: number, conditionIndex: number) => () => {
        setCases(prevCases => {
          const newCases = [...prevCases];
          if (newCases[caseIndex].conditions.length > 1) {
            newCases[caseIndex].conditions.splice(conditionIndex, 1);
            onCasesChange(newCases);
          }
          return newCases;
        });
      },
      [onCasesChange]
    );

    const onAndOrSwitch = useCallback(
      (caseIndex: number, conditionIndex: number) => () => {
        setCases(prevCases => {
          const newCases = [...prevCases];
          const currentOperation =
            newCases[caseIndex].conditions[conditionIndex].operation;
          newCases[caseIndex].conditions[conditionIndex].operation =
            currentOperation === 'AND' ? 'OR' : 'AND';
          onCasesChange(newCases);
          return newCases;
        });
      },
      [onCasesChange]
    );

    // Update condition values - 使用 useCallback 缓存
    const updateCondition = useCallback(
      (
        caseIndex: number,
        conditionIndex: number,
        field: keyof Condition,
        value: string
      ) => {
        setCases(prevCases => {
          const newCases = [...prevCases];
          newCases[caseIndex].conditions[conditionIndex][field] = value as any;
          onCasesChange(newCases);
          return newCases;
        });
      },
      [onCasesChange]
    );

    // Helper functions for UI - 使用 useCallback 缓存
    const getConditionSelections = useCallback((type: string) => {
      if (type === 'text') {
        return [
          'contains',
          "doesn't contain",
          'is greater than [N] characters',
          'is less than [N] characters',
        ];
      } else if (type === 'structured') {
        return [
          'is empty',
          'is not empty',
          'contains',
          "doesn't contain",
          'is greater than [N] characters',
          'is less than [N] characters',
          'is list',
          'is dict',
        ];
      } else if (type === 'switch') {
        return ['is True', 'is False'];
      }

      return [];
    }, []);

    // Replace the data submission function - 使用 useCallback 缓存
    const onDataSubmit = useCallback(() => {
      // Instead of passing cases data directly to the hook,
      // update the node data which will be read by buildIfElseNodeJson
      setNodes(prevNodes =>
        prevNodes.map(node => {
          if (node.id === id) {
            return {
              ...node,
              data: {
                ...node.data,
                cases: cases,
                switch: switchValue,
                content: contentValue,
                ON: onValue,
                OFF: offValue,
              },
            };
          }
          return node;
        })
      );

      // Call the new handleDataSubmit without parameters
      handleDataSubmit();
    }, [
      handleDataSubmit,
      cases,
      switchValue,
      contentValue,
      onValue,
      offValue,
      setNodes,
      id,
    ]);

    // Handle style for the component - 使用 useMemo 缓存
    const handleStyle = useMemo(
      () => ({
        position: 'absolute' as const,
        width: 'calc(100%)',
        height: 'calc(100%)',
        top: '0',
        left: '0',
        borderRadius: '0',
        transform: 'translate(0px, 0px)',
        background: 'transparent',
        border: '3px solid transparent',
        zIndex: !isOnConnect ? '-1' : '1',
      }),
      [isOnConnect]
    );

    const onActionAdd = useCallback(
      (caseIndex: number) => () => {
        setCases(prevCases => {
          const newCases = [...prevCases];
          newCases[caseIndex].actions.push({
            from_id: id,
            from_label: 'output',
            outputs: [],
          });
          onCasesChange(newCases);
          return newCases;
        });
      },
      [id, onCasesChange]
    );

    // 添加停止函数 - 使用 useCallback 缓存
    const onStopExecution = useCallback(() => {
      console.log('Stop execution');
      setIsLoading(false);
      // 暂时可以留空，或者调用相应的停止API
    }, []);

    // 缓存按钮样式 - 使用 useMemo 缓存
    const runButtonStyle = useMemo(
      () => ({
        backgroundColor: isRunButtonHovered
          ? isLoading
            ? '#FFA73D'
            : '#39BC66'
          : '#181818',
        borderColor: isRunButtonHovered
          ? isLoading
            ? '#FFA73D'
            : '#39BC66'
          : UI_COLORS.EDGENODE_BORDER_GREY,
        color: isRunButtonHovered ? '#000' : UI_COLORS.EDGENODE_BORDER_GREY,
      }),
      [isRunButtonHovered, isLoading]
    );

    const mainButtonStyle = useMemo(
      () => ({
        borderColor: isLoading
          ? '#FFA73D'
          : isHovered
            ? UI_COLORS.LINE_ACTIVE
            : UI_COLORS.EDGENODE_BORDER_GREY,
        color: isLoading
          ? '#FFA73D'
          : isHovered
            ? UI_COLORS.LINE_ACTIVE
            : UI_COLORS.EDGENODE_BORDER_GREY,
      }),
      [isLoading, isHovered]
    );

    return (
      <div className='p-[3px] w-[80px] h-[48px] relative'>
        {/* Invisible hover area between node and run button */}
        <div
          className='absolute -top-[40px] left-0 w-full h-[40px]'
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
        />

        {/* Run button positioned above the node - show when node or run button is hovered */}
        <button
          className={`absolute -top-[40px] left-1/2 transform -translate-x-1/2 w-[57px] h-[24px] rounded-[6px] border-[1px] text-[10px] font-[600] font-plus-jakarta-sans flex flex-row items-center justify-center gap-[4px] transition-all duration-200 ${
            isHovered || isRunButtonHovered ? 'opacity-100' : 'opacity-0'
          }`}
          style={runButtonStyle}
          onClick={isLoading ? onStopExecution : onDataSubmit}
          disabled={false}
          onMouseEnter={() => setIsRunButtonHovered(true)}
          onMouseLeave={() => setIsRunButtonHovered(false)}
        >
          <span>
            {isLoading ? (
              <svg width='6' height='6' viewBox='0 0 6 6' fill='none'>
                <rect width='6' height='6' fill='currentColor' />
              </svg>
            ) : (
              <svg
                xmlns='http://www.w3.org/2000/svg'
                width='6'
                height='8'
                viewBox='0 0 8 10'
                fill='none'
              >
                <path d='M8 5L0 10V0L8 5Z' fill='currentColor' />
              </svg>
            )}
          </span>
          <span>{isLoading ? 'Stop' : 'Run'}</span>
        </button>

        <button
          onClick={onClickButton}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          className={`w-full h-full flex-shrink-0 rounded-[8px] border-[2px] bg-[#181818] flex items-center justify-center font-plus-jakarta-sans text-[10px] font-[700] edge-node transition-colors gap-[4px]`}
          style={mainButtonStyle}
        >
          {/* IF/ELSE SVG icon */}
          <svg
            xmlns='http://www.w3.org/2000/svg'
            width='10'
            height='10'
            viewBox='0 0 12 12'
            fill='none'
          >
            <path d='M6 12V7' stroke='currentColor' strokeWidth='2' />
            <path d='M10 2V7L2 7V2' stroke='currentColor' strokeWidth='1.5' />
            <path
              d='M0.934259 2.5L2 0.901388L3.06574 2.5H0.934259Z'
              fill='currentColor'
              stroke='currentColor'
            />
            <path
              d='M8.93426 2.5L10 0.901388L11.0657 2.5H8.93426Z'
              fill='currentColor'
              stroke='currentColor'
            />
          </svg>
          <div className='flex flex-col items-center justify-center leading-tight text-[9px]'>
            <span>IF/ELSE</span>
          </div>

          <Handle
            id={`${id}-a`}
            className='edgeSrcHandle handle-with-icon handle-top'
            type='source'
            position={Position.Top}
          />
          <Handle
            id={`${id}-b`}
            className='edgeSrcHandle handle-with-icon handle-right'
            type='source'
            position={Position.Right}
          />
          <Handle
            id={`${id}-c`}
            className='edgeSrcHandle handle-with-icon handle-bottom'
            type='source'
            position={Position.Bottom}
          />
          <Handle
            id={`${id}-d`}
            className='edgeSrcHandle handle-with-icon handle-left'
            type='source'
            position={Position.Left}
          />

          <Handle
            id={`${id}-a`}
            type='target'
            position={Position.Top}
            style={handleStyle}
            isConnectable={isConnectable}
            onMouseEnter={() => setIsTargetHandleTouched(true)}
            onMouseLeave={() => setIsTargetHandleTouched(false)}
          />
          <Handle
            id={`${id}-b`}
            type='target'
            position={Position.Right}
            style={handleStyle}
            isConnectable={isConnectable}
            onMouseEnter={() => setIsTargetHandleTouched(true)}
            onMouseLeave={() => setIsTargetHandleTouched(false)}
          />
          <Handle
            id={`${id}-c`}
            type='target'
            position={Position.Bottom}
            style={handleStyle}
            isConnectable={isConnectable}
            onMouseEnter={() => setIsTargetHandleTouched(true)}
            onMouseLeave={() => setIsTargetHandleTouched(false)}
          />
          <Handle
            id={`${id}-d`}
            type='target'
            position={Position.Left}
            style={handleStyle}
            isConnectable={isConnectable}
            onMouseEnter={() => setIsTargetHandleTouched(true)}
            onMouseLeave={() => setIsTargetHandleTouched(false)}
          />
        </button>

        {/* Invisible fixed-position anchor to tether the portal menu to this node */}
        <div ref={portalAnchorRef} className='absolute left-0 top-full h-0 w-0' />

        {/* Configuration Menu - render in a body-level fixed portal to avoid zoom scaling */}
        {isMenuOpen &&
          createPortal(
            <div
              ref={menuContainerRef}
              style={{ position: 'fixed', zIndex: 2000000 }}
              onMouseDown={e => e.stopPropagation()}
              onClick={e => e.stopPropagation()}
            >
              <ul
                ref={menuRef}
                className='w-[535px] text-white rounded-[16px] border-[1px] bg-[#1A1A1A] p-[12px] font-plus-jakarta-sans flex flex-col gap-[16px] shadow-lg'
                style={{ borderColor: UI_COLORS.EDGENODE_BORDER_GREY }}
                onWheelCapture={e => e.stopPropagation()}
                onWheel={e => e.stopPropagation()}
                onTouchMoveCapture={e => e.stopPropagation()}
                onTouchMove={e => e.stopPropagation()}
              >
            <li className='flex h-[28px] gap-1 items-center justify-between font-plus-jakarta-sans'>
              <div className='flex flex-row gap-[12px]'>
                <div className='flex flex-row gap-[8px] justify-center items-center'>
                  <div className='w-[24px] h-[24px] border-[1px] border-main-grey bg-main-black-theme rounded-[8px] flex items-center justify-center'>
                    <svg
                      xmlns='http://www.w3.org/2000/svg'
                      width='12'
                      height='12'
                      viewBox='0 0 12 12'
                      fill='none'
                    >
                      <path d='M6 12V7' stroke='#D9D9D9' strokeWidth='2' />
                      <path
                        d='M10 2V7L2 7V2'
                        stroke='#D9D9D9'
                        strokeWidth='1.5'
                      />
                      <path
                        d='M0.934259 2.5L2 0.901388L3.06574 2.5H0.934259Z'
                        fill='#D9D9D9'
                        stroke='#D9D9D9'
                      />
                      <path
                        d='M8.93426 2.5L10 0.901388L11.0657 2.5H8.93426Z'
                        fill='#D9D9D9'
                        stroke='#D9D9D9'
                      />
                    </svg>
                  </div>
                  <div className='flex items-center justify-center text-[14px] font-semibold text-main-grey font-plus-jakarta-sans leading-normal'>
                    If/Else
                  </div>
                </div>
              </div>
              <div className='flex flex-row gap-[8px] items-center justify-center'>
                <button
                  className='w-[57px] h-[26px] rounded-[8px] text-[#000] text-[12px] font-semibold font-plus-jakarta-sans flex flex-row items-center justify-center gap-[7px]'
                  style={{
                    backgroundColor: isLoading ? '#FFA73D' : '#39BC66',
                  }}
                  onClick={isLoading ? onStopExecution : onDataSubmit}
                  disabled={false}
                >
                  <span>
                    {isLoading ? (
                      <svg width='8' height='8' viewBox='0 0 8 8' fill='none'>
                        <rect width='8' height='8' fill='currentColor' />
                      </svg>
                    ) : (
                      <svg
                        xmlns='http://www.w3.org/2000/svg'
                        width='8'
                        height='10'
                        viewBox='0 0 8 10'
                        fill='none'
                      >
                        <path d='M8 5L0 10V0L8 5Z' fill='black' />
                      </svg>
                    )}
                  </span>
                  <span>{isLoading ? 'Stop' : 'Run'}</span>
                </button>
              </div>
            </li>

            {/* Input/Output display */}
            <li>
              <InputOutputDisplay
                parentId={id}
                getNode={getNode}
                getSourceNodeIdWithLabel={getSourceNodeIdWithLabel}
                getTargetNodeIdWithLabel={getTargetNodeIdWithLabel}
                supportedInputTypes={['text', 'structured']}
                supportedOutputTypes={['text', 'structured']}
              />
            </li>

            {cases.map((case_value, case_index) => (
              <li key={case_index} className='flex flex-col gap-2'>
                {/* Case Header - 使用类似 LLM 配置菜单的样式 */}
                <div className='flex items-center gap-2'>
                  <label className='text-[13px] font-semibold text-[#6D7177]'>
                    Case {case_index + 1}
                  </label>
                  <div className='w-[5px] h-[5px] rounded-full bg-[#FF4D4D]'></div>
                  {/* Delete Case Button */}
                  {cases.length > 1 && (
                    <button
                      onClick={() => {
                        onCaseDelete(case_index);
                      }}
                      className='ml-auto p-0.5 w-6 h-6 flex items-center justify-center text-[#6D7177] hover:text-[#ff4d4d] transition-colors'
                    >
                      <svg
                        width='14'
                        height='14'
                        viewBox='0 0 24 24'
                        fill='none'
                        stroke='currentColor'
                      >
                        <path
                          d='M18 6L6 18M6 6l12 12'
                          strokeWidth='2'
                          strokeLinecap='round'
                        />
                      </svg>
                    </button>
                  )}
                </div>

                {/* Case Content Container */}
                <div className='flex flex-col gap-2 p-2 bg-[#1E1E1E] rounded-[8px] border-[1px] border-[#6D7177]/30'>
                  {/* 保持现有的 IF/THEN 内容不变，稍后我们会继续优化这部分 */}
                  <div className='flex flex-col w-full gap-[8px] p-3'>
                    <label className='text-[11px] font-regular text-[#6D7177] ml-1'>
                      Condition
                    </label>
                    {case_value.conditions.map(
                      (condition_value, conditions_index) => (
                        <React.Fragment key={conditions_index}>
                          <div className='inline-flex space-x-[12px] items-center justify-start w-full'>
                            <ul
                              key={conditions_index}
                              className='flex-col border-[#6D7177] rounded-[4px] w-full bg-black'
                            >
                              <li className='flex gap-1 h-[32px] items-center justify-start rounded-md border-[1px] border-[#6D7177]/30 bg-[#252525] min-w-[280px]'>
                                {/* 第一个元素：节点选择 */}
                                <div className='flex flex-row flex-wrap gap-[10px] items-center justify-start px-[10px]'>
                                  <PuppyDropdown
                                    options={getSourceNodeIdWithLabel(id)}
                                    onSelect={(node: {
                                      id: string;
                                      label: string;
                                    }) => {
                                      const cases_clone = [...cases];
                                      cases_clone[case_index].conditions[
                                        conditions_index
                                      ] = {
                                        ...cases_clone[case_index].conditions[
                                          conditions_index
                                        ],
                                        id: node.id,
                                        label: node.label,
                                        type: getNode(node.id)?.type,
                                      };
                                      onCasesChange(cases_clone);
                                    }}
                                    selectedValue={condition_value.id}
                                    optionBadge={false}
                                    listWidth='200px'
                                    buttonHeight='24px'
                                    buttonBgColor='transparent'
                                    containerClassnames='w-fit'
                                    mapValueTodisplay={(
                                      value:
                                        | string
                                        | { id: string; label: string }
                                    ) => {
                                      if (typeof value === 'string') {
                                        const nodeType = getNode(value)?.type;
                                        const label =
                                          getNode(value)?.data?.label || value;
                                        const displayText = `{{${label}}}`;

                                        if (nodeType === 'text') {
                                          return (
                                            <span className='text-[#3B9BFF]'>
                                              {displayText}
                                            </span>
                                          );
                                        } else if (nodeType === 'structured') {
                                          return (
                                            <span className='text-[#9B7EDB]'>
                                              {displayText}
                                            </span>
                                          );
                                        }
                                        return displayText;
                                      }

                                      const nodeType = getNode(value.id)?.type;
                                      const displayText = `{{${value.label || value.id}}}`;

                                      if (nodeType === 'text') {
                                        return (
                                          <span className='text-[#3B9BFF]'>
                                            {displayText}
                                          </span>
                                        );
                                      } else if (nodeType === 'structured') {
                                        return (
                                          <span className='text-[#9B7EDB]'>
                                            {displayText}
                                          </span>
                                        );
                                      }
                                      return displayText;
                                    }}
                                    showDropdownIcon={false}
                                  />
                                </div>

                                {/* 第二个元素：条件选择 */}
                                <div className='h-[30px] border-r-[1px] border-l-[1px] px-[8px] border-[#6D7177]/30 flex items-center justify-start'>
                                  <PuppyDropdown
                                    options={getConditionSelections(
                                      condition_value.type || 'text'
                                    )}
                                    onSelect={(option: string) => {
                                      updateCondition(
                                        case_index,
                                        conditions_index,
                                        'condition',
                                        option
                                      );
                                    }}
                                    selectedValue={condition_value.condition}
                                    optionBadge={false}
                                    listWidth='200px'
                                    buttonHeight='24px'
                                    buttonBgColor='transparent'
                                    containerClassnames='w-fit'
                                    showDropdownIcon={false}
                                  />
                                </div>

                                {/* 第三个元素：条件值输入 */}
                                {(condition_value.condition === 'contains' ||
                                  condition_value.condition ===
                                    "doesn't contain" ||
                                  condition_value.condition ===
                                    'is greater than [N] characters' ||
                                  condition_value.condition ===
                                    'is less than [N] characters') && (
                                  <div className='flex-1 px-[8px]'>
                                    <input
                                      type='text'
                                      value={condition_value.cond_v}
                                      onChange={e => {
                                        updateCondition(
                                          case_index,
                                          conditions_index,
                                          'cond_v',
                                          e.target.value
                                        );
                                      }}
                                      className='w-full h-[24px] bg-transparent border-none outline-none text-[#CDCDCD] text-[12px] placeholder-[#6D7177]'
                                      placeholder='Enter value...'
                                      onFocus={onFocus}
                                      onBlur={onBlur}
                                    />
                                  </div>
                                )}

                                {/* 删除条件按钮 */}
                                {case_value.conditions.length > 1 && (
                                  <button
                                    onClick={onConditionDelete(
                                      case_index,
                                      conditions_index
                                    )}
                                    className='p-1 text-[#6D7177] hover:text-[#ff4d4d] transition-colors'
                                  >
                                    <svg
                                      width='12'
                                      height='12'
                                      viewBox='0 0 24 24'
                                      fill='none'
                                      stroke='currentColor'
                                    >
                                      <path
                                        d='M18 6L6 18M6 6l12 12'
                                        strokeWidth='2'
                                        strokeLinecap='round'
                                      />
                                    </svg>
                                  </button>
                                )}
                              </li>
                            </ul>

                            {/* AND/OR 切换按钮 */}
                            {conditions_index <
                              case_value.conditions.length - 1 && (
                              <button
                                onClick={onAndOrSwitch(
                                  case_index,
                                  conditions_index
                                )}
                                className='px-2 py-1 text-[10px] font-medium rounded border border-[#6D7177]/30 bg-[#252525] text-[#CDCDCD] hover:border-[#6D7177]/50 transition-colors'
                              >
                                {condition_value.operation}
                              </button>
                            )}
                          </div>
                        </React.Fragment>
                      )
                    )}

                    {/* 添加条件按钮 */}
                    <button
                      onClick={onConditionAdd(case_index)}
                      className='flex items-center gap-2 px-3 py-2 text-[12px] text-[#6D7177] hover:text-[#CDCDCD] border border-[#6D7177]/30 hover:border-[#6D7177]/50 rounded-md bg-[#252525] hover:bg-[#2A2A2A] transition-colors'
                    >
                      <svg
                        width='12'
                        height='12'
                        viewBox='0 0 24 24'
                        fill='none'
                        stroke='currentColor'
                      >
                        <path
                          d='M12 5v14M5 12h14'
                          strokeWidth='2'
                          strokeLinecap='round'
                        />
                      </svg>
                      Add Condition
                    </button>
                  </div>

                  {/* THEN 部分 */}
                  <div className='flex flex-col w-full gap-[8px] p-3 border-t border-[#6D7177]/30'>
                    <label className='text-[11px] font-regular text-[#6D7177] ml-1'>
                      Then
                    </label>
                    {case_value.actions.map((action, action_index) => (
                      <div
                        key={action_index}
                        className='flex gap-2 h-[32px] items-center justify-start rounded-md border-[1px] border-[#6D7177]/30 bg-[#252525] px-3'
                      >
                        <span className='text-[12px] text-[#CDCDCD]'>
                          Output to connected nodes
                        </span>
                      </div>
                    ))}

                    {/* 添加 Action 按钮 */}
                    <button
                      onClick={onActionAdd(case_index)}
                      className='flex items-center gap-2 px-3 py-2 text-[12px] text-[#6D7177] hover:text-[#CDCDCD] border border-[#6D7177]/30 hover:border-[#6D7177]/50 rounded-md bg-[#252525] hover:bg-[#2A2A2A] transition-colors'
                    >
                      <svg
                        width='12'
                        height='12'
                        viewBox='0 0 24 24'
                        fill='none'
                        stroke='currentColor'
                      >
                        <path
                          d='M12 5v14M5 12h14'
                          strokeWidth='2'
                          strokeLinecap='round'
                        />
                      </svg>
                      Add Action
                    </button>
                  </div>
                </div>
              </li>
            ))}

            {/* 添加新 Case 按钮 */}
            <li>
              <button
                onClick={onCaseAdd}
                className='w-full flex items-center justify-center gap-2 px-4 py-3 text-[13px] font-medium text-[#6D7177] hover:text-[#CDCDCD] border border-[#6D7177]/30 hover:border-[#6D7177]/50 rounded-md bg-[#1E1E1E] hover:bg-[#252525] transition-colors'
              >
                <svg
                  width='14'
                  height='14'
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                >
                  <path
                    d='M12 5v14M5 12h14'
                    strokeWidth='2'
                    strokeLinecap='round'
                  />
                </svg>
                Add New Case
              </button>
            </li>
              </ul>
            </div>,
            document.body
          )}
      </div>
    );
  }
);

IfElse.displayName = 'IfElse';
export default IfElse;
