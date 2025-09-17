'use client';
import React, { useState } from 'react';
import ComponentRenderer, {
  createEmptyElement,
  useHover,
  useSelection,
} from './ComponentRenderer';
import ListActionMenu from './ListActionMenu';
import { getClipboard } from './ClipboardStore';
import { useOverflowContext } from './OverflowContext';

type ListComponentProps = {
  data: any[];
  path: string;
  readonly?: boolean;
  isNested?: boolean;
  onUpdate: (newData: any[]) => void;
  onDelete?: () => void;
  parentKey?: string | number;
  preventParentDrag: () => void;
  allowParentDrag: () => void;
  onReplace?: (newValue: any) => void;
};

const ListComponent = ({
  data,
  path = '',
  readonly = false,
  isNested = false,
  onUpdate,
  onDelete,
  preventParentDrag,
  allowParentDrag,
  onReplace,
}: ListComponentProps) => {
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null); // unused after removing DnD
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null); // unused after removing DnD
  const [showMenu, setShowMenu] = useState(false);

  const { hoveredPath, setHoveredPath, isPathHovered } = useHover();

  const deleteItem = (index: number) => {
    const newData = data.filter((_, i) => i !== index);
    onUpdate(newData);
  };

  const addEmptyItem = () => {
    const newData = [...data, createEmptyElement()];
    onUpdate(newData);
  };

  const updateItem = (index: number, newValue: any) => {
    const newData = [...data];
    newData[index] = newValue;
    onUpdate(newData);
  };

  const handleMouseDown = (index: number) => {
    setSelectedIndex(index);
  };

  const handleMouseUp = () => {
    setSelectedIndex(null);
  };

  // Drag-and-drop disabled: remove handlers

  const handleMenuClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setShowMenu(!showMenu);
  };

  const handleCopyList = () => {
    navigator.clipboard.writeText(JSON.stringify(data, null, 2));
    setShowMenu(false);
  };

  const handleClearList = () => {
    // Clear: set the entire list to null (but keep it in parent structure)
    onUpdate(null as any);
    setShowMenu(false);
  };

  const handleDeleteList = () => {
    // Delete: 删除整个列表（包括其在父结构中的键/索引）
    if (onDelete) {
      onDelete();
    } else {
      console.log('Delete list requested but no onDelete callback provided');
    }
    setShowMenu(false);
  };

  // Close menu when clicking outside or mouse leaves
  React.useEffect(() => {
    const handleClickOutside = () => setShowMenu(false);
    if (showMenu) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [showMenu]);

  const handleMenuMouseLeave = () => {
    setShowMenu(false);
  };

  // 构建当前index的完整路径
  const getIndexPath = (index: number) => {
    return path ? `${path}[${index}]` : `[${index}]`;
  };

  // 处理hover事件
  const handleIndexHover = (index: number, isEntering: boolean) => {
    if (isEntering) {
      setHoveredPath(getIndexPath(index));
    } else {
      setHoveredPath(null);
    }
  };

  // Drag-and-drop disabled

  const { isPathSelected, setSelectedPath } = useSelection();
  const [isHovered, setIsHovered] = React.useState(false);
  const isSelected = isPathSelected(path);

  const accentColor = isSelected ? '#E4B66E' : '#D7A85A';
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [isCollapsed, setIsCollapsed] = React.useState(false);
  const { registerOverflowElement, unregisterOverflowElement } =
    useOverflowContext();
  const handleRef = React.useRef<HTMLDivElement | null>(null);
  // Anchor map for per-index inline actions (delete) rendered via portal
  const indexAnchorMapRef = React.useRef<Map<number, HTMLElement>>(new Map());
  // Close inline index actions on outside click
  React.useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('.rjft-index-inline-actions')) return;
      setSelectedIndex(null);
    };
    document.addEventListener('mousedown', onDoc, true);
    return () => document.removeEventListener('mousedown', onDoc, true);
  }, []);

  React.useEffect(() => {
    const menuId = `list-menu-${path}`;
    if (!menuOpen || !handleRef.current) return;

    let rafId: number | null = null;

    const updatePosition = () => {
      if (!handleRef.current) return;
      const rect = handleRef.current.getBoundingClientRect();
      const gap = 8;

      const top = rect.top;

      const left = rect.left - gap;

      registerOverflowElement(
        menuId,
        <div
          style={{
            position: 'fixed',
            top,
            left,
            transform: 'translateX(-100%)',
          }}
        >
          <ListActionMenu
            value={data}
            onClear={() => {
              onUpdate(null as any);
              setMenuOpen(false);
            }}
            onTransferToText={() => {
              onReplace && onReplace('');
              setMenuOpen(false);
            }}
            onTransferToDict={() => {
              onReplace && onReplace({ key1: null, key2: null });
              setMenuOpen(false);
            }}
            onPaste={async () => {
              let payload: any = getClipboard();
              if (!payload) {
                try {
                  const text = await navigator.clipboard.readText();
                  payload = text?.startsWith('__RJF__')
                    ? JSON.parse(text.slice('__RJF__'.length))
                    : JSON.parse(text);
                } catch {}
              }
              if (payload !== undefined) {
                if (Array.isArray(payload)) {
                  onUpdate(payload);
                } else if (payload && typeof payload === 'object') {
                  onReplace && onReplace(payload);
                } else if (typeof payload === 'string') {
                  onReplace && onReplace(payload);
                }
              }
              setMenuOpen(false);
            }}
            isCollapsed={isCollapsed}
            onToggleCollapse={() => setIsCollapsed(prev => !prev)}
          />
        </div>,
        handleRef.current
      );
    };

    const loop = () => {
      updatePosition();
      rafId = requestAnimationFrame(loop);
    };
    loop();

    const onDocClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (handleRef.current && handleRef.current.contains(target)) return;
      if (target.closest('.rjft-action-menu')) return;
      setMenuOpen(false);
    };
    const onScroll = () => updatePosition();
    const onResize = () => updatePosition();
    document.addEventListener('mousedown', onDocClick, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      unregisterOverflowElement(menuId);
      document.removeEventListener('mousedown', onDocClick, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [
    menuOpen,
    data,
    onUpdate,
    onReplace,
    path,
    registerOverflowElement,
    unregisterOverflowElement,
    isCollapsed,
  ]);

  // Ensure only one menu is open globally
  React.useEffect(() => {
    const onCloseAll = () => setMenuOpen(false);
    window.addEventListener(
      'rjft:close-all-menus',
      onCloseAll as EventListener
    );
    return () =>
      window.removeEventListener(
        'rjft:close-all-menus',
        onCloseAll as EventListener
      );
  }, []);

  // Render per-index inline actions via portal (positioned above index)
  React.useEffect(() => {
    const currentIndex = selectedIndex;
    if (currentIndex === null || readonly) return;
    const anchor = indexAnchorMapRef.current.get(currentIndex);
    if (!anchor) return;

    const menuId = `list-index-actions-${path}-${currentIndex}`;
    let rafId: number | null = null;

    const updatePosition = () => {
      const rect = anchor.getBoundingClientRect();
      const gap = 6;
      const top = rect.top - gap;
      const left = rect.left + rect.width / 2;

      const element = (
        <div
          className='rjft-index-inline-actions'
          style={{
            position: 'fixed',
            top,
            left,
            transform: 'translate(-50%, -100%)',
          }}
        >
          <div className='flex items-center gap-[6px] bg-[#252525] p-[4px] rounded-[6px] border border-[#404040] shadow-lg'>
            <button
              className='h-[22px] w-[22px] rounded-[4px] bg-[#2a2a2a] hover:bg-[#3E3E41] border border-[#6D7177]/40 flex items-center justify-center'
              title='Delete item'
              onClick={e => {
                e.stopPropagation();
                deleteItem(currentIndex);
                setSelectedIndex(null);
              }}
            >
              <svg
                className='w-3.5 h-3.5'
                viewBox='0 0 20 20'
                fill='none'
                stroke='#F44336'
                strokeWidth='1.6'
              >
                <path
                  d='M6 6h8m-7 2.5V15a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1V8.5M8 6V4.8A1.8 1.8 0 0 1 9.8 3h0.4A1.8 1.8 0 0 1 12 4.8V6'
                  strokeLinecap='round'
                />
              </svg>
            </button>
          </div>
        </div>
      );

      registerOverflowElement(menuId, element, anchor);
    };

    const loop = () => {
      updatePosition();
      rafId = requestAnimationFrame(loop);
    };
    loop();

    const onScroll = () => updatePosition();
    const onResize = () => updatePosition();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      unregisterOverflowElement(menuId);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [
    selectedIndex,
    readonly,
    path,
    registerOverflowElement,
    unregisterOverflowElement,
  ]);

  return (
    <div
      className={`bg-[#252525] shadow-sm relative group group/list`}
      style={{
        outline: 'none',
      }}
      onClick={e => {
        e.stopPropagation();
        setSelectedPath(path);
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div
        className='absolute left-0 top-0 bottom-0 w-px z-20'
        style={{
          backgroundColor:
            isSelected || isHovered || menuOpen ? '#9A713C' : '#4A4D54',
        }}
      >
        {(isSelected || isHovered || menuOpen) && (
          <>
            <div className='absolute left-1/2 top-1 transform -translate-x-1/2 pointer-events-none'>
              <div
                className='w-4 h-6 bg-[#252525] border-2 rounded-[3px] flex flex-col items-center justify-center gap-0.5 shadow-lg cursor-pointer pointer-events-auto'
                style={{ borderColor: accentColor }}
                aria-hidden
                onClick={e => {
                  e.stopPropagation();
                  setSelectedPath(path);
                  if (menuOpen) {
                    setMenuOpen(false);
                  } else {
                    window.dispatchEvent(
                      new CustomEvent('rjft:close-all-menus')
                    );
                    setMenuOpen(true);
                  }
                }}
                ref={handleRef}
              >
                <div
                  className='w-0.5 h-0.5 rounded-full'
                  style={{ backgroundColor: accentColor }}
                ></div>
                <div
                  className='w-0.5 h-0.5 rounded-full'
                  style={{ backgroundColor: accentColor }}
                ></div>
                <div
                  className='w-0.5 h-0.5 rounded-full'
                  style={{ backgroundColor: accentColor }}
                ></div>
              </div>
            </div>
            <div
              className='absolute left-1/2 pointer-events-none transform -translate-x-1/2'
              style={{ top: '36px' }}
            >
              <button
                className='h-[18px] w-[18px] rounded-[4px] bg-[#2a2a2a] hover:bg-[#3E3E41] border border-[#2a2a2a] flex items-center justify-center pointer-events-auto'
                title={isCollapsed ? 'Expand' : 'Collapse'}
                onClick={e => {
                  e.stopPropagation();
                  setIsCollapsed(prev => !prev);
                }}
              >
                <svg
                  className='w-3 h-3 text-[#E5E7EB]'
                  viewBox='0 0 20 20'
                  fill='none'
                  stroke='currentColor'
                  strokeWidth='1.6'
                >
                  <path
                    d={isCollapsed ? 'M6 8l4 4 4-4' : 'M6 12l4-4 4 4'}
                    strokeLinecap='round'
                    strokeLinejoin='round'
                  />
                </svg>
              </button>
            </div>
          </>
        )}
        {/* selection outline rendered via CSS outline */}
      </div>
      {/* menu rendered via portal */}
      <div className={`space-y-0 transition-all duration-200`}>
        {isCollapsed ? (
          <div
            className='w-full px-[12px] h-[40px] bg-[#0F0F0F] rounded-md overflow-hidden flex items-center'
            title={`list with ${Array.isArray(data) ? data.length : 0} items`}
          >
            <div className='flex items-center gap-[8px] text-[#E5E7EB] text-[12px] font-plus-jakarta-sans'>
              <span className='text-[#C18E4C]'>list</span>
              <span className='text-[#6D7177]'>•</span>
              <span className='text-[#CDCDCD]'>
                {Array.isArray(data) ? data.length : 0} items
              </span>
            </div>
          </div>
        ) : data.length === 0 ? (
          // Empty state - 不显示“click + to add”，仅提示为空
          <div className='w-full px-[16px] py-[8px] bg-[#0F0F0F] rounded-md overflow-hidden transition-colors duration-200'>
            <div className='flex items-center h-[24px]'>
              <div className='text-[#6D7177] text-[12px] italic leading-normal font-plus-jakarta-sans'>
                empty list
              </div>
            </div>
          </div>
        ) : (
          <>
            {data.map((item, index) => {
              const indexPath = getIndexPath(index);
              const isIndexHovered = isPathHovered(indexPath);
              const showDropIndicator = false; // DnD disabled

              return (
                <React.Fragment key={index}>
                  {/* Drop Indicator Line - Enhanced visual feedback */}
                  {showDropIndicator && (
                    <div className='relative'>
                      <div className='absolute inset-x-0 -top-[2px] h-[3px] bg-gradient-to-r from-blue-400 to-blue-500 z-40 rounded-full shadow-lg animate-pulse'>
                        <div className='absolute left-2 -top-1.5 w-3 h-3 bg-blue-400 rounded-full shadow-md'></div>
                        <div className='absolute right-2 -top-1.5 w-3 h-3 bg-blue-500 rounded-full shadow-md opacity-60'></div>
                      </div>
                    </div>
                  )}

                  <div
                    className={`group relative transition-all duration-200 ${
                      showDropIndicator
                        ? 'bg-blue-400/20 ring-2 ring-blue-400/50'
                        : isIndexHovered
                          ? 'bg-[#CDCDCD]/10'
                          : 'hover:bg-[#6D7177]/10'
                    }`}
                    onMouseEnter={() => setHoveredPath(indexPath)}
                    onMouseLeave={() => setHoveredPath(null)}
                  >
                    <div className='flex items-stretch'>
                      {/* Index Badge - display only */}
                      <div className='flex-shrink-0 flex justify-start'>
                        <div
                          className='relative w-[96px] h-full px-[10px] py-[8px] bg-[#252525] overflow-visible transition-colors duration-200 flex items-center justify-start'
                          onMouseEnter={() => handleIndexHover(index, true)}
                          onMouseLeave={() => handleIndexHover(index, false)}
                          onClick={e => {
                            e.stopPropagation();
                            setSelectedPath(path);
                            setSelectedIndex(prev =>
                              prev === index ? null : index
                            );
                          }}
                          ref={el => {
                            if (el) {
                              indexAnchorMapRef.current.set(index, el);
                            } else {
                              indexAnchorMapRef.current.delete(index);
                            }
                          }}
                        >
                          {/* remove inner separator line to avoid double line in dict/list items */}
                          <span
                            className='block w-full h-full text-[12px] leading-[20px] font-plus-jakarta-sans not-italic transition-colors duration-200'
                            style={{
                              color:
                                isSelected || isIndexHovered
                                  ? '#C18E4C'
                                  : '#9FA3A9',
                            }}
                          >
                            {index}
                          </span>
                          {/* Inline actions are rendered via portal now */}
                        </div>
                      </div>

                      {/* Content */}
                      <div className='flex-1 min-w-0'>
                        <ComponentRenderer
                          data={item}
                          path={indexPath}
                          readonly={readonly}
                          parentKey={index}
                          onUpdate={newValue => updateItem(index, newValue)}
                          onDelete={() => deleteItem(index)}
                          preventParentDrag={preventParentDrag}
                          allowParentDrag={allowParentDrag}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Drop indicator after last element - Enhanced */}
                  {index === data.length - 1 && showDropIndicator && (
                    <div className='relative'>
                      <div className='absolute inset-x-0 top-[2px] h-[3px] bg-gradient-to-r from-blue-400 to-blue-500 z-40 rounded-full shadow-lg animate-pulse'>
                        <div className='absolute left-2 -top-1.5 w-3 h-3 bg-blue-400 rounded-full shadow-md'></div>
                        <div className='absolute right-2 -top-1.5 w-3 h-3 bg-blue-500 rounded-full shadow-md opacity-60'></div>
                      </div>
                    </div>
                  )}

                  {/* Horizontal Divider Line - 在元素之间添加水平分隔线 */}
                  {index < data.length - 1 && (
                    <div className='w-full h-[1px] bg-[#4A4D54] my-[4px]'></div>
                  )}
                </React.Fragment>
              );
            })}

            {/* Items rendered above */}
          </>
        )}
        {/* Add New Item - 仅在 hover/选中/菜单打开时显示（只读除外） */}
        {!readonly && !isCollapsed && (
          <div className='absolute -bottom-3 left-[36px] z-30 transform -translate-x-1/2'>
            <button
              onClick={addEmptyItem}
              className={`group w-6 h-6 flex items-center justify-center rounded-full 
                                     bg-[#2a2a2a] hover:bg-[#3a3a3a] border border-[#6D7177]/40 hover:border-[#6D7177]/60 
                                     transition-all duration-200 ease-out shadow-lg 
                                     ${isHovered || isSelected || menuOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
              title='Add new item'
            >
              <svg
                className='w-3 h-3 text-[#E5E7EB] transition-transform duration-200 group-hover:scale-110'
                viewBox='0 0 16 16'
                fill='none'
                stroke='currentColor'
                strokeWidth='1.5'
                strokeLinecap='round'
                strokeLinejoin='round'
              >
                <path d='M8 3v10M3 8h10' />
              </svg>
            </button>
          </div>
        )}
      </div>
      {isSelected && (
        <div
          aria-hidden
          className='pointer-events-none absolute inset-0 z-[100]'
          style={{ boxShadow: 'inset 0 0 0 2px #C18E4C' }}
        />
      )}
    </div>
  );
};

export default ListComponent;
