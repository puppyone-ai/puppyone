'use client';
import React, { useState, useRef, useEffect } from 'react';
import { useNodesPerFlowContext } from '../../states/NodesPerFlowContext';
import TypeSelector from './TypeSelector';
import TextComponent from './TextComponent';
import DictComponent from './DictComponent';
import ListComponent from './ListComponent';
import { createEmptyElement } from './ComponentRenderer';
import { OverflowProvider } from './OverflowContext';
import ComponentRenderer, {
  HoverProvider,
  SelectionProvider,
  useSelection,
} from './ComponentRenderer';
import ClipboardManager from './ClipboardManager';

// Helper: clear selection when clicking outside the editor container
const ClearSelectionOnOutsideClick = ({
  containerRef,
}: {
  containerRef: React.RefObject<HTMLDivElement>;
}) => {
  const { setSelectedPath } = useSelection();
  useEffect(() => {
    const handleDocumentMouseDown = (e: MouseEvent) => {
      const container = containerRef.current;
      if (!container) return;
      if (!container.contains(e.target as Node)) {
        setSelectedPath(null);
      }
    };
    document.addEventListener('mousedown', handleDocumentMouseDown);
    return () =>
      document.removeEventListener('mousedown', handleDocumentMouseDown);
  }, [setSelectedPath, containerRef]);
  return null;
};

type JSONViewerProps = {
  preventParentDrag: () => void;
  allowParentDrag: () => void;
  placeholder?: string;
  widthStyle?: number;
  heightStyle?: number;
  value?: string;
  readonly?: boolean;
  onChange?: (value: string) => void;
};

type ComponentType = 'text' | 'dict' | 'list';

type JSONData =
  | {
      [key: string]: any;
    }
  | any[]
  | string;

// 辅助函数：清理空元素标识符（用于序列化）
const cleanEmptyElements = (data: any): any => {
  if (data && typeof data === 'object' && data.__isEmpty) {
    return null; // 或者返回适当的默认值
  }
  if (Array.isArray(data)) {
    return data.map(cleanEmptyElements);
  }
  if (typeof data === 'object' && data !== null) {
    const cleaned: any = {};
    for (const [key, value] of Object.entries(data)) {
      cleaned[key] = cleanEmptyElements(value);
    }
    return cleaned;
  }
  return data;
};

