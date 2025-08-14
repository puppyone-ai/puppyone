'use client'
import React, { useState, useRef } from 'react';

interface JsonTreeEditorProps {
  value?: string;
  onChange?: (value: string) => void;
  readonly?: boolean;
  placeholder?: string;
}

interface TreeNodeProps {
  data: any;
  path: string;
  onUpdate: (path: string, value: any) => void;
  onDelete?: (path: string) => void;
  level: number;
}

const TreeNode: React.FC<TreeNodeProps> = ({ data, path, onUpdate, onDelete, level }) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const isObject = typeof data === 'object' && data !== null && !Array.isArray(data);
  const isArray = Array.isArray(data);
  const isPrimitive = !isObject && !isArray;

  const getValueType = (val: any) => {
    if (val === null) return 'null';
    if (typeof val === 'boolean') return 'boolean';
    if (typeof val === 'number') return 'number';
    if (typeof val === 'string') return 'string';
    return 'unknown';
  };

  const formatValue = (val: any) => {
    if (val === null) return 'null';
    if (typeof val === 'boolean') return val.toString();
    if (typeof val === 'number') return val.toString();
    if (typeof val === 'string') return `"${val}"`;
    return String(val);
  };

  const parseEditValue = (value: string) => {
    if (value === 'null') return null;
    if (value === 'true') return true;
    if (value === 'false') return false;
    if (!isNaN(Number(value)) && value.trim() !== '') return Number(value);
    return value.replace(/^"(.*)"$/, '$1'); // Remove quotes if present
  };

  const handleEdit = () => {
    setEditValue(formatValue(data));
    setIsEditing(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleSave = () => {
    const newValue = parseEditValue(editValue);
    onUpdate(path, newValue);
    setIsEditing(false);
  };

  const handleCancel = () => {
    setIsEditing(false);
    setEditValue('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSave();
    } else if (e.key === 'Escape') {
      handleCancel();
    }
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'string': return 'text-green-400';
      case 'number': return 'text-blue-400';
      case 'boolean': return 'text-purple-400';
      case 'null': return 'text-gray-500';
      default: return 'text-gray-300';
    }
  };

  const indent = level * 20;

  if (isPrimitive) {
    return (
      <div 
        className="flex items-center group hover:bg-gray-800 px-2 py-1 rounded"
        style={{ marginLeft: `${indent}px` }}
      >
        <div className="flex items-center space-x-2 flex-1">
          {isEditing ? (
            <input
              ref={inputRef}
              type="text"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={handleSave}
              onKeyDown={handleKeyDown}
              className="bg-gray-700 text-white px-2 py-1 rounded text-sm flex-1 border border-gray-600 focus:border-blue-500 outline-none"
            />
          ) : (
            <span 
              className={`text-sm cursor-pointer ${getTypeColor(getValueType(data))}`}
              onClick={handleEdit}
              title="Click to edit"
            >
              {formatValue(data)}
            </span>
          )}
        </div>
        {onDelete && (
          <button
            onClick={() => onDelete(path)}
            className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-300 p-1"
            title="Delete"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
    );
  }

  const keys = isObject ? Object.keys(data) : null;
  const length = isArray ? data.length : keys?.length || 0;
  const hasChildren = length > 0;

  return (
    <div>
      <div 
        className="flex items-center group hover:bg-gray-800 px-2 py-1 rounded cursor-pointer"
        style={{ marginLeft: `${indent}px` }}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center space-x-2">
          <svg 
            className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
            fill="none" 
            stroke="currentColor" 
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          
          <span className="text-gray-300 text-sm font-medium">
            {isArray ? (
              <span className="text-yellow-400">Array</span>
            ) : (
              <span className="text-blue-400">Object</span>
            )}
            <span className="text-gray-500 ml-1">({length} {length === 1 ? 'item' : 'items'})</span>
          </span>
        </div>
        
        {onDelete && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(path);
            }}
            className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-300 p-1 ml-auto"
            title="Delete"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
      
      {isExpanded && hasChildren && (
        <div className="ml-2">
          {isArray 
            ? data.map((item: any, index: number) => (
                <div key={index} className="flex items-start">
                  <div 
                    className="text-xs text-gray-500 font-mono py-1 px-2 min-w-[40px]"
                    style={{ marginLeft: `${(level + 1) * 20}px` }}
                  >
                    [{index}]
                  </div>
                  <div className="flex-1">
                    <TreeNode
                      data={item}
                      path={`${path}[${index}]`}
                      onUpdate={onUpdate}
                      onDelete={(deletePath) => {
                        const newArray = [...data];
                        newArray.splice(index, 1);
                        onUpdate(path, newArray);
                      }}
                      level={level + 1}
                    />
                  </div>
                </div>
              ))
            : keys?.map((key: string) => (
                <div key={key} className="flex items-start">
                  <div 
                    className="text-xs text-gray-400 font-mono py-1 px-2 min-w-[80px] truncate"
                    style={{ marginLeft: `${(level + 1) * 20}px` }}
                    title={key}
                  >
                    {key}:
                  </div>
                  <div className="flex-1">
                    <TreeNode
                      data={data[key]}
                      path={path ? `${path}.${key}` : key}
                      onUpdate={onUpdate}
                      onDelete={(deletePath) => {
                        const newObj = { ...data };
                        delete newObj[key];
                        onUpdate(path, newObj);
                      }}
                      level={level + 1}
                    />
                  </div>
                </div>
              ))
          }
        </div>
      )}
    </div>
  );
};

const JsonTreeEditor: React.FC<JsonTreeEditorProps> = ({ 
  value = '', 
  onChange, 
  readonly = false, 
  placeholder = "Enter JSON..." 
}) => {
  const [jsonData, setJsonData] = useState<any>(null);
  const [isValid, setIsValid] = useState(false);
  const [error, setError] = useState<string>('');

  React.useEffect(() => {
    if (!value || value.trim() === '') {
      setJsonData(null);
      setIsValid(false);
      setError('');
      return;
    }

    try {
      const parsed = JSON.parse(value);
      setJsonData(parsed);
      setIsValid(true);
      setError('');
    } catch (err) {
      setJsonData(null);
      setIsValid(false);
      setError(err instanceof Error ? err.message : 'Invalid JSON');
    }
  }, [value]);

  const updateValue = (path: string, newValue: any) => {
    if (readonly || !onChange) return;

    try {
      let updatedData = { ...jsonData };
      
      if (!path) {
        // Root update
        updatedData = newValue;
      } else {
        // Nested update
        const pathParts = path.split(/[.\[\]]/).filter(Boolean);
        let current = updatedData;
        
        for (let i = 0; i < pathParts.length - 1; i++) {
          const part = pathParts[i];
          if (Array.isArray(current)) {
            current = current[parseInt(part)];
          } else {
            current = current[part];
          }
        }
        
        const lastPart = pathParts[pathParts.length - 1];
        if (Array.isArray(current)) {
          current[parseInt(lastPart)] = newValue;
        } else {
          current[lastPart] = newValue;
        }
      }
      
      onChange(JSON.stringify(updatedData, null, 2));
    } catch (err) {
      console.error('Failed to update JSON:', err);
    }
  };

  const createNewJson = (type: 'object' | 'array') => {
    const newData = type === 'object' ? {} : [];
    onChange?.(JSON.stringify(newData, null, 2));
  };

  if (!value || value.trim() === '') {
    return (
      <div className="bg-gray-900 p-6 rounded-lg border border-gray-700 min-h-[300px]">
        <div className="text-center">
          <div className="text-gray-400 mb-4">{placeholder}</div>
          {!readonly && (
            <div className="flex justify-center space-x-4">
              <button
                onClick={() => createNewJson('object')}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-500 transition-colors"
              >
                Create Object
              </button>
              <button
                onClick={() => createNewJson('array')}
                className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-500 transition-colors"
              >
                Create Array
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (!isValid) {
    return (
      <div className="bg-gray-900 p-6 rounded-lg border border-red-500 min-h-[300px]">
        <div className="flex items-center mb-4">
          <svg className="w-5 h-5 text-red-500 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="text-red-500 font-medium">Invalid JSON</span>
        </div>
        <div className="text-red-400 text-sm font-mono bg-red-900/20 p-3 rounded">
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gray-900 rounded-lg border border-gray-700 overflow-hidden">
      <div className="bg-gray-800 px-4 py-2 border-b border-gray-700">
        <span className="text-gray-300 text-sm font-medium">JSON Tree</span>
      </div>
      <div className="p-4 max-h-[500px] overflow-auto">
        <TreeNode
          data={jsonData}
          path=""
          onUpdate={updateValue}
          level={0}
        />
      </div>
    </div>
  );
};

export default JsonTreeEditor;