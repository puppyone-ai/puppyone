'use client';
import React, { useState, useRef, useEffect } from 'react';
import { useNodesPerFlowContext } from '../../states/NodesPerFlowContext';
import TreeNode from './TreeNode';
import { TreeProvider } from './TreeContext';

type JSONTreeEditorProps = {
  preventParentDrag: () => void;
  allowParentDrag: () => void;
  placeholder?: string;
  widthStyle?: number;
  heightStyle?: number;
  value?: string;
  readonly?: boolean;
  onChange?: (value: string) => void;
};

type JSONData =
  | {
      [key: string]: any;
    }
  | any[]
  | string
  | number
  | boolean
  | null;

const JSONTreeEditor = ({
  preventParentDrag,
  allowParentDrag,
  placeholder = 'Enter JSON data...',
  widthStyle = 0,
  heightStyle = 0,
  value = '',
  readonly = false,
  onChange,
}: JSONTreeEditorProps) => {
  const [parsedData, setParsedData] = useState<JSONData | null>(null);
  const [isValidJSON, setIsValidJSON] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const { isOnGeneratingNewNode } = useNodesPerFlowContext();

  // Parse JSON data
  useEffect(() => {
    if (!value || value.trim() === '') {
      setParsedData(null);
      setIsValidJSON(false);
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
  }, [value]);

  // Handle data updates
  const updateData = (newData: any) => {
    if (onChange) {
      onChange(JSON.stringify(newData, null, 2));
    }
  };

  // Create initial data structure
  const createInitialData = (type: 'object' | 'array' | 'string') => {
    let newData: any;
    switch (type) {
      case 'object':
        newData = {};
        break;
      case 'array':
        newData = [];
        break;
      case 'string':
        newData = '';
        break;
      default:
        newData = {};
    }
    updateData(newData);
  };

  // Calculate actual width/height styles
  const actualWidth = widthStyle === 0 ? '100%' : widthStyle;
  const actualHeight = heightStyle === 0 ? '100%' : heightStyle;

  // Empty state
  if (!value || value.trim() === '') {
    return (
      <TreeProvider>
        <div
          className={`relative rounded-lg bg-[#1e1e1e] border border-[#3c3c3c] p-6 ${isOnGeneratingNewNode ? 'pointer-events-none opacity-70' : ''}`}
          style={{ width: actualWidth, height: actualHeight }}
        >
          <div className='text-center'>
            <div className='text-[#cccccc] text-sm font-normal mb-4'>
              {placeholder}
            </div>
            {!readonly && (
              <div className='space-y-2'>
                <button
                  onClick={() => createInitialData('object')}
                  className='block w-full px-4 py-2 bg-[#0e639c] text-white rounded hover:bg-[#1177bb] transition-colors text-sm font-medium'
                >
                  Create Object
                </button>
                <button
                  onClick={() => createInitialData('array')}
                  className='block w-full px-4 py-2 bg-[#0e639c] text-white rounded hover:bg-[#1177bb] transition-colors text-sm font-medium'
                >
                  Create Array
                </button>
                <button
                  onClick={() => createInitialData('string')}
                  className='block w-full px-4 py-2 bg-[#0e639c] text-white rounded hover:bg-[#1177bb] transition-colors text-sm font-medium'
                >
                  Create String
                </button>
              </div>
            )}
          </div>
        </div>
      </TreeProvider>
    );
  }

  // Invalid JSON state
  if (!isValidJSON) {
    return (
      <TreeProvider>
        <div
          className={`relative flex flex-col border border-[#f48771] rounded-lg bg-[#1e1e1e] p-4 ${isOnGeneratingNewNode ? 'pointer-events-none opacity-70' : ''}`}
          style={{ width: actualWidth, height: actualHeight }}
        >
          <div className='flex items-center mb-2'>
            <svg
              className='w-4 h-4 text-[#f48771] mr-2'
              fill='currentColor'
              viewBox='0 0 20 20'
            >
              <path
                fillRule='evenodd'
                d='M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z'
                clipRule='evenodd'
              />
            </svg>
            <span className='text-[#f48771] text-sm font-semibold'>
              Invalid JSON
            </span>
          </div>
          <div className='text-[#cccccc] text-sm font-mono overflow-auto bg-[#2d2d30] p-3 rounded border border-[#3c3c3c]'>
            {value}
          </div>
        </div>
      </TreeProvider>
    );
  }

  // Main tree view
  return (
    <TreeProvider>
      <div
        ref={containerRef}
        className={`relative bg-[#1e1e1e] border border-[#3c3c3c] rounded-lg overflow-auto scrollbar-hide ${isOnGeneratingNewNode ? 'pointer-events-none opacity-70' : ''}`}
        style={{
          width: actualWidth,
          height: actualHeight,
          fontFamily: "'Consolas', 'Courier New', monospace",
        }}
        data-tree-editor='true'
      >
        <div className='p-2'>
          <TreeNode
            data={parsedData}
            path=''
            level={0}
            readonly={readonly}
            onUpdate={updateData}
            preventParentDrag={preventParentDrag}
            allowParentDrag={allowParentDrag}
          />
        </div>
      </div>
    </TreeProvider>
  );
};

export default JSONTreeEditor;