const JSONViewer = ({
  preventParentDrag,
  allowParentDrag,
  placeholder = 'Enter JSON data...',
  widthStyle = 0,
  heightStyle = 0,
  value = '',
  readonly = false,
  onChange,
}: JSONViewerProps) => {
  const [parsedData, setParsedData] = useState<JSONData | null>(null);
  const [isValidJSON, setIsValidJSON] = useState(false);
  const [showTypeSelector, setShowTypeSelector] = useState(false);
  const [movedPaths, setMovedPaths] = useState<Set<string>>(new Set()); // 记录已移动的路径
  const containerRef = useRef<HTMLDivElement>(null);
  const { isOnGeneratingNewNode } = useNodesPerFlowContext();

  // Ensure inner scroll doesn't bubble to ReactFlow (native capture)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const stopWheel = (e: WheelEvent) => {
      e.stopPropagation();
    };
    const stopTouchMove = (e: TouchEvent) => {
      e.stopPropagation();
    };
    el.addEventListener('wheel', stopWheel, { capture: true });
    el.addEventListener('touchmove', stopTouchMove as any, { capture: true });
    return () => {
      el.removeEventListener('wheel', stopWheel, { capture: true } as any);
      el.removeEventListener('touchmove', stopTouchMove as any, {
        capture: true,
      } as any);
    };
  }, []);

  // 解析JSON数据
  useEffect(() => {
    if (!value || value.trim() === '') {
      // Default empty input to null
      setParsedData(null);
      setIsValidJSON(true);
      if (onChange && value?.trim() !== 'null') {
        onChange('null');
      }
      return;
    }

    try {
      const parsed = JSON.parse(value);
      setParsedData(parsed);
      setIsValidJSON(true);
    } catch (error) {
      setParsedData(null);
      setIsValidJSON(false);
    }
  }, [value, onChange]);

  // 判断组件类型
  const getComponentType = (data: JSONData | null): ComponentType => {
    if (typeof data === 'string') return 'text';
    if (Array.isArray(data)) return 'list';
    if (typeof data === 'object' && data !== null) return 'dict';
    return 'text';
  };

  // 创建新的组件
  const createNewComponent = (type: ComponentType) => {
    let newData: any;
    switch (type) {
      case 'text':
        newData = '';
        break;
      case 'dict':
        newData = { key1: null, key2: null }; // 预制两个空位
        break;
      case 'list':
        newData = [null, null]; // 预制两个空位
        break;
    }

    if (onChange) {
      onChange(JSON.stringify(newData, null, 2));
    }
    setShowTypeSelector(false);
  };

  // 执行移动操作：从源路径移动到目标路径
  const performMove = (
    sourcePath: string,
    targetPath: string,
    targetIndex?: number
  ) => {
    if (!parsedData) return;

    // 获取源元素的值
    const getValueAtPath = (data: any, path: string): any => {
      if (!path) return data;

      const pathParts = path.match(/(\[(\d+)\])|([^.\[\]]+)/g) || [];
      let current = data;

      for (const part of pathParts) {
        if (part.startsWith('[') && part.endsWith(']')) {
          const index = parseInt(part.slice(1, -1));
          current = current?.[index];
        } else {
          current = current?.[part];
        }
      }

      return current;
    };

    const sourceValue = getValueAtPath(parsedData, sourcePath);
    if (sourceValue === undefined) return;

    // 先删除源位置的数据
    let newData = deleteAtPath(parsedData, sourcePath);

    // 再在目标位置插入数据
    if (targetIndex !== undefined) {
      newData = insertAtPath(newData, targetPath, sourceValue, targetIndex);
    }

    // 更新整个数据
    updateData(newData);
  };

  // 删除指定路径的数据
  const deleteAtPath = (data: any, path: string): any => {
    if (!path) return data;

    // 解析路径
    const pathParts = path.match(/(\[(\d+)\])|([^.\[\]]+)/g) || [];

    if (pathParts.length === 0) return data;

    // 递归删除
    const deleteRecursive = (
      current: any,
      parts: string[],
      index: number
    ): any => {
      if (!current) return current;

      const part = parts[index];
      const isLast = index === parts.length - 1;

      // 处理数组索引
      if (part.startsWith('[') && part.endsWith(']')) {
        const arrayIndex = parseInt(part.slice(1, -1));
        const newArray = [...current];

        if (isLast) {
          // 删除数组元素
          newArray.splice(arrayIndex, 1);
        } else {
          newArray[arrayIndex] = deleteRecursive(
            newArray[arrayIndex],
            parts,
            index + 1
          );
        }

        return newArray;
      }

      // 处理对象属性
      const newObj = { ...current };

      if (isLast) {
        // 删除对象属性
        delete newObj[part];
      } else {
        newObj[part] = deleteRecursive(newObj[part], parts, index + 1);
      }

      return newObj;
    };

    return deleteRecursive(data, pathParts, 0);
  };

  // 在指定路径插入数据
  const insertAtPath = (
    data: any,
    path: string,
    value: any,
    index?: number
  ): any => {
    if (!path) return data;

    // 解析路径
    const pathParts = path.match(/(\[(\d+)\])|([^.\[\]]+)/g) || [];

    if (pathParts.length === 0) return data;

    // 递归插入
    const insertRecursive = (
      current: any,
      parts: string[],
      partIndex: number
    ): any => {
      const part = parts[partIndex];
      const isLast = partIndex === parts.length - 1;

      // 处理数组索引
      if (part.startsWith('[') && part.endsWith(']')) {
        const arrayIndex = parseInt(part.slice(1, -1));
        const newArray = [...(current || [])];

        if (isLast && index !== undefined) {
          // 在数组中插入
          newArray.splice(index, 0, value);
        } else if (!isLast) {
          newArray[arrayIndex] = insertRecursive(
            newArray[arrayIndex],
            parts,
            partIndex + 1
          );
        }

        return newArray;
      }

      // 处理对象属性
      const newObj = { ...(current || {}) };

      if (!isLast) {
        newObj[part] = insertRecursive(newObj[part], parts, partIndex + 1);
      }

      return newObj;
    };

    return insertRecursive(data, pathParts, 0);
  };

  // 更新数据
  const updateData = (newData: any) => {
    if (onChange) {
      // 清理空元素标识符后再序列化
      const cleanedData = cleanEmptyElements(newData);
      onChange(JSON.stringify(cleanedData, null, 2));
    }
  };

  // 处理文本编辑
  const handleTextEdit = (path: string, newValue: string) => {
    updateData(newValue);
  };

  // 渲染主要内容
  const renderMainContent = () => {
    if (parsedData === null) {
      // Render through ComponentRenderer so null shows EmptyComponent with handle
      return (
        <ComponentRenderer
          data={null}
          path=''
          readonly={readonly}
          onUpdate={updateData}
          preventParentDrag={preventParentDrag}
          allowParentDrag={allowParentDrag}
        />
      );
    }

    const componentType = getComponentType(parsedData);

    switch (componentType) {
      case 'text':
        return (
          <TextComponent
            data={parsedData as string}
            path=''
            readonly={readonly}
            onEdit={handleTextEdit}
            onReplace={updateData}
            preventParentDrag={preventParentDrag}
            allowParentDrag={allowParentDrag}
          />
        );
      case 'dict':
        return (
          <DictComponent
            data={parsedData as Record<string, any>}
            path=''
            readonly={readonly}
            isNested={false}
            onUpdate={updateData}
            onReplace={updateData}
            preventParentDrag={preventParentDrag}
            allowParentDrag={allowParentDrag}
          />
        );
      case 'list':
        return (
          <ListComponent
            data={parsedData as any[]}
            path=''
            readonly={readonly}
            isNested={false}
            onUpdate={updateData}
            onReplace={updateData}
            preventParentDrag={preventParentDrag}
            allowParentDrag={allowParentDrag}
          />
        );
      default:
        return null;
    }
  };

  // 计算实际的宽高样式
  const actualWidth = widthStyle === 0 ? '100%' : widthStyle;
  const actualHeight = heightStyle === 0 ? '100%' : heightStyle;

  // 如果没有数据，默认设为 null（上面的 effect 会触发写回）
  if (!value || value.trim() === '') {
    return null;
  }

  if (!isValidJSON) {
    return (
      <div
        className={`relative flex flex-col border border-[#EF4444] rounded-xl bg-transparent p-4 ${isOnGeneratingNewNode ? 'pointer-events-none opacity-70' : ''}`}
        style={{ width: actualWidth, height: actualHeight }}
      >
        <div className='flex items-center mb-2'>
          <svg
            className='w-4 h-4 text-[#EF4444] mr-2'
            fill='currentColor'
            viewBox='0 0 20 20'
          >
            <path
              fillRule='evenodd'
              d='M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z'
              clipRule='evenodd'
            />
          </svg>
          <span className='text-[#EF4444] text-sm font-semibold'>
            Invalid JSON
          </span>
        </div>
        <div className='text-[#6B7280] text-sm font-mono overflow-auto'>
          {value}
        </div>
      </div>
    );
  }

  return (
    <HoverProvider>
      <SelectionProvider>
        <OverflowProvider>
          <ClearSelectionOnOutsideClick containerRef={containerRef} />
          <ClipboardManager
            containerRef={containerRef as React.RefObject<HTMLElement>}
            getRootData={() => parsedData}
            setRootData={newData => updateData(newData)}
            readonly={readonly}
          />
          <div
            ref={containerRef}
            className={`relative bg-[#252525] overflow-auto overscroll-contain scrollbar-hide pt-[4px] pl-[8px] pr-[4px] ${isOnGeneratingNewNode ? 'pointer-events-none opacity-70' : ''}`}
            style={{ width: actualWidth, height: actualHeight }}
            data-rich-json-form='true'
            onWheel={e => {
              e.stopPropagation();
            }}
            onWheelCapture={e => {
              e.stopPropagation();
            }}
            onTouchMove={e => {
              e.stopPropagation();
            }}
            onTouchMoveCapture={e => {
              e.stopPropagation();
            }}
          >
            <div className='border-t border-b border-r border-[#4A4D54]'>
              {renderMainContent()}
            </div>
          </div>
        </OverflowProvider>
      </SelectionProvider>
    </HoverProvider>
  );
};

export default JSONViewer;
