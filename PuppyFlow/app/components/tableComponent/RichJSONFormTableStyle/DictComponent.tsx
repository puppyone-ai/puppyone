'use client';
import React, { useState } from 'react';
import ComponentRenderer, { createEmptyElement } from './ComponentRenderer';

type DictComponentProps = {
  data: Record<string, any>;
  readonly?: boolean;
  isNested?: boolean;
  onUpdate: (newData: Record<string, any>) => void;
  preventParentDrag: () => void;
  allowParentDrag: () => void;
};

const DictComponent = ({
  data,
  readonly = false,
  isNested = false,
  onUpdate,
  preventParentDrag,
  allowParentDrag,
}: DictComponentProps) => {
  const [draggedKey, setDraggedKey] = useState<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const keys = Object.keys(data);

  const deleteKey = (keyToDelete: string) => {
    const newData = { ...data };
    delete newData[keyToDelete];
    onUpdate(newData);
  };

  // 生成随机key的函数
  const generateRandomKey = () => {
    const existingKeys = Object.keys(data);
    let newKey = `${Math.random().toString(36).substr(2, 6)}`;

    // 确保key不重复
    while (existingKeys.includes(newKey)) {
      newKey = `${Math.random().toString(36).substr(2, 6)}`;
    }

    return newKey;
  };

  const addEmptyKey = () => {
    const newKey = generateRandomKey();
    const newData = {
      ...data,
      [newKey]: createEmptyElement(),
    };
    onUpdate(newData);
  };

  const updateValue = (key: string, newValue: any) => {
    const newData = {
      ...data,
      [key]: newValue,
    };
    onUpdate(newData);
  };

  const handleMouseDown = (key: string) => {
    setSelectedKey(key);
  };

  const handleMouseUp = () => {
    setSelectedKey(null);
  };

  const handleDragStart = (e: React.DragEvent, key: string) => {
    setDraggedKey(key);
    e.dataTransfer.effectAllowed = 'move';
    // 防止父级拖拽
    preventParentDrag();
  };

  const handleDragEnd = () => {
    setDraggedKey(null);
    setDragOverKey(null);
    setSelectedKey(null);
    // 恢复父级拖拽
    allowParentDrag();
  };

  const handleDragOver = (e: React.DragEvent, key: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverKey(key);
  };

  const handleDragLeave = () => {
    setDragOverKey(null);
  };

  const handleDrop = (e: React.DragEvent, dropKey: string) => {
    e.preventDefault();

    if (draggedKey === null || draggedKey === dropKey) {
      return;
    }

    // 重新排序键值对
    const keyArray = Object.keys(data);
    const draggedIndex = keyArray.indexOf(draggedKey);
    const dropIndex = keyArray.indexOf(dropKey);

    // 移除被拖拽的键
    keyArray.splice(draggedIndex, 1);

    // 插入到新位置
    const insertIndex = draggedIndex < dropIndex ? dropIndex - 1 : dropIndex;
    keyArray.splice(insertIndex, 0, draggedKey);

    // 重建对象，保持新的键顺序
    const newData: Record<string, any> = {};
    keyArray.forEach(key => {
      newData[key] = data[key];
    });

    onUpdate(newData);
    setDraggedKey(null);
    setDragOverKey(null);
  };

  return (
    <div className='bg-[#252525] shadow-sm group/dict relative'>
      <div className='space-y-0'>
        {keys.length === 0 ? (
          // Empty state - 简洁版本
          <div className='w-full px-[16px] py-[8px] bg-transparent rounded-md overflow-hidden transition-colors duration-200'>
            {readonly ? (
              <div className='flex items-center h-[24px]'>
                <div className='text-[#6D7177] text-[12px] italic leading-normal font-plus-jakarta-sans'>
                  empty object
                </div>
              </div>
            ) : (
              <div className='flex items-center h-[24px] space-x-2'>
                <span className='text-[#6D7177] text-[12px] italic leading-normal font-plus-jakarta-sans'>
                  empty object, click
                </span>
                <button
                  onClick={addEmptyKey}
                  className='flex items-center justify-center w-6 h-5 bg-[#2a2a2a] hover:bg-[#3a3a3a] border border-[#6D7177]/30 hover:border-[#6D7177]/50 rounded-md text-[#CDCDCD] hover:text-white transition-all duration-200'
                  title='Add first key'
                >
                  <svg
                    className='w-3 h-3'
                    viewBox='0 0 16 16'
                    fill='none'
                    stroke='currentColor'
                    strokeWidth='1.5'
                    strokeLinecap='round'
                    strokeLinejoin='round'
                  >
                    <path d='M8 3v10M3 8h10' />
                  </svg>
                </button>
                <span className='text-[#6D7177] text-[12px] italic leading-normal font-plus-jakarta-sans'>
                  to add
                </span>
              </div>
            )}
          </div>
        ) : (
          <>
            {keys.map((key, index) => (
              <React.Fragment key={key}>
                {/* Drop Indicator Line - 在当前元素上方显示插入指示线 */}
                {dragOverKey === key &&
                  draggedKey !== null &&
                  draggedKey !== key && (
                    <div className='relative'>
                      <div className='absolute inset-x-0 -top-[2px] h-[2px] bg-blue-400 z-40 rounded-full shadow-lg'>
                        <div className='absolute left-2 -top-1 w-2 h-2 bg-blue-400 rounded-full'></div>
                      </div>
                    </div>
                  )}

                <div
                  className={`group relative transition-all duration-200 ${
                    selectedKey === key || draggedKey === key
                      ? 'bg-blue-500/20'
                      : 'hover:bg-[#6D7177]/20'
                  }`}
                  onDragOver={e => handleDragOver(e, key)}
                  onDragLeave={handleDragLeave}
                  onDrop={e => handleDrop(e, key)}
                >
                  <div className='flex items-stretch'>
                    {/* Key Badge - 与字符串值样式保持一致 */}
                    <div className='flex-shrink-0 flex justify-center'>
                      <div className='w-[64px] pt-[4px] bg-transparent rounded-md overflow-hidden transition-colors duration-200 flex justify-center'>
                        <span
                          className='text-[10px] text-[#9b7edb] leading-[28px] font-plus-jakarta-sans truncate max-w-full italic'
                          title={key}
                        >
                          {key}
                        </span>
                      </div>
                    </div>

                    {/* Vertical Divider Line with Drag Handle */}
                    <div className='flex-shrink-0 flex items-center relative'>
                      <div className='w-[1px] bg-[#6D7177]/70 h-full'></div>

                      {/* Drag Handle - 在竖线上 */}
                      {!readonly && (
                        <div className='absolute left-1/2 top-1/2 transform -translate-x-1/2 -translate-y-1/2 z-30'>
                          <div
                            draggable
                            onMouseDown={() => handleMouseDown(key)}
                            onMouseUp={handleMouseUp}
                            onDragStart={e => handleDragStart(e, key)}
                            onDragEnd={handleDragEnd}
                            className={`w-4 h-6 flex items-center justify-center rounded-[3px] 
                                                          border transition-all duration-200 ease-out cursor-pointer
                                                          ${
                                                            selectedKey ===
                                                              key ||
                                                            draggedKey === key
                                                              ? 'bg-blue-500 border-blue-400 opacity-100'
                                                              : 'bg-[#252525] hover:bg-[#2a2a2a] border-[#6D7177]/30 hover:border-[#6D7177]/50 opacity-0 group-hover:opacity-100'
                                                          }`}
                          >
                            <div className='flex flex-col items-center gap-[2px]'>
                              <div
                                className={`w-[2px] h-[2px] rounded-full ${
                                  selectedKey === key || draggedKey === key
                                    ? 'bg-white'
                                    : 'bg-[#CDCDCD]'
                                }`}
                              ></div>
                              <div
                                className={`w-[2px] h-[2px] rounded-full ${
                                  selectedKey === key || draggedKey === key
                                    ? 'bg-white'
                                    : 'bg-[#CDCDCD]'
                                }`}
                              ></div>
                              <div
                                className={`w-[2px] h-[2px] rounded-full ${
                                  selectedKey === key || draggedKey === key
                                    ? 'bg-white'
                                    : 'bg-[#CDCDCD]'
                                }`}
                              ></div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Content */}
                    <div className='flex-1 min-w-0'>
                      <ComponentRenderer
                        data={data[key]}
                        path={key}
                        readonly={readonly}
                        onUpdate={newValue => updateValue(key, newValue)}
                        preventParentDrag={preventParentDrag}
                        allowParentDrag={allowParentDrag}
                      />
                    </div>
                  </div>
                </div>

                {/* 最后一个元素后的插入指示线 */}
                {index === keys.length - 1 &&
                  dragOverKey === key &&
                  draggedKey !== null &&
                  draggedKey !== key && (
                    <div className='relative'>
                      <div className='absolute inset-x-0 top-[2px] h-[2px] bg-blue-400 z-40 rounded-full shadow-lg'>
                        <div className='absolute left-2 -top-1 w-2 h-2 bg-blue-400 rounded-full'></div>
                      </div>
                    </div>
                  )}

                {/* Horizontal Divider Line - 在元素之间添加水平分隔线 */}
                {index < keys.length - 1 && (
                  <div className='w-full h-[1px] bg-[#6D7177]/70 my-[4px]'></div>
                )}
              </React.Fragment>
            ))}

            {/* Add New Key - 只在非空时显示 */}
            {!readonly && (
              <div className='absolute -bottom-2 left-[32px] z-30 transform -translate-x-1/2'>
                <button
                  onClick={addEmptyKey}
                  className='group w-6 h-4 flex items-center justify-center rounded-[3px] 
                                             bg-[#252525] hover:bg-[#2a2a2a] border border-[#6D7177]/30 hover:border-[#6D7177]/50 
                                             transition-all duration-200 ease-out shadow-lg opacity-0 group-hover/dict:opacity-100'
                  title='Add new key'
                >
                  <svg
                    className='w-3 h-2.5 text-[#CDCDCD] transition-transform duration-200 group-hover:scale-110'
                    viewBox='0 0 16 16'
                    fill='none'
                    stroke='currentColor'
                    strokeWidth='1.5'
                    strokeLinecap='round'
                    strokeLinejoin='round'
                  >
                    <path d='M8 3v10M3 8h10' />
                  </svg>
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default DictComponent;
