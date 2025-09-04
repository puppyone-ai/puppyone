'use client';

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Handle, NodeProps, Node, Position, useReactFlow } from '@xyflow/react';
import { useNodesPerFlowContext } from '../../../../states/NodesPerFlowContext';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faGoogle } from '@fortawesome/free-brands-svg-icons';
import { UI_COLORS } from '@/app/utils/colors';

export type EdgeMenuTempNodeData = {
  sourceNodeId: string;
  sourceNodeType?: string;
  tempEdgeId?: string;
};

type EdgeMenuTempNodeProps = NodeProps<Node<EdgeMenuTempNodeData>>;

type MainMenuItem = {
  key: string;
  label: string;
  hasSubmenu?: boolean;
  onPickEdgeType?: string; // node type to transform into when direct action
  buildSubmenu?: () => Array<{
    key: string;
    label: string;
    onPickEdgeType?: string;
    disabled?: boolean;
    subKey?: string;
  }>; // submenu entries
};
type SubItem = {
  key: string;
  label: string;
  onPickEdgeType?: string;
  disabled?: boolean;
};
type ActionItem = {
  key: string;
  label: string;
  onPickEdgeType?: string;
  submenuKey?: 'chunk' | 'retrieve' | 'modify' | 'search';
};
type MenuSection = { key: string; label: string; items: ActionItem[] };

