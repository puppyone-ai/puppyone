'use client';
import React, { useState, useRef, useEffect } from 'react';

interface TreeValueEditorProps {
  value: any;
  onSave: (newValue: any) => void;
  onCancel: () => void;
}

const TreeValueEditor: React.FC<TreeValueEditorProps> = ({
  value,
  onSave,
  onCancel,
}) => {
  const [inputValue, setInputValue] = useState('');
  const [valueType, setValueType] = useState<
    'string' | 'number' | 'boolean' | 'null'
  >('string');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Determine the current type and set input value
    if (value === null) {
      setValueType('null');
      setInputValue('null');
    } else if (typeof value === 'boolean') {
      setValueType('boolean');
      setInputValue(value.toString());
    } else if (typeof value === 'number') {
      setValueType('number');
      setInputValue(value.toString());
    } else {
      setValueType('string');
      setInputValue(String(value));
    }

    // Focus the input
    if (inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [value]);

  const handleSave = () => {
    let newValue: any;

    try {
      switch (valueType) {
        case 'null':
          newValue = null;
          break;
        case 'boolean':
          newValue = inputValue.toLowerCase() === 'true';
          break;
        case 'number':
          if (inputValue.trim() === '') {
            newValue = 0;
          } else {
            newValue = Number(inputValue);
            if (isNaN(newValue)) {
              alert('Invalid number format');
              return;
            }
          }
          break;
        case 'string':
        default:
          newValue = inputValue;
          break;
      }

      onSave(newValue);
    } catch (error) {
      alert('Invalid value format');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  };

  return (
    <div className='flex items-center space-x-2 flex-1'>
      {/* Type selector */}
      <select
        value={valueType}
        onChange={e => {
          const newType = e.target.value as typeof valueType;
          setValueType(newType);

          // Set default values based on type
          switch (newType) {
            case 'null':
              setInputValue('null');
              break;
            case 'boolean':
              setInputValue('false');
              break;
            case 'number':
              setInputValue('0');
              break;
            case 'string':
              setInputValue('');
              break;
          }
        }}
        className='px-2 py-1 bg-[#3c3c3c] border border-[#464647] rounded text-xs text-[#cccccc] focus:outline-none focus:border-[#007acc]'
      >
        <option value='string'>String</option>
        <option value='number'>Number</option>
        <option value='boolean'>Boolean</option>
        <option value='null'>Null</option>
      </select>

      {/* Value input */}
      {valueType === 'boolean' ? (
        <select
          value={inputValue}
          onChange={e => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          className='flex-1 px-2 py-1 bg-[#3c3c3c] border border-[#464647] rounded text-sm text-[#cccccc] focus:outline-none focus:border-[#007acc]'
          autoFocus
        >
          <option value='true'>true</option>
          <option value='false'>false</option>
        </select>
      ) : valueType === 'null' ? (
        <input
          type='text'
          value='null'
          readOnly
          className='flex-1 px-2 py-1 bg-[#2d2d30] border border-[#464647] rounded text-sm text-[#569cd6] focus:outline-none cursor-not-allowed'
        />
      ) : (
        <input
          ref={inputRef}
          type={valueType === 'number' ? 'number' : 'text'}
          value={inputValue}
          onChange={e => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          className='flex-1 px-2 py-1 bg-[#3c3c3c] border border-[#464647] rounded text-sm text-[#cccccc] focus:outline-none focus:border-[#007acc]'
          placeholder={
            valueType === 'number' ? 'Enter number...' : 'Enter text...'
          }
        />
      )}

      {/* Action buttons */}
      <div className='flex space-x-1'>
        <button
          onClick={handleSave}
          className='px-2 py-1 bg-[#0e639c] text-white rounded text-xs hover:bg-[#1177bb] transition-colors'
          title='Save (Enter)'
        >
          ✓
        </button>
        <button
          onClick={onCancel}
          className='px-2 py-1 bg-[#3c3c3c] text-[#cccccc] rounded text-xs hover:bg-[#464647] transition-colors'
          title='Cancel (Escape)'
        >
          ✕
        </button>
      </div>
    </div>
  );
};

export default TreeValueEditor;
