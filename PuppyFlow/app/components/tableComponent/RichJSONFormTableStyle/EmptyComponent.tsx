'use client';
import React, { useState } from 'react';
import { useSelection } from './ComponentRenderer';
import { useOverflowContext } from './OverflowContext';
import { getClipboard } from './ClipboardStore';

type ComponentType = 'text' | 'dict' | 'list';

type EmptyComponentProps = {
  onTypeSelect: (type: ComponentType) => void;
  preventParentDrag: () => void;
  allowParentDrag: () => void;
  readonly?: boolean;
  selectedType?: ComponentType | null;
  showAsSelected?: boolean;
  path?: string;
  onReplace?: (newValue: any) => void;
};

// EmptyComponent 主组件
const EmptyComponent = ({
  onTypeSelect,
  preventParentDrag,
  allowParentDrag,
  readonly = false,
  selectedType = null,
  showAsSelected = false,
  path = '',
  onReplace,
}: EmptyComponentProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const { isPathSelected, setSelectedPath } = useSelection();
  const isSelected = isPathSelected(path);
  const [isHovered, setIsHovered] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const { registerOverflowElement, unregisterOverflowElement } =
    useOverflowContext();
  const handleRef = React.useRef<HTMLDivElement | null>(null);

  const accentColor = isSelected ? '#8A8A8A' : '#7A7A7A';

  const types = [
    {
      type: 'text' as ComponentType,
      label: 'text',
      description: 'Simple text content',
      icon: (
        <svg
          className='w-3 h-3'
          viewBox='0 0 16 16'
          fill='none'
          stroke='currentColor'
          strokeWidth='1.5'
        >
          <path
            d='M2 4h12M2 8h8M2 12h10'
            strokeLinecap='round'
            strokeLinejoin='round'
          />
        </svg>
      ),
    },
    {
      type: 'list' as ComponentType,
      label: 'list',
      description: 'Ordered list of items',
      icon: (
        <svg
          className='w-3 h-3'
          viewBox='0 0 16 16'
          fill='none'
          stroke='currentColor'
          strokeWidth='1.5'
        >
          <path
            d='M6 4h8M6 8h8M6 12h8M2 4h.01M2 8h.01M2 12h.01'
            strokeLinecap='round'
            strokeLinejoin='round'
          />
        </svg>
      ),
    },
    {
      type: 'dict' as ComponentType,
      label: 'dict',
      description: 'Key-value pairs',
      icon: (
        <svg
          className='w-3 h-3'
          viewBox='0 0 16 16'
          fill='none'
          stroke='currentColor'
          strokeWidth='1.5'
        >
          <path
            d='M3 3v3l-1 2 1 2v3M13 3v3l1 2-1 2v3'
            strokeLinecap='round'
            strokeLinejoin='round'
          />
          <path
            d='M7 5v1M8 7v1M7 9v1'
            strokeLinecap='round'
            strokeLinejoin='round'
          />
        </svg>
      ),
    },
  ];

  const handleTypeSelect = (type: ComponentType) => {
    onTypeSelect(type);
    setIsOpen(false);
  };

  const selectedTypeInfo = selectedType
    ? types.find(t => t.type === selectedType)
    : null;

  // Menu portal for the handle - show copy only and type transfer actions similar to others
  React.useEffect(() => {
    const menuId = `empty-menu-${path}`;
    if (!menuOpen || !handleRef.current) return;

    let rafId: number | null = null;

    const updatePosition = () => {
      if (!handleRef.current) return;
      const rect = handleRef.current.getBoundingClientRect();
      const gap = 8;
      const top = rect.top;
      const left = rect.left - gap;

      // Use a minimal menu containing only Copy, consistent with request
      const element = (
        <div
          style={{
            position: 'fixed',
            top,
            left,
            transform: 'translateX(-100%)',
          }}
        >
          <div className='rjft-action-menu bg-[#252525] p-[8px] border-[1px] border-[#2a2a2a] rounded-[8px] gap-[4px] flex flex-col w-[128px]'>
            <button
              className='px-[0px] rounded-[4px] bg-inherit hover:bg-[#3E3E41] w-full h-[26px] flex justify-start items-center text-[#E5E7EB] font-plus-jakarta-sans text-[12px] font-[400] tracking-[0.5px] cursor-pointer whitespace-nowrap gap-[8px]'
              onClick={() => {
                navigator.clipboard.writeText('');
                window.dispatchEvent(new CustomEvent('rjft:close-all-menus'));
              }}
            >
              <svg
                className='w-3.5 h-3.5 text-[#D1D5DB]'
                viewBox='0 0 20 20'
                fill='none'
                stroke='currentColor'
                strokeWidth='1.6'
              >
                <rect x='7' y='7' width='9' height='9' rx='1.8' />
                <rect x='4' y='4' width='9' height='9' rx='1.8' />
              </svg>
              <span>Copy</span>
            </button>
            <button
              className='px-[0px] rounded-[4px] bg-inherit hover:bg-[#3E3E41] w-full h-[26px] flex justify-start items-center text-[#E5E7EB] font-plus-jakarta-sans text-[12px] font-[400] tracking-[0.5px] cursor-pointer whitespace-nowrap gap-[8px]'
              onClick={async () => {
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
                    onReplace && onReplace(payload);
                  } else if (payload && typeof payload === 'object') {
                    onReplace && onReplace(payload);
                  } else if (typeof payload === 'string') {
                    onReplace && onReplace(payload);
                  }
                }
                window.dispatchEvent(new CustomEvent('rjft:close-all-menus'));
              }}
            >
              <svg
                className='w-3.5 h-3.5 text-[#D1D5DB]'
                viewBox='0 0 20 20'
                fill='none'
                stroke='currentColor'
                strokeWidth='1.6'
              >
                <path d='M7 4h6v2H7z' />
                <rect x='5' y='6' width='10' height='10' rx='2' />
                <path d='M8 10h4M8 13h4' strokeLinecap='round' />
              </svg>
              <span>Paste</span>
            </button>
          </div>
        </div>
      );

      registerOverflowElement(menuId, element, handleRef.current);
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
  }, [menuOpen, registerOverflowElement, unregisterOverflowElement, path]);

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

  // 如果显示为已选择状态（类似 TypeSelector 的 showAsCreated）
  if (showAsSelected && selectedTypeInfo) {
    return (
      <div
        className='bg-[#0F0F0F] shadow-sm relative group'
        style={{
          outline: 'none',
          boxShadow: isSelected ? 'inset 0 0 0 2px #666666' : 'none',
        }}
        onClick={e => {
          e.stopPropagation();
          setSelectedPath(path);
        }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <div className='absolute left-0 top-0 bottom-0 w-px bg-[#2a2a2a] z-20'>
          {(isSelected || isHovered || menuOpen) && (
            <div className='absolute left-1/2 top-1/2 transform -translate-x-1/2 -translate-y-1/2 pointer-events-none'>
              <div
                className='w-4 h-6 bg-[#0F0F0F] border-2 rounded-[3px] flex flex-col items-center justify-center gap-0.5 shadow-lg cursor-pointer pointer-events-auto'
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
          )}
        </div>
        <div className='w-full px-[16px] py-[6px] bg-[#0F0F0F] rounded-md overflow-hidden transition-colors duration-200'>
          <button
            onClick={() => setIsOpen(!isOpen)}
            className='flex items-center justify-between w-full h-[24px] bg-[#2A2D35] hover:bg-[#3A3D45] border border-[#4B5563] rounded-lg px-3 py-1 transition-colors'
            onMouseDown={preventParentDrag}
            onMouseUp={allowParentDrag}
          >
            <div className='flex items-center space-x-2'>
              {selectedTypeInfo.icon}
              <span className='text-[12px] text-white font-plus-jakarta-sans'>
                {selectedTypeInfo.label}
              </span>
            </div>
            <svg
              className={`w-3 h-3 text-[#9CA3AF] transition-transform ${isOpen ? 'rotate-180' : ''}`}
              fill='none'
              stroke='currentColor'
              viewBox='0 0 24 24'
            >
              <path
                strokeLinecap='round'
                strokeLinejoin='round'
                strokeWidth={2}
                d='M19 9l-7 7-7-7'
              />
            </svg>
          </button>
          {isOpen && (
            <div className='absolute top-full left-0 right-0 mt-1 bg-[#2A2D35] border border-[#4B5563] rounded-lg shadow-xl z-50'>
              {types.map(typeInfo => (
                <button
                  key={typeInfo.type}
                  onClick={() => handleTypeSelect(typeInfo.type)}
                  className={`w-full text-left hover:bg-[#3A3D45] transition-colors flex items-center space-x-3 p-3 first:rounded-t-lg last:rounded-b-lg ${selectedType === typeInfo.type ? 'bg-[#3A3D45] border-l-2 border-blue-500' : ''}`}
                >
                  {typeInfo.icon}
                  <div>
                    <div className='text-white font-medium text-sm'>
                      {typeInfo.label}
                    </div>
                    <div className='text-[#9CA3AF] text-xs'>
                      {typeInfo.description}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // 默认的类型选择状态（空元素初始不显示，hover时显示创建提示）
  return (
    <div
      className='bg-[#252525] shadow-sm relative group/empty'
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
      <div className='absolute left-0 top-0 bottom-0 w-px bg-[#4A4D54] z-20'>
        {(isSelected || isHovered || menuOpen) && (
          <div className='absolute left-1/2 top-1/2 transform -translate-x-1/2 -translate-y-1/2 pointer-events-none'>
            <div
              className='w-4 h-6 bg-[#0F0F0F] border-2 rounded-[3px] flex flex-col items-center justify-center gap-0.5 shadow-lg cursor-pointer pointer-events-auto'
              style={{ borderColor: accentColor }}
              aria-hidden
              onClick={e => {
                e.stopPropagation();
                setSelectedPath(path);
                if (menuOpen) {
                  setMenuOpen(false);
                } else {
                  window.dispatchEvent(new CustomEvent('rjft:close-all-menus'));
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
        )}
      </div>
      {isSelected && (
        <div
          aria-hidden
          className='pointer-events-none absolute inset-0 z-10'
          style={{ boxShadow: 'inset 0 0 0 2px #6B7280' }}
        />
      )}
      <div className='w-full px-[16px] py-[8px] bg-[#252525] rounded-md overflow-hidden transition-colors duration-200'>
        {readonly ? (
          <div className='flex items-center h-[24px]'></div>
        ) : (
          <div className='flex items-center h-[24px] space-x-2 opacity-0 group-hover/empty:opacity-100 transition-opacity duration-150'>
            <span className='text-[#6D7177] text-[12px] italic leading-normal font-plus-jakarta-sans'>
              create a type
            </span>
            {types.map(typeInfo => (
              <button
                key={typeInfo.type}
                onClick={() => handleTypeSelect(typeInfo.type)}
                className='flex items-center justify-center w-6 h-5 bg-[#2a2a2a] hover:bg-[#3a3a3a] border border-[#6D7177]/30 hover:border-[#6D7177]/50 rounded-md text-[#CDCDCD] hover:text-white transition-all duration-200 opacity-0 group-hover/empty:opacity-100'
                onMouseDown={preventParentDrag}
                onMouseUp={allowParentDrag}
                title={`Create ${typeInfo.label}`}
              >
                {typeInfo.icon}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default EmptyComponent;