const EdgeMenuNode: React.FC<EdgeMenuTempNodeProps> = ({
  id,
  data,
  isConnectable,
}) => {
  const { getNode, setNodes, setEdges } = useReactFlow();
  const { isOnConnect } = useNodesPerFlowContext();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  // search removed to save space
  const mainListRef = useRef<HTMLUListElement | null>(null);
  const subListRef = useRef<HTMLUListElement | null>(null);
  const listItemRefs = useRef<(HTMLLIElement | null)[]>([]);
  const [activeMainIndex, setActiveMainIndex] = useState(0);
  const [openSubmenuIndex, setOpenSubmenuIndex] = useState<number | null>(null);
  const [activeSubIndex, setActiveSubIndex] = useState<number>(0);
  const [isHovered, setIsHovered] = useState(false);
  const [, setIsTargetHandleTouched] = useState(false);
  // search removed to save space
  const openTimerRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const [submenuTop, setSubmenuTop] = useState<number>(0);
  const [sideHandleTop, setSideHandleTop] = useState<number>(16);
  const [mainHasTopShadow, setMainHasTopShadow] = useState(false);
  const [mainHasBottomShadow, setMainHasBottomShadow] = useState(false);
  const [subHasTopShadow, setSubHasTopShadow] = useState(false);
  const [subHasBottomShadow, setSubHasBottomShadow] = useState(false);

  const sourceType = useMemo(() => {
    return data?.sourceNodeType || getNode(data?.sourceNodeId)?.type || 'text';
  }, [data?.sourceNodeId, data?.sourceNodeType, getNode]);

  const removeSelf = useCallback(() => {
    const nodeId = id;
    setEdges(prev =>
      prev.filter(e => e.source !== nodeId && e.target !== nodeId)
    );
    setNodes(prev => prev.filter(n => n.id !== nodeId));
  }, [id, setEdges, setNodes]);

  useEffect(() => {
    const onDocMouseDown = (e: MouseEvent) => {
      const el = containerRef.current;
      if (!el) return;
      if (!el.contains(e.target as HTMLElement)) {
        removeSelf();
      }
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [removeSelf]);

  const handlePick = useCallback(
    (edgeType: string, subMenuType?: string | null) => {
      // transform current node into selected edge node type
      setNodes(prev =>
        prev.map(n =>
          n.id === id
            ? {
                ...n,
                type: edgeType,
                data: { ...n.data, subMenuType: subMenuType ?? null },
              }
            : n
        )
      );
    },
    [id, setNodes]
  );

  const buildSections = useCallback((): MenuSection[] => {
    if (sourceType === 'file') {
      return [
        {
          key: 'load-section',
          label: 'Load',
          items: [{ key: 'load', label: 'Load', onPickEdgeType: 'load' }],
        },
      ];
    }
    if (sourceType === 'weblink') {
      return [
        { key: 'weblink', label: 'Web Link (not available yet)', items: [] },
      ];
    }

    const sections: MenuSection[] = [
      {
        key: 'process',
        label: 'Processing',
        items: [
          { key: 'llm', label: 'LLM', onPickEdgeType: 'llmnew' },
          { key: 'modify', label: 'Modify ▸', submenuKey: 'modify' },
        ],
      },
      {
        key: 'rag',
        label: 'RAG',
        items: [
          { key: 'chunk', label: 'Chunk ▸', submenuKey: 'chunk' },
          { key: 'retrieve', label: 'Retrieve', onPickEdgeType: 'retrieving' },
          { key: 'generate', label: 'Generate', onPickEdgeType: 'generate' },
        ],
      },
      // Moved Generate into RAG, removed separate Generation section
      {
        key: 'deepresearch',
        label: 'Deep Research',
        items: [
          {
            key: 'deepresearch',
            label: 'Deep Research',
            onPickEdgeType: 'deepresearch',
          },
        ],
      },
      {
        key: 'search',
        label: 'Searching',
        items: [{ key: 'search', label: 'Search ▸', submenuKey: 'search' }],
      },
      {
        key: 'other',
        label: 'Others',
        items: [
          { key: 'ifelse', label: 'If / Else', onPickEdgeType: 'ifelse' },
        ],
      },
    ];

    return sections;
  }, [sourceType]);

  const chunkSubmenu = useMemo(
    (): SubItem[] => [
      { key: 'auto', label: 'Auto', onPickEdgeType: 'chunkingAuto' },
      {
        key: 'by-length',
        label: 'By length',
        onPickEdgeType: 'chunkingByLength',
      },
      {
        key: 'by-character',
        label: 'By character',
        onPickEdgeType: 'chunkingByCharacter',
      },
    ],
    []
  );

  const retrieveSubmenu = useMemo(
    (): SubItem[] => [
      { key: 'by-vector', label: 'By Vector', onPickEdgeType: 'retrieving' },
    ],
    []
  );

  const modifySubmenu = useMemo(
    (): SubItem[] =>
      sourceType === 'text'
        ? [
            { key: 'copy', label: 'Copy', onPickEdgeType: 'copy' },
            {
              key: 'convert-structured',
              label: 'Convert → structured',
              onPickEdgeType: 'convert2structured',
            },
            {
              key: 'edit-text',
              label: 'Edit (text)',
              onPickEdgeType: 'editText',
            },
          ]
        : [
            { key: 'copy', label: 'Copy', onPickEdgeType: 'copy' },
            {
              key: 'convert-text',
              label: 'Convert to Text',
              onPickEdgeType: 'convert2text',
            },
            {
              key: 'edit-structured',
              label: 'Edit (structure)',
              onPickEdgeType: 'editStructured',
            },
          ],
    [sourceType]
  );

  const searchSubmenu = useMemo(
    (): SubItem[] => [
      {
        key: 'perplexity',
        label: 'Perplexity',
        onPickEdgeType: 'searchPerplexity',
      },
      { key: 'google', label: 'Google', onPickEdgeType: 'searchGoogle' },
    ],
    []
  );

  const sections = useMemo(() => buildSections(), [buildSections]);
  const flatItems = useMemo(() => sections.flatMap(s => s.items), [sections]);

  // Match Copy.tsx full-overlay target handle style so the anchor is vertically centered
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

  const clearTimers = () => {
    if (openTimerRef.current) {
      window.clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  const updateScrollShadows = useCallback(
    (
      el: HTMLUListElement | null,
      setTop: React.Dispatch<React.SetStateAction<boolean>>,
      setBottom: React.Dispatch<React.SetStateAction<boolean>>
    ) => {
      if (!el) return;
      const { scrollTop, scrollHeight, clientHeight } = el;
      setTop(scrollTop > 1);
      setBottom(scrollTop + clientHeight < scrollHeight - 1);
    },
    []
  );

  const handleMainScroll = useCallback(() => {
    updateScrollShadows(
      mainListRef.current,
      setMainHasTopShadow,
      setMainHasBottomShadow
    );
  }, [updateScrollShadows]);

  const handleSubScroll = useCallback(() => {
    updateScrollShadows(
      subListRef.current,
      setSubHasTopShadow,
      setSubHasBottomShadow
    );
  }, [updateScrollShadows]);

  const updateSubmenuTop = useCallback((index: number) => {
    const menuEl = menuRef.current;
    const itemEl = listItemRefs.current[index];
    if (!menuEl || !itemEl) return;
    const menuRect = menuEl.getBoundingClientRect();
    const itemRect = itemEl.getBoundingClientRect();
    const top = itemRect.top - menuRect.top;
    setSubmenuTop(top);
  }, []);

  useEffect(() => {
    setOpenSubmenuIndex(null);
    window.setTimeout(() => {
      updateScrollShadows(
        mainListRef.current,
        setMainHasTopShadow,
        setMainHasBottomShadow
      );
    }, 0);
  }, []);

  // Fixed side handle offsets for compact node size

  const openSubmenuWithDelay = (index: number) => {
    clearTimers();
    openTimerRef.current = window.setTimeout(() => {
      setOpenSubmenuIndex(index);
      setActiveSubIndex(0);
      updateSubmenuTop(index);
      // ensure submenu scroll shadows are updated after it renders
      window.setTimeout(() => {
        updateScrollShadows(
          subListRef.current,
          setSubHasTopShadow,
          setSubHasBottomShadow
        );
      }, 0);
    }, 120);
  };

  const closeSubmenuWithDelay = () => {
    clearTimers();
    closeTimerRef.current = window.setTimeout(() => {
      setOpenSubmenuIndex(null);
    }, 250);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const hasOpenSubmenu = openSubmenuIndex !== null;
    if (e.key === 'Escape') {
      if (hasOpenSubmenu) {
        setOpenSubmenuIndex(null);
      } else {
        removeSelf();
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!hasOpenSubmenu) {
        setActiveMainIndex(i => (i + 1) % flatItems.length);
      } else {
        const subItems = getSubmenuItems(openSubmenuIndex);
        if (subItems.length > 0)
          setActiveSubIndex(i => (i + 1) % subItems.length);
      }
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!hasOpenSubmenu) {
        setActiveMainIndex(i => (i - 1 + flatItems.length) % flatItems.length);
      } else {
        const subItems = getSubmenuItems(openSubmenuIndex);
        if (subItems.length > 0)
          setActiveSubIndex(i => (i - 1 + subItems.length) % subItems.length);
      }
      return;
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      const item = flatItems[activeMainIndex];
      if (item.submenuKey) {
        setOpenSubmenuIndex(activeMainIndex);
        setActiveSubIndex(0);
        updateSubmenuTop(activeMainIndex);
      }
      return;
    }
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (hasOpenSubmenu) {
        setOpenSubmenuIndex(null);
      }
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const item = flatItems[activeMainIndex];
      if (openSubmenuIndex === activeMainIndex) {
        // pick sub
        const subItems = getSubmenuItems(activeMainIndex);
        const sub = subItems[activeSubIndex];
        if (sub) {
          if (!sub.disabled && sub.onPickEdgeType) {
            handlePick(sub.onPickEdgeType, sub.key);
          }
        }
      } else if (item.onPickEdgeType) {
        handlePick(item.onPickEdgeType, item.key);
      } else if (item.submenuKey) {
        setOpenSubmenuIndex(activeMainIndex);
        setActiveSubIndex(0);
        updateSubmenuTop(activeMainIndex);
      }
    }
  };

  const getSubmenuItems = (index: number | null): SubItem[] => {
    if (index === null) return [] as SubItem[];
    const item = flatItems[index];
    if (!item) return [];
    if (item.submenuKey === 'chunk') return chunkSubmenu;
    if (item.submenuKey === 'retrieve') return retrieveSubmenu;
    if (item.submenuKey === 'modify') return modifySubmenu;
    if (item.submenuKey === 'search') return searchSubmenu;
    return [];
  };

  const menuDims = useMemo(() => {
    const width = 320;
    const height =
      sourceType === 'file' || sourceType === 'weblink' ? 240 : 480;
    return { width, height };
  }, [sourceType]);

  return (
    <div ref={containerRef} className='p-[3px] w-[80px] h-[48px] relative'>
      {/* Main node button - empty, non-toggling */}
      <button
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        className={`w-full h-full flex-shrink-0 rounded-[8px] border-[2px] bg-[#181818] flex items-center justify-center font-plus-jakarta-sans text-[10px] font-[600] edge-node transition-colors gap-[4px]`}
        style={{
          borderColor: UI_COLORS.MAIN_DEEP_GREY,
          color: UI_COLORS.MAIN_DEEP_GREY,
        }}
        title='Edge Node'
      >
        {/* Source handles */}
        <Handle
          id={`${id}-a`}
          className='edgeSrcHandle handle-with-icon handle-top'
          type='source'
          position={Position.Top}
          isConnectable={false}
        />
        <Handle
          id={`${id}-b`}
          className='edgeSrcHandle handle-with-icon handle-right'
          type='source'
          position={Position.Right}
          isConnectable={false}
        />
        <Handle
          id={`${id}-c`}
          className='edgeSrcHandle handle-with-icon handle-bottom'
          type='source'
          position={Position.Bottom}
          isConnectable={false}
        />
        <Handle
          id={`${id}-d`}
          className='edgeSrcHandle handle-with-icon handle-left'
          type='source'
          position={Position.Left}
          isConnectable={false}
        />
        {/* Target handles */}
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

      {/* Inline menu implementation per design.md (overlay, not affecting layout) */}
      <div
        ref={menuRef}
        className='absolute left-0 top-[56px] bg-[#181818] text-[#CDCDCD] border-2 border-[#3E3E41] rounded-[10px] p-[8px] pl-[12px] pr-0 shadow-lg text-sm overflow-visible outline-none menu-container'
        style={{ width: menuDims.width }}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onWheelCapture={e => {
          e.stopPropagation();
        }}
        onWheel={e => {
          e.stopPropagation();
        }}
        onTouchMoveCapture={e => {
          e.stopPropagation();
        }}
        onTouchMove={e => {
          e.stopPropagation();
        }}
      >
        <div>
          {/* Main menu with section titles */}
          <ul
            ref={mainListRef}
            className={`max-h-[360px] overflow-y-scroll overflow-x-hidden menu-scroll flex flex-col gap-[8px] py-0 px-[4px] items-start ${
              mainHasTopShadow ? 'scroll-shadow-top' : ''
            } ${mainHasBottomShadow ? 'scroll-shadow-bottom' : ''}`}
            onScroll={handleMainScroll}
          >
            {sections.map(section => (
              <React.Fragment key={`section-${section.key}`}>
                <li className='text-left w-full h-[18px] text-[#9AA0A6] text-[10px] tracking-wide font-semibold flex items-center px-[4px] uppercase'>
                  {section.label}
                </li>
                {section.items.map(item => {
                  const index = flatItems.findIndex(fi => fi.key === item.key);
                  const isActive =
                    index === activeMainIndex && openSubmenuIndex === null;
                  const isDisabled =
                    !item.onPickEdgeType &&
                    !item.submenuKey &&
                    item.key.includes('placeholder');
                  return (
                    <li
                      key={item.key}
                      ref={el => {
                        listItemRefs.current[index] = el;
                      }}
                      className={`w-full min-h-[54px] ${isDisabled ? 'cursor-default' : 'cursor-pointer'} rounded-[8px] flex items-center justify-between gap-[11px] py-[10px] pl-[12px] pr-[12px] bg-[#252525] hover:bg-[#3E3E41]`}
                      onMouseEnter={() => {
                        if (item.submenuKey) {
                          openSubmenuWithDelay(index);
                          updateSubmenuTop(index);
                        } else {
                          setOpenSubmenuIndex(null);
                        }
                        setActiveMainIndex(index);
                      }}
                      onMouseLeave={() => {
                        if (item.submenuKey) {
                          closeSubmenuWithDelay();
                        }
                      }}
                      onClick={() => {
                        if (isDisabled) return;
                        if (item.onPickEdgeType) {
                          handlePick(item.onPickEdgeType, item.key);
                        } else if (item.submenuKey) {
                          setOpenSubmenuIndex(index);
                          setActiveSubIndex(0);
                        }
                      }}
                    >
                      <div className='flex items-center gap-[11px] flex-1'>
                        {/* Leading icon slot to inherit from legacy menus */}
                        <div className='w-[30px] h-[30px] bg-[#1C1D1F] flex items-center justify-center rounded-[5px]'>
                          {item.key === 'llm' && (
                            <img
                              src="data:image/svg+xml;utf8,%3Csvg width='14' height='14' viewBox='0 0 14 14' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cg clip-path='url(%23clip0)'%3E%3Cpath d='M12.9965 5.73C13.3141 4.77669 13.2047 3.73238 12.6968 2.86525C11.9329 1.53525 10.3973 0.851002 8.89752 1.173C8.23033 0.421377 7.27177 -0.00606008 6.26683 6.49355e-05C4.73383 -0.00343506 3.37365 0.983564 2.90202 2.44219C1.91721 2.64388 1.06715 3.26031 0.569708 4.134C-0.199855 5.4605 -0.024417 7.13263 1.00371 8.27013C0.686083 9.22344 0.795458 10.2678 1.3034 11.1349C2.06727 12.4649 3.6029 13.1491 5.10265 12.8271C5.7694 13.5788 6.7284 14.0062 7.73333 13.9996C9.26721 14.0036 10.6278 13.0157 11.0995 11.5558C12.0843 11.3541 12.9343 10.7376 13.4318 9.86394C14.2005 8.53744 14.0246 6.86663 12.9969 5.72913L12.9965 5.73ZM7.73421 13.0848C7.1204 13.0857 6.52583 12.8709 6.05465 12.4776C6.07608 12.4662 6.11327 12.4456 6.13733 12.4308L8.92508 10.8208C9.06771 10.7398 9.15521 10.588 9.15433 10.4239V6.49388L10.3325 7.17419C10.3452 7.18031 10.3535 7.19256 10.3553 7.20656V10.4611C10.3535 11.9084 9.18146 13.0818 7.73421 13.0848ZM2.09746 10.6773C1.7899 10.1461 1.67921 9.52356 1.78465 8.91938C1.80521 8.93163 1.84152 8.95394 1.86733 8.96881L4.65508 10.5788C4.7964 10.6615 4.9714 10.6615 5.11315 10.5788L8.51646 8.61356V9.97419C8.51733 9.98819 8.51077 10.0018 8.49983 10.0105L5.6819 11.6376C4.42671 12.3603 2.82371 11.9307 2.0979 10.6773H2.09746ZM1.36377 4.59206C1.67002 4.06006 2.15346 3.65319 2.72921 3.44188C2.72921 3.46594 2.7279 3.50838 2.7279 3.53813V6.75856C2.72702 6.92219 2.81452 7.074 2.95671 7.15494L6.36002 9.11975L5.18183 9.80006C5.17002 9.80794 5.15515 9.80925 5.14202 9.80356L2.32365 8.17519C1.07108 7.44981 0.641458 5.84725 1.36333 4.5925L1.36377 4.59206ZM11.0439 6.84475L7.64058 4.8795L8.81877 4.19963C8.83058 4.19175 8.84546 4.19044 8.85858 4.19613L11.677 5.82319C12.9317 6.54813 13.3618 8.15331 12.6368 9.40806C12.3301 9.93919 11.8471 10.3461 11.2718 10.5578V7.24113C11.2731 7.0775 11.1861 6.92613 11.0443 6.84475H11.0439ZM12.2164 5.07988C12.1958 5.06719 12.1595 5.04531 12.1337 5.03044L9.34596 3.42044C9.20465 3.33775 9.02964 3.33775 8.8879 3.42044L5.48458 5.38569V4.02506C5.48371 4.01106 5.49027 3.9975 5.50121 3.98875L8.31915 2.363C9.57433 1.63894 11.1791 2.06988 11.9027 3.3255C12.2085 3.85575 12.3192 4.47656 12.2155 5.07988H12.2164Z' fill='%23CDCDCD'/%3E%3C/g%3E%3Cdefs%3E%3CclipPath id='clip0'%3E%3Crect width='14' height='14' fill='white'/%3E%3C/clipPath%3E%3C/defs%3E%3C/svg%3E"
                              alt='OpenAI'
                            />
                          )}
                          {item.key === 'modify' && (
                            <svg
                              xmlns='http://www.w3.org/2000/svg'
                              width='14'
                              height='14'
                              viewBox='0 0 12 12'
                              fill='none'
                            >
                              <path
                                d='M2 10H10'
                                stroke='#CDCDCD'
                                strokeWidth='1.5'
                              />
                              <path
                                d='M8.5 2L9.5 3L5 7.5L3 8L3.5 6L8 1.5L9 2.5'
                                stroke='#CDCDCD'
                                strokeWidth='1.5'
                              />
                            </svg>
                          )}
                          {item.key === 'chunk' && (
                            <svg
                              width='14'
                              height='14'
                              viewBox='0 0 14 14'
                              fill='none'
                              xmlns='http://www.w3.org/2000/svg'
                            >
                              <rect
                                x='0.5'
                                y='0.5'
                                width='4.5'
                                height='4.5'
                                stroke='#CDCDCD'
                                strokeWidth='1.5'
                              />
                              <rect
                                x='9'
                                y='0.5'
                                width='4.5'
                                height='4.5'
                                stroke='#CDCDCD'
                                strokeWidth='1.5'
                              />
                              <rect
                                x='0.5'
                                y='9'
                                width='4.5'
                                height='4.5'
                                stroke='#CDCDCD'
                                strokeWidth='1.5'
                              />
                              <rect
                                x='9'
                                y='9'
                                width='4.5'
                                height='4.5'
                                stroke='#CDCDCD'
                                strokeWidth='1.5'
                              />
                              <path
                                d='M5 2.75H9'
                                stroke='#CDCDCD'
                                strokeWidth='1.5'
                              />
                              <path
                                d='M2.75 5V9'
                                stroke='#CDCDCD'
                                strokeWidth='1.5'
                              />
                              <path
                                d='M11.25 5V9'
                                stroke='#CDCDCD'
                                strokeWidth='1.5'
                              />
                              <path
                                d='M5 11.25H9'
                                stroke='#CDCDCD'
                                strokeWidth='1.5'
                              />
                            </svg>
                          )}
                          {item.key === 'retrieve' && (
                            <svg
                              width='14'
                              height='14'
                              viewBox='0 0 14 14'
                              fill='none'
                              xmlns='http://www.w3.org/2000/svg'
                            >
                              <path d='M7 3H1V6H7V3Z' stroke='#CDCDCD' />
                              <path d='M7 6H1V9H7V6Z' stroke='#CDCDCD' />
                              <path d='M7 9H1V12H7V9Z' stroke='#CDCDCD' />
                              <path
                                d='M10.5 10L13 7.5L10.5 5'
                                stroke='#CDCDCD'
                                strokeWidth='1.5'
                              />
                              <path
                                d='M13.0003 7.49953L7 7.5'
                                stroke='#CDCDCD'
                                strokeWidth='1.5'
                              />
                            </svg>
                          )}
                          {item.key === 'generate' && (
                            <svg
                              width='14'
                              height='14'
                              viewBox='0 0 14 14'
                              fill='none'
                              xmlns='http://www.w3.org/2000/svg'
                            >
                              <path
                                d='M7 1V13'
                                stroke='#CDCDCD'
                                strokeWidth='1.5'
                              />
                              <path
                                d='M13 7L1 7'
                                stroke='#CDCDCD'
                                strokeWidth='1.5'
                              />
                              <path
                                d='M11.0711 2.92893L2.92893 11.0711'
                                stroke='#CDCDCD'
                                strokeWidth='1.5'
                              />
                              <path
                                d='M11.0711 11.0711L2.92893 2.92893'
                                stroke='#CDCDCD'
                                strokeWidth='1.5'
                              />
                            </svg>
                          )}
                          {item.key === 'deepresearch' && (
                            <svg
                              width='14'
                              height='14'
                              viewBox='0 0 14 14'
                              fill='none'
                              xmlns='http://www.w3.org/2000/svg'
                            >
                              <path
                                d='M7 2.5C7 2.5 4.5 1 2 3.5C2 3.5 1.5 6.5 4 7.5C4 7.5 6 8.5 7 11.5C7 11.5 8 8.5 10 7.5C10 7.5 12.5 6.5 12 3.5C12 3.5 9.5 1 7 2.5Z'
                                stroke='#CDCDCD'
                                strokeWidth='1.5'
                                fill='none'
                              />
                              <circle
                                cx='7'
                                cy='7'
                                r='2'
                                stroke='#CDCDCD'
                                strokeWidth='1.5'
                                fill='none'
                              />
                            </svg>
                          )}
                          {item.key === 'search' && (
                            <svg
                              width='14'
                              height='14'
                              viewBox='0 0 14 14'
                              fill='none'
                              xmlns='http://www.w3.org/2000/svg'
                            >
                              <circle
                                cx='5'
                                cy='5'
                                r='4'
                                fill='#1C1D1F'
                                stroke='#CDCDCD'
                                strokeWidth='1.5'
                              />
                              <path
                                d='M8 8L12 12'
                                stroke='#CDCDCD'
                                strokeWidth='1.5'
                                strokeLinecap='round'
                              />
                            </svg>
                          )}
                          {item.key === 'ifelse' && (
                            <svg
                              width='14'
                              height='14'
                              viewBox='0 0 14 14'
                              fill='none'
                              xmlns='http://www.w3.org/2000/svg'
                            >
                              <path
                                d='M1 7H4'
                                stroke='#D9D9D9'
                                strokeWidth='1.5'
                              />
                              <path
                                d='M4 7C4 7 4.35714 7 5.5 7C7.5 7 7 3 9 3C10.1429 3 10.8571 3 12 3'
                                stroke='#D9D9D9'
                                strokeWidth='1.5'
                              />
                              <path
                                d='M4 7C4 7 4.35714 7 5.5 7C7.5 7 6.5 11 8.57143 11C9.71429 11 10.8571 11 12 11'
                                stroke='#D9D9D9'
                                strokeWidth='1.5'
                              />
                              <path
                                d='M10.5 1L12.5 3L10.5 5'
                                stroke='#D9D9D9'
                              />
                              <path
                                d='M10.5 9L12.5 11L10.5 13'
                                stroke='#D9D9D9'
                              />
                            </svg>
                          )}
                          {item.key === 'load' && (
                            <svg
                              xmlns='http://www.w3.org/2000/svg'
                              width='13'
                              height='10'
                              viewBox='0 0 13 10'
                              fill='none'
                            >
                              <rect
                                x='0.75'
                                y='0.75'
                                width='5.5'
                                height='8.5'
                                stroke='#D9D9D9'
                                strokeWidth='1.5'
                              />
                              <path
                                d='M13 5L9 2.6906V7.3094L13 5ZM9 5.4H9.4V4.6H9V5.4Z'
                                fill='#D9D9D9'
                              />
                              <path
                                d='M6 5H10'
                                stroke='#D9D9D9'
                                strokeWidth='1.5'
                              />
                            </svg>
                          )}
                        </div>
                        <div className='flex flex-col items-start justify-center'>
                          <div className='text-[14px] font-plus-jakarta-sans leading-[16px]'>
                            {item.label.replace(' ▸', '')}
                          </div>
                          <div className='text-[11px] text-[#9AA0A6] leading-[14px]'>
                            {item.key === 'llm' &&
                              'Run an LLM over the content'}
                            {item.key === 'modify' &&
                              'Copy, convert formats, or edit content'}
                            {item.key === 'chunk' &&
                              'Split the content into chunks'}
                            {item.key === 'retrieve' &&
                              'Retrieve by vector similarity'}
                            {item.key === 'generate' &&
                              'Generate outputs using the context'}
                            {item.key === 'deepresearch' &&
                              'Plan and research across the web'}
                            {item.key === 'search' &&
                              'Search the web with engines'}
                            {item.key === 'ifelse' &&
                              'Branch logic using conditions'}
                            {item.key === 'load' && 'Load data from file'}
                          </div>
                        </div>
                      </div>
                      {item.submenuKey && (
                        <span className='text-[#9AA0A6]'>▸</span>
                      )}
                    </li>
                  );
                })}
              </React.Fragment>
            ))}
          </ul>
        </div>

        {/* Submenu panel */}
        {openSubmenuIndex !== null && (
          <div
            className='absolute left-full ml-1 bg-[#181818] text-[#CDCDCD] border-2 border-[#3E3E41] rounded-[10px] p-[8px] shadow-lg'
            style={{ top: submenuTop }}
            onMouseEnter={() => openSubmenuWithDelay(openSubmenuIndex)}
            onMouseLeave={closeSubmenuWithDelay}
          >
            {/* Determine which submenu to render: only show the submenu's own items */}
            {(() => {
              const items = getSubmenuItems(openSubmenuIndex);
              return (
                <ul
                  ref={subListRef}
                  className={`min-w-[200px] max-h-[360px] overflow-y-scroll overflow-x-hidden menu-scroll flex flex-col gap-[8px] p-[8px] pr-[0px] ${
                    subHasTopShadow ? 'scroll-shadow-top' : ''
                  } ${subHasBottomShadow ? 'scroll-shadow-bottom' : ''}`}
                  onScroll={handleSubScroll}
                >
                  {items.map((s, si) => (
                    <li
                      key={s.key}
                      className={`w-full h-[44px] ${s.disabled ? 'text-neutral-500 cursor-not-allowed' : 'cursor-pointer'} rounded-[8px] flex items-center justify-between gap-[11px] py-[8px] pl-[12px] pr-[12px] bg-[#252525] hover:bg-[#3E3E41]`}
                      onMouseEnter={() => setActiveSubIndex(si)}
                      onClick={() => {
                        if (s.disabled || !s.onPickEdgeType) return;
                        handlePick(s.onPickEdgeType, s.key);
                      }}
                    >
                      <div className='flex items-center gap-[11px] flex-1'>
                        <div className='w-[30px] h-[30px] bg-[#1C1D1F] flex items-center justify-center rounded-[5px]'>
                          {/* Chunk submenu icons */}
                          {s.key === 'auto' && (
                            <svg
                              xmlns='http://www.w3.org/2000/svg'
                              width='16'
                              height='15'
                              fill='none'
                              viewBox='0 0 16 15'
                            >
                              <path
                                fill='#CDCDCD'
                                d='M1.953.64v.61h-.68v4.292h.68v.612H.483V.641h1.47Zm4.585 3.472h-1.59l-.3.888h-.943L5.246.682h1.02L7.795 5h-.979l-.278-.888Zm-.252-.744L5.747 1.67l-.557 1.7h1.096Zm4.614-.032V.682h.917v2.654c0 .459-.07.816-.213 1.072-.266.469-.773.703-1.521.703-.748 0-1.256-.234-1.523-.703-.143-.256-.214-.613-.214-1.072V.682h.917v2.654c0 .297.035.514.105.65.11.243.348.364.715.364.365 0 .602-.121.712-.364.07-.136.105-.353.105-.65Zm3.812 2.206V1.238h-.68V.641h1.47v5.513h-1.47v-.612h.68ZM2.062 8.641v.609h-.68v4.292h.68v.612H.59V8.641h1.47Zm5.417.04v.765H6.187V13h-.909V9.446H3.98v-.764h3.5Zm2.334 4.44c-.617 0-1.088-.169-1.415-.505-.437-.412-.656-1.006-.656-1.781 0-.791.219-1.385.656-1.781.327-.336.798-.504 1.415-.504.618 0 1.09.168 1.415.504.436.396.654.99.654 1.781 0 .775-.218 1.37-.653 1.781-.327.336-.798.504-1.416.504Zm.853-1.161c.209-.264.313-.639.313-1.125 0-.484-.105-.858-.316-1.122-.209-.266-.492-.399-.85-.399-.357 0-.642.132-.855.396-.213.264-.32.639-.32 1.125s.107.861.32 1.125c.213.264.498.395.855.395.358 0 .642-.131.853-.395Z'
                              />
                            </svg>
                          )}
                          {s.key === 'by-length' && (
                            <svg
                              xmlns='http://www.w3.org/2000/svg'
                              width='16'
                              height='10'
                              viewBox='0 0 16 10'
                              fill='none'
                            >
                              <path d='M10 3L12 5L10 7' stroke='#CDCDCD' />
                              <path d='M6 3L4 5L6 7' stroke='#CDCDCD' />
                              <path d='M4 5H11.5' stroke='#CDCDCD' />
                              <path
                                d='M1 10L1 0'
                                stroke='#CDCDCD'
                                strokeWidth='1.5'
                              />
                              <path
                                d='M15 10V0'
                                stroke='#CDCDCD'
                                strokeWidth='1.5'
                              />
                            </svg>
                          )}
                          {s.key === 'by-character' && (
                            <svg
                              xmlns='http://www.w3.org/2000/svg'
                              width='14'
                              height='9'
                              fill='none'
                              viewBox='0 0 14 9'
                            >
                              <path
                                fill='#CDCDCD'
                                d='m2.816 2.584-.474 4.031h-.873L.982 2.584V.393h1.834v2.191ZM2.77 7.307V9H1.023V7.307H2.77Zm8.789-1.495c-.047.149-.073.38-.077.692H9.9c.024-.66.086-1.115.188-1.365.102-.254.363-.545.785-.873l.428-.334a1.52 1.52 0 0 0 .34-.346 1.18 1.18 0 0 0 .234-.709c0-.297-.088-.566-.264-.809-.171-.246-.488-.369-.949-.369-.453 0-.775.15-.967.451-.187.301-.28.614-.28.938H7.72c.047-1.113.435-1.902 1.166-2.367.46-.297 1.027-.446 1.699-.446.883 0 1.615.211 2.197.633.586.422.88 1.047.88 1.875 0 .508-.128.936-.382 1.283-.148.211-.433.48-.855.809l-.416.322a1.257 1.257 0 0 0-.451.615ZM11.605 9H9.86V7.307h1.746V9Z'
                              />
                            </svg>
                          )}

                          {/* Modify submenu icons */}
                          {s.key === 'copy' && (
                            <svg
                              xmlns='http://www.w3.org/2000/svg'
                              width='12'
                              height='12'
                              viewBox='0 0 12 12'
                              fill='none'
                            >
                              <path
                                d='M8 1H2C1.45 1 1 1.45 1 2V8'
                                stroke='#CDCDCD'
                                strokeWidth='1.5'
                                strokeLinecap='round'
                              />
                              <rect
                                x='4'
                                y='4'
                                width='7'
                                height='7'
                                rx='1'
                                stroke='#CDCDCD'
                                strokeWidth='1.5'
                              />
                            </svg>
                          )}
                          {(s.key === 'convert-structured' ||
                            s.key === 'convert-text') && (
                            <svg
                              xmlns='http://www.w3.org/2000/svg'
                              width='14'
                              height='14'
                              viewBox='0 0 14 14'
                              fill='none'
                            >
                              <path
                                d='M12 2L2 12'
                                stroke='#CDCDCD'
                                strokeWidth='1.5'
                              />
                              <path
                                d='M12 2L8 2'
                                stroke='#CDCDCD'
                                strokeWidth='1.5'
                              />
                              <path
                                d='M12 2L12 6'
                                stroke='#CDCDCD'
                                strokeWidth='1.5'
                              />
                              <path
                                d='M2 12L6 12'
                                stroke='#CDCDCD'
                                strokeWidth='1.5'
                              />
                              <path
                                d='M2 12L2 8'
                                stroke='#CDCDCD'
                                strokeWidth='1.5'
                              />
                            </svg>
                          )}
                          {(s.key === 'edit-text' ||
                            s.key === 'edit-structured') && (
                            <svg
                              xmlns='http://www.w3.org/2000/svg'
                              width='14'
                              height='14'
                              viewBox='0 0 14 14'
                              fill='none'
                            >
                              <path
                                d='M8.5 2.5L11.5 5.5L5 12H2V9L8.5 2.5Z'
                                stroke='#CDCDCD'
                                strokeWidth='1.5'
                              />
                              <path
                                d='M8.5 2.5L9.5 1.5L12.5 4.5L11.5 5.5'
                                stroke='#CDCDCD'
                                strokeWidth='1.5'
                              />
                            </svg>
                          )}

                          {/* Search submenu icons */}
                          {s.key === 'google' && (
                            <FontAwesomeIcon
                              icon={faGoogle}
                              color='#CDCDCD'
                              size='sm'
                            />
                          )}
                          {s.key === 'perplexity' && (
                            <svg
                              xmlns='http://www.w3.org/2000/svg'
                              width='14'
                              height='14'
                              viewBox='0 0 14 14'
                              fill='none'
                            >
                              <circle
                                cx='7'
                                cy='7'
                                r='5'
                                stroke='#CDCDCD'
                                strokeWidth='1.5'
                              />
                              <circle cx='9.5' cy='4.5' r='1' fill='#CDCDCD' />
                            </svg>
                          )}

                          {/* Fallback generic icon for disabled options */}
                          {(s.key === 'for-html' ||
                            s.key === 'for-markdown') && (
                            <svg
                              xmlns='http://www.w3.org/2000/svg'
                              width='10'
                              height='6'
                              fill='none'
                              viewBox='0 0 10 6'
                            >
                              <path
                                fill='#D9D9D9'
                                d='M0 0h2v2H0zm4 0h2v2H4zm4 0h2v2H8zM0 4h2v2H0zm4 0h2v2H4zm4 0h2v2H8z'
                              />
                            </svg>
                          )}
                        </div>
                        <div className='text-[14px] font-plus-jakarta-sans flex items-center justify-center h-full'>
                          {s.label}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              );
            })()}
          </div>
        )}
      </div>
      <style jsx>{`
        .menu-scroll {
          -ms-overflow-style: auto; /* IE and Edge */
          scrollbar-width: thin; /* Firefox: thin, always visible */
          scrollbar-color: #777777 transparent; /* slightly darker than border */
          overscroll-behavior: contain;
          scrollbar-gutter: stable; /* keep gutter so content won't shift */
          color-scheme: light; /* prefer light scrollbars where supported */
        }
        /* WebKit: thin, darker gray, always visible */
        .menu-scroll::-webkit-scrollbar {
          width: 6px;
          background: transparent;
        }
        .menu-scroll::-webkit-scrollbar-track {
          background: transparent;
        }
        .menu-scroll::-webkit-scrollbar-thumb {
          background: #777777 !important;
          border-radius: 8px;
          border: 2px solid rgba(0, 0, 0, 0); /* keep thumb slim look */
          box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.04);
        }
        .menu-scroll::-webkit-scrollbar-thumb:hover {
          background: #828282 !important;
        }
        .menu-container {
          overscroll-behavior: contain;
        }
        .scroll-shadow-top {
          box-shadow: inset 0 8px 8px -8px rgba(0, 0, 0, 0.35);
        }
        .scroll-shadow-bottom {
          box-shadow: inset 0 -8px 8px -8px rgba(0, 0, 0, 0.35);
        }
        /* Center the left/right target handles only for this component */
        .center-target-left {
          top: 50% !important;
          transform: translateY(-50%) !important;
          left: -12px !important;
        }
        .center-target-right {
          top: 50% !important;
          transform: translateY(-50%) !important;
          right: -12px !important;
        }
      `}</style>
    </div>
  );
};

export default EdgeMenuNode;
