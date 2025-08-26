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
    const { registerOverflowElement, unregisterOverflowElement } = useOverflowContext();
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
          (
            <div style={{ position: 'fixed', top, left, transform: 'translateX(-100%)' }}>
              <TextActionMenu
                value={data || ''}
                onClear={() => { onEdit(path, ''); setMenuOpen(false); }}
                onTransferToList={() => { onReplace && onReplace([null, null]); setMenuOpen(false); }}
                onTransferToDict={() => { onReplace && onReplace({ key1: null, key2: null }); setMenuOpen(false); }}
              />
            </div>
          ),
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
    }, [menuOpen, data, onEdit, path, onReplace, registerOverflowElement, unregisterOverflowElement]);

  // Ensure only one menu is open globally
  React.useEffect(() => {
    const onCloseAll = () => setMenuOpen(false);
    window.addEventListener('rjft:close-all-menus', onCloseAll as EventListener);
    return () => window.removeEventListener('rjft:close-all-menus', onCloseAll as EventListener);
  }, []);

    return (
      <div className={`bg-[#252525] shadow-sm relative group p-[2px]`}
           style={{ outline: 'none', boxShadow: isSelected ? 'inset 0 0 0 2px #388EC9' : 'none' }}
           onClick={(e) => { e.stopPropagation(); setSelectedPath(path); }}
           onMouseEnter={() => setIsHovered(true)}
           onMouseLeave={() => setIsHovered(false)}
      >
        <div 
          className="absolute left-0 top-1 bottom-1 w-px bg-[#2B6C9B] rounded-full z-20"
        >
          {(isSelected || isHovered || menuOpen) && (
            <div className="absolute left-1/2 top-1/2 transform -translate-x-1/2 -translate-y-1/2 pointer-events-none">
              <div

                className="w-4 h-6 bg-[#252525] border-2 rounded-[3px] flex flex-col items-center justify-center gap-0.5 shadow-lg cursor-pointer pointer-events-auto"
                style={{ borderColor: accentColor }}
                aria-hidden
                onClick={(e) => {
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
                <div className="w-0.5 h-0.5 rounded-full" style={{ backgroundColor: accentColor }}></div>
                <div className="w-0.5 h-0.5 rounded-full" style={{ backgroundColor: accentColor }}></div>
                <div className="w-0.5 h-0.5 rounded-full" style={{ backgroundColor: accentColor }}></div>
              </div>
            </div>
          )}
          {/* menu rendered via portal */}
        </div>
        <div className='w-full px-[16px] py-[6px] bg-transparent rounded-md overflow-hidden transition-colors duration-200'>
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
