'use client';
import React, { useCallback, useState } from 'react';
import TextEditor from '../TextEditor';
import TextActionMenu from './TextActionMenu';
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
    const accentColor = isSelected ? '#49A1DA' : '#388EC9';
    const [menuOpen, setMenuOpen] = useState(false);

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
          {(isSelected || isHovered) && (
            <div className="absolute left-1/2 top-1/2 transform -translate-x-1/2 -translate-y-1/2 pointer-events-none">
              <div
                className="w-4 h-6 bg-[#252525] border rounded-[3px] flex flex-col items-center justify-center gap-0.5 shadow-lg cursor-pointer pointer-events-auto"
                style={{ borderColor: `${accentColor}50` }}
                aria-hidden
                onClick={(e) => { e.stopPropagation(); setMenuOpen(v => !v); }}
              >
                <div className="w-0.5 h-0.5 rounded-full" style={{ backgroundColor: accentColor }}></div>
                <div className="w-0.5 h-0.5 rounded-full" style={{ backgroundColor: accentColor }}></div>
                <div className="w-0.5 h-0.5 rounded-full" style={{ backgroundColor: accentColor }}></div>
              </div>
            </div>
          )}
        </div>
        {menuOpen && !readonly && (
          <TextActionMenu
            className="absolute left-2 top-2 z-50"
            value={data || ''}
            onClear={() => { onEdit(path, ''); setMenuOpen(false); }}
            onTransferToList={() => { onReplace && onReplace([null, null]); setMenuOpen(false); }}
            onTransferToDict={() => { onReplace && onReplace({ key1: null, key2: null }); setMenuOpen(false); }}
          />
        )}
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
