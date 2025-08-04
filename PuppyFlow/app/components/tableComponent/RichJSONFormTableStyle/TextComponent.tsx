'use client';
import React, { useCallback, useMemo } from 'react';
import TextEditor from '../TextEditor';

type TextComponentProps = {
  data: string;
  path: string;
  readonly?: boolean;
  isRoot?: boolean;
  onEdit: (path: string, value: string) => void;
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

    return (
      <div className='w-full'>
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
