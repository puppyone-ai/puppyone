'use client'
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useNodesPerFlowContext } from '../states/NodesPerFlowContext';

type JSONValue = string | number | boolean | null | JSONObject | JSONArray;
type JSONObject = { [key: string]: JSONValue };
type JSONArray = JSONValue[];

type TreeJSONFormProps = {
  preventParentDrag: () => void;
  allowParentDrag: () => void;
  placeholder?: string;
  widthStyle?: number;
  heightStyle?: number;
  value?: string;
  readonly?: boolean;
  onChange?: (value: string) => void;
};

type TreeNodeProps = {
  path: string[];
  data: JSONValue;
  isLast: boolean;
  level: number;
  onUpdate: (path: string[], newValue: JSONValue) => void;
  onDelete: (path: string[]) => void;
  onAddSibling: (path: string[], type: 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null') => void;
  readonly: boolean;
  isRoot?: boolean;
  parentType?: 'object' | 'array';
};

const TreeNode: React.FC<TreeNodeProps> = ({
  path,
  data,
  isLast,
  level,
  onUpdate,
  onDelete,
  onAddSibling,
  readonly,
  isRoot = false,
  parentType
}) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const isObject = typeof data === 'object' && data !== null && !Array.isArray(data);
  const isArray = Array.isArray(data);
  const isPrimitive = !isObject && !isArray;
  const hasChildren = (isObject && Object.keys(data as JSONObject).length > 0) || 
                     (isArray && (data as JSONArray).length > 0);

  const getTypeColor = (value: JSONValue): string => {
    if (value === null) return 'text-[#FF6B6B]';
    if (typeof value === 'string') return 'text-[#4ECDC4]';
    if (typeof value === 'number') return 'text-[#45B7D1]';
    if (typeof value === 'boolean') return 'text-[#96CEB4]';
    return 'text-[#FECA57]';
  };

  const getKeyColor = (): string => {
    if (parentType === 'object') {
      return 'text-[#B794F6]';
    } else if (parentType === 'array') {
      return 'text-[#F6AD55]';
    }
    return 'text-[#E8E9EA]';
  };

  const getKeyBackgroundStyle = (): string => {
    if (parentType === 'object') {
      return 'bg-[#B794F6]/20 border border-[#B794F6]/30';
    } else if (parentType === 'array') {
      return 'bg-[#F6AD55]/20 border border-[#F6AD55]/30';
    }
    return 'bg-[#E8E9EA]/10 border border-[#E8E9EA]/20';
  };

  const getValueDisplay = (value: JSONValue): string => {
    if (value === null) return 'null';
    if (typeof value === 'string') return `"${value}"`;
    return String(value);
  };

  const startEditing = () => {
    if (readonly) return;
    setIsEditing(true);
    setEditValue(isPrimitive ? String(data) : '');
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleEditSubmit = () => {
    if (!isEditing) return;
    
    let newValue: JSONValue;
    try {
      if (editValue === 'null') newValue = null;
      else if (editValue === 'true') newValue = true;
      else if (editValue === 'false') newValue = false;
      else if (!isNaN(Number(editValue)) && editValue.trim() !== '') newValue = Number(editValue);
      else newValue = editValue;
    } catch {
      newValue = editValue;
    }

    onUpdate(path, newValue);
    setIsEditing(false);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleEditSubmit();
    } else if (e.key === 'Escape') {
      setIsEditing(false);
    }
  };

  const addChild = (type: 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null') => {
    if (readonly) return;
    
    let newChild: JSONValue;
    switch (type) {
      case 'object': newChild = {}; break;
      case 'array': newChild = []; break;
      case 'string': newChild = ''; break;
      case 'number': newChild = 0; break;
      case 'boolean': newChild = false; break;
      case 'null': newChild = null; break;
    }

    if (isObject) {
      const newKey = `key_${Date.now()}`;
      onUpdate(path, { ...(data as JSONObject), [newKey]: newChild });
    } else if (isArray) {
      onUpdate(path, [...(data as JSONArray), newChild]);
    }
    setShowAddMenu(false);
  };

  const renderTreeLines = (): JSX.Element[] => {
    const lines: JSX.Element[] = [];
    for (let i = 0; i < level; i++) {
      lines.push(
        <div
          key={i}
          className="absolute top-0 bottom-0 w-[1px] bg-gradient-to-b from-[#3A3B3F] to-[#2A2B2F]"
          style={{ left: `${20 + i * 24}px` }}
        />
      );
    }
    return lines;
  };

  const renderExpandButton = () => {
    if (!hasChildren) return <div className="w-4 h-4" />;
    
    return (
      <button
        className="w-4 h-4 flex items-center justify-center rounded-sm hover:bg-[#2A2B2F] transition-colors group"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <svg
          className={`w-3 h-3 text-[#6D7177] group-hover:text-[#9CA3AF] transition-all duration-200 ${
            isExpanded ? 'rotate-90' : 'rotate-0'
          }`}
          fill="currentColor"
          viewBox="0 0 20 20"
        >
          <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
        </svg>
      </button>
    );
  };

  const renderKey = () => {
    const key = path[path.length - 1];
    if (isRoot || !key) return null;

    return (
      <span className={`${getKeyColor()} ${getKeyBackgroundStyle()} font-medium mr-2 select-none px-1.5 py-0.5 rounded text-xs`}>
        {key}:
      </span>
    );
  };

  const renderValue = () => {
    if (isObject) {
      if (hasChildren) {
        return (
          <button
            className={`text-[#B794F6] select-none font-medium hover:bg-[#B794F6]/10  rounded transition-all duration-200 cursor-pointer flex items-center gap-1 group`}
            onClick={() => setIsExpanded(!isExpanded)}
          >
            <div className="relative w-3 h-3 flex items-center justify-center">
              <span className="group-hover:opacity-0 transition-opacity duration-200">
                {isExpanded ? '{' : '{'}
              </span>
              <svg
                className={`absolute inset-0 opacity-0 group-hover:opacity-100 w-3 h-3 transition-all duration-200 ${
                  isExpanded ? 'rotate-90' : 'rotate-0'
                }`}
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
              </svg>
            </div>
            <span>{isExpanded ? '' : ` ${Object.keys(data as JSONObject).length} items `}</span>
            <span>{isExpanded ? '' : '}'}</span>
          </button>
        );
      } else {
        return (
          <span className="text-[#B794F6] select-none font-medium">
            {'{'}
          </span>
        );
      }
    }
    
    if (isArray) {
      if (hasChildren) {
        return (
          <button
            className={`text-[#F6AD55] select-none font-medium hover:bg-[#F6AD55]/10 rounded transition-all duration-200 cursor-pointer flex items-center gap-1 group`}
            onClick={() => setIsExpanded(!isExpanded)}
          >
            <div className="relative w-3 h-3 flex items-center justify-center">
              <span className="group-hover:opacity-0 transition-opacity duration-200">
                {isExpanded ? '[' : '['}
              </span>
              <svg
                className={`absolute inset-0 opacity-0 group-hover:opacity-100 w-3 h-3 transition-all duration-200 ${
                  isExpanded ? 'rotate-90' : 'rotate-0'
                }`}
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
              </svg>
            </div>
            <span>{isExpanded ? '' : ` ${(data as JSONArray).length} items `}</span>
            <span>{isExpanded ? '' : ']'}</span>
          </button>
        );
      } else {
        return (
          <span className="text-[#F6AD55] select-none font-medium">
            {'['}
          </span>
        );
      }
    }

    if (isEditing) {
      return (
        <input
          ref={inputRef}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={handleEditSubmit}
          onKeyDown={handleKeyPress}
          className="bg-[#2A2B2F] text-[#E8E9EA] px-2 py-1 rounded border border-[#3A3B3F] focus:border-[#4ECDC4] focus:outline-none font-jetbrains-mono text-sm"
        />
      );
    }

    return (
      <span
        className={`${getTypeColor(data)} cursor-pointer hover:bg-[#2A2B2F]  rounded transition-colors font-jetbrains-mono text-sm`}
        onClick={startEditing}
      >
        {getValueDisplay(data)}
      </span>
    );
  };

  const renderActions = () => {
    if (readonly || !isHovered) return null;

    return (
      <div className="flex items-center gap-1 ml-2">
        {(isObject || isArray) && (
          <div className="relative">
            <button
              className="w-4 h-4 flex items-center justify-center rounded hover:bg-[#2A2B2F] transition-colors group"
              onClick={() => setShowAddMenu(!showAddMenu)}
            >
              <svg className="w-3 h-3 text-[#6D7177] group-hover:text-[#9CA3AF]" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
              </svg>
            </button>
            
            {showAddMenu && (
              <div className="absolute top-full left-0 mt-1 bg-[#2A2B2F] border border-[#3A3B3F] rounded-lg shadow-lg z-10 min-w-[120px]">
                {(['string', 'number', 'boolean', 'null', 'object', 'array'] as const).map((type) => (
                  <button
                    key={type}
                    className="w-full text-left px-3 py-2 text-sm text-[#E8E9EA] hover:bg-[#3A3B3F] first:rounded-t-lg last:rounded-b-lg transition-colors"
                    onClick={() => addChild(type)}
                  >
                    {type}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        
        {!isRoot && (
          <button
            className="w-4 h-4 flex items-center justify-center rounded hover:bg-[#2A2B2F] transition-colors group"
            onClick={() => onDelete(path)}
          >
            <svg className="w-3 h-3 text-[#6D7177] group-hover:text-[#FF6B6B]" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        )}
      </div>
    );
  };

  const renderChildren = () => {
    if (!isExpanded || !hasChildren) return null;

    const children: JSX.Element[] = [];
    
    if (isObject) {
      const entries = Object.entries(data as JSONObject);
      entries.forEach(([key, value], index) => {
        children.push(
          <TreeNode
            key={key}
            path={[...path, key]}
            data={value}
            isLast={index === entries.length - 1}
            level={level + 1}
            onUpdate={onUpdate}
            onDelete={onDelete}
            onAddSibling={onAddSibling}
            readonly={readonly}
            parentType="object"
          />
        );
      });
    } else if (isArray) {
      (data as JSONArray).forEach((value, index) => {
        children.push(
          <TreeNode
            key={index}
            path={[...path, String(index)]}
            data={value}
            isLast={index === (data as JSONArray).length - 1}
            level={level + 1}
            onUpdate={onUpdate}
            onDelete={onDelete}
            onAddSibling={onAddSibling}
            readonly={readonly}
            parentType="array"
          />
        );
      });
    }

    return (
      <div className="relative">
        {children}
        {isExpanded && (isObject || isArray) && (
          <div
            className={`flex items-center py-1 select-none font-medium ${isObject ? 'text-[#B794F6]' : 'text-[#F6AD55]'}`}
            style={{ paddingLeft: `${20 + level * 24}px` }}
          >
            {isObject ? '}' : ']'}
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      className="relative"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {renderTreeLines()}
      
      <div
        className="flex items-center py-1 hover:bg-[#2A2B2F] rounded transition-colors group"
        style={{ paddingLeft: `${20 + level * 24}px` }}
      >
        <div className="flex items-center flex-1">
          {renderKey()}
          {renderValue()}
          {renderActions()}
        </div>
      </div>
      
      {renderChildren()}
    </div>
  );
};

const TreeJSONForm: React.FC<TreeJSONFormProps> = ({
  preventParentDrag,
  allowParentDrag,
  placeholder = "Start typing to create JSON...",
  widthStyle = 0,
  heightStyle = 0,
  value = "",
  readonly = false,
  onChange
}) => {
  const [jsonData, setJsonData] = useState<JSONValue>({});
  const [isEmpty, setIsEmpty] = useState(true);
  const [parseError, setParseError] = useState<string | null>(null);
  const { isOnGeneratingNewNode } = useNodesPerFlowContext();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!value || value.trim() === '') {
      setJsonData({});
      setIsEmpty(true);
      setParseError(null);
      return;
    }

    try {
      const parsed = JSON.parse(value);
      setJsonData(parsed);
      setIsEmpty(false);
      setParseError(null);
    } catch (error) {
      setParseError(error instanceof Error ? error.message : 'Invalid JSON');
      setIsEmpty(false);
    }
  }, [value]);

  const updateJsonData = useCallback((path: string[], newValue: JSONValue) => {
    setJsonData(prevData => {
      const newData = JSON.parse(JSON.stringify(prevData));
      
      if (path.length === 0) {
        return newValue;
      }
      
      let current: any = newData;
      for (let i = 0; i < path.length - 1; i++) {
        current = current[path[i]];
      }
      
      current[path[path.length - 1]] = newValue;
      
      const jsonString = JSON.stringify(newData, null, 2);
      onChange?.(jsonString);
      
      return newData;
    });
  }, [onChange]);

  const deleteNode = useCallback((path: string[]) => {
    setJsonData(prevData => {
      const newData = JSON.parse(JSON.stringify(prevData));
      
      if (path.length === 1) {
        if (Array.isArray(newData)) {
          newData.splice(parseInt(path[0]), 1);
        } else {
          delete newData[path[0]];
        }
      } else {
        let current: any = newData;
        for (let i = 0; i < path.length - 1; i++) {
          current = current[path[i]];
        }
        
        if (Array.isArray(current)) {
          current.splice(parseInt(path[path.length - 1]), 1);
        } else {
          delete current[path[path.length - 1]];
        }
      }
      
      const jsonString = JSON.stringify(newData, null, 2);
      onChange?.(jsonString);
      
      return newData;
    });
  }, [onChange]);

  const addSibling = useCallback((path: string[], type: 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null') => {
    // This function can be extended if needed for adding siblings
  }, []);

  const handleContainerFocus = () => {
    preventParentDrag();
  };

  const handleContainerBlur = () => {
    allowParentDrag();
  };

  const actualWidth = widthStyle === 0 ? "100%" : widthStyle;
  const actualHeight = heightStyle === 0 ? "100%" : heightStyle;

  const createEmptyStructure = (type: 'object' | 'array') => {
    const newData = type === 'object' ? {} : [];
    setJsonData(newData);
    setIsEmpty(false);
    const jsonString = JSON.stringify(newData, null, 2);
    onChange?.(jsonString);
  };

  return (
    <div
      ref={containerRef}
      className={`relative flex flex-col border-none rounded-[8px] bg-[#1C1D1F] overflow-hidden ${
        isOnGeneratingNewNode ? 'pointer-events-none' : ''
      }`}
      style={{
        width: actualWidth,
        height: actualHeight,
        opacity: isOnGeneratingNewNode ? '0.7' : '1'
      }}
      onFocus={handleContainerFocus}
      onBlur={handleContainerBlur}
      tabIndex={0}
    >
      {isEmpty && !parseError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-[#6D7177] space-y-4">
          <div className="text-sm font-medium">{placeholder}</div>
          <div className="flex gap-3">
            <button
              className="px-4 py-2 bg-[#2A2B2F] hover:bg-[#3A3B3F] text-[#E8E9EA] rounded-lg transition-colors text-sm font-medium"
              onClick={() => createEmptyStructure('object')}
              disabled={readonly}
            >
              Create Object
            </button>
            <button
              className="px-4 py-2 bg-[#2A2B2F] hover:bg-[#3A3B3F] text-[#E8E9EA] rounded-lg transition-colors text-sm font-medium"
              onClick={() => createEmptyStructure('array')}
              disabled={readonly}
            >
              Create Array
            </button>
          </div>
        </div>
      )}

      {parseError && (
        <div className="p-4 text-[#FF6B6B] text-sm font-jetbrains-mono">
          Parse Error: {parseError}
        </div>
      )}

      {!isEmpty && !parseError && (
        <div className="flex-1 overflow-auto p-4 font-jetbrains-mono text-sm">
          <TreeNode
            path={[]}
            data={jsonData}
            isLast={true}
            level={0}
            onUpdate={updateJsonData}
            onDelete={deleteNode}
            onAddSibling={addSibling}
            readonly={readonly || isOnGeneratingNewNode}
            isRoot={true}
          />
        </div>
      )}
    </div>
  );
};

export default TreeJSONForm; 