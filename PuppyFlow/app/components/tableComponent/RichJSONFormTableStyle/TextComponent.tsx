'use client';
import React, { useCallback, useMemo, useState } from 'react';
import TextEditor from '../TextEditor';
import { DragHandle, useSelection } from './ComponentRenderer';

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
    const [isStripeHovered, setIsStripeHovered] = useState(false);
    const isSelected = isPathSelected(path);

    return (
      <div className={`bg-[#252525] shadow-sm relative group p-[2px]`}
           style={{ outline: 'none', boxShadow: isSelected ? 'inset 0 0 0 2px #388EC9' : 'none' }}
           onClick={(e) => { e.stopPropagation(); setSelectedPath(path); }}
      >
        <DragHandle
          data={data}
          path={path}
          parentKey={parentKey}
          componentType="text"
          readonly={readonly}
          onDelete={onDelete}
          preventParentDrag={preventParentDrag}
          allowParentDrag={allowParentDrag}
          color="#388EC9"
          forceVisible={isSelected || isStripeHovered}
        />
        <div 
          className="absolute left-0 top-1 bottom-1 w-px bg-[#2B6C9B] rounded-full z-20"
          onMouseEnter={() => setIsStripeHovered(true)}
          onMouseLeave={() => setIsStripeHovered(false)}
        ></div>
        <div className='w-full px-[16px] py-[8px] bg-transparent rounded-md overflow-hidden transition-colors duration-200'>
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
