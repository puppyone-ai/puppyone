'use client';
import React, { useCallback, useState } from 'react';
import TextEditor from '../TextEditor';
import TextActionMenu from './TextActionMenu';
import { useOverflowContext } from './OverflowContext';
import { useSelection } from './ComponentRenderer';

type TextComponentProps = {
  data: string;
  path: string;
  readonly?: boolean;
  isRoot?: boolean;
  onEdit: (path: string, value: string) => void;
  onDelete?: () => void;
  parentKey?: string | number;
  preventParentDrag: () => void;
  allowParentDrag: () => void;
  onReplace?: (newValue: any) => void;
};

const TextComponent = React.memo(
  ({
    data,
    path,
    readonly = false,
    isRoot = false,
    onEdit,
    onDelete,
    parentKey,
    preventParentDrag,
    allowParentDrag,
    onReplace,
  }: TextComponentProps) => {
    const handleEditChange = useCallback(
      (newValue: string) => {
        if (!readonly) {
          onEdit(path, newValue);
        }
      },
      [readonly, onEdit, path]
    );

    const { isPathSelected, setSelectedPath } = useSelection();
    const [isHovered, setIsHovered] = useState(false);
    const isSelected = isPathSelected(path);

    const accentColor = isSelected ? '#5AB6F2' : '#4AA6EC';

    const [menuOpen, setMenuOpen] = useState(false);
    const [isCollapsed, setIsCollapsed] = useState(false);
    const { registerOverflowElement, unregisterOverflowElement } =
      useOverflowContext();
    const handleRef = React.useRef<HTMLDivElement | null>(null);

    React.useEffect(() => {
      const menuId = `text-menu-${path}`;
      if (!menuOpen || !handleRef.current) return;

      let rafId: number | null = null;

      const updatePosition = () => {
        if (!handleRef.current) return;
        const rect = handleRef.current.getBoundingClientRect();
        const gap = 8;
        // Align to handle's top (start), not centered
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
            <TextActionMenu
              value={data || ''}
              onClear={() => {
                // Clear should set value to null (like list component)
                onReplace && onReplace(null);
                setMenuOpen(false);
              }}
              onTransferToList={() => {
                onReplace && onReplace([null, null]);
                setMenuOpen(false);
              }}
              onTransferToDict={() => {
                onReplace && onReplace({ key1: null, key2: null });
                setMenuOpen(false);
              }}
              onPaste={async () => {
                try {
                  const text = await navigator.clipboard.readText();
                  if (text?.startsWith('__RJF__')) {
                    const parsed = JSON.parse(text.slice('__RJF__'.length));
                    if (
                      Array.isArray(parsed) ||
                      (parsed && typeof parsed === 'object')
                    ) {
                      onReplace && onReplace(parsed);
                    } else if (typeof parsed === 'string') {
                      onEdit(path, parsed);
                    }
                  } else {
                    // Try parse as JSON
                    try {
                      const parsed = JSON.parse(text);
                      if (
                        Array.isArray(parsed) ||
                        (parsed && typeof parsed === 'object')
                      ) {
                        onReplace && onReplace(parsed);
                      } else if (typeof parsed === 'string') {
                        onEdit(path, parsed);
                      }
                    } catch {
                      // plain text
                      onEdit(path, text);
                    }
                  }
                } catch {}
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
        // 点击把手或菜单内部不关闭
        if (handleRef.current && handleRef.current.contains(target)) return;
        // 通过类名判断是否点击在菜单内
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
      onEdit,
      path,
      onReplace,
      registerOverflowElement,
      unregisterOverflowElement,
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

    return (
      <div
        className={`bg-[#252525] shadow-sm relative group`}
        style={{
          outline: isSelected ? '2px solid #388EC9' : 'none',
          outlineOffset: '-2px',
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
              isSelected || isHovered || menuOpen ? '#2B6C9B' : '#4A4D54',
          }}
        >
          {(isSelected || isHovered || menuOpen) && (
            <div className='absolute left-1/2 top-2 transform -translate-x-1/2 pointer-events-none'>
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
          {/* menu rendered via portal */}
        </div>
        {isCollapsed ? (
          <div
            className='w-full px-[10px] h-[40px] bg-[#252525] rounded-md overflow-hidden flex items-center'
            title={`text length ${typeof data === 'string' ? data.length : 0}`}
          >
            <div className='flex items-center gap-[8px] text-[#E5E7EB] text-[12px] font-plus-jakarta-sans'>
              <span className='text-[#4AA6EC]'>text</span>
              <span className='text-[#6D7177]'>•</span>
              <span className='text-[#CDCDCD]'>
                {typeof data === 'string' ? data.length : 0} chars
              </span>
            </div>
          </div>
        ) : (
          <div className='w-full px-[10px] py-[8px] bg-[#252525] rounded-md overflow-hidden transition-colors duration-200'>
            <TextEditor
              preventParentDrag={preventParentDrag}
              allowParentDrag={allowParentDrag}
              value={data}
              onChange={handleEditChange}
              placeholder='Enter text content...'
              widthStyle={0}
              autoHeight={true}
            />
          </div>
        )}
        {/* selection outline rendered via CSS outline */}
      </div>
    );
  },
  (prevProps, nextProps) => {
    // 自定义比较函数，只在真正需要的属性发生变化时才重新渲染
    return (
      prevProps.data === nextProps.data &&
      prevProps.path === nextProps.path &&
      prevProps.readonly === nextProps.readonly &&
      prevProps.isRoot === nextProps.isRoot &&
      prevProps.onEdit === nextProps.onEdit &&
      prevProps.preventParentDrag === nextProps.preventParentDrag &&
      prevProps.allowParentDrag === nextProps.allowParentDrag
    );
  }
);

TextComponent.displayName = 'TextComponent';

export default TextComponent;
