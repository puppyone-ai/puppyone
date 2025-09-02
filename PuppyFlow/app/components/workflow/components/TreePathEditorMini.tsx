'use client';
import React from 'react';
import { nanoid } from 'nanoid';

interface PathSegment {
  id: string;
  type: 'key' | 'num'; // 'key' 表示字符串键名，'num' 表示数字索引
  value: string;
}

interface AdvancedPathEditorProps {
  path: PathSegment[];
  onChange: (path: PathSegment[]) => void;
}

const AdvancedPathEditor: React.FC<AdvancedPathEditorProps> = ({
  path,
  onChange,
}) => {
  // 组件内部直接使用传入的PathSegment结构
  const [segments, setSegments] = React.useState<PathSegment[]>(path);

  // 组件挂载或path改变时更新内部状态
  React.useEffect(() => {
    setSegments(path);
  }, [path]);

  // 当segments改变时，更新父组件的path
  React.useEffect(() => {
    onChange(segments);
  }, [segments, onChange]);

  // 添加新路径段
  const addSegment = () => {
    setSegments(prev => [...prev, { id: nanoid(6), type: 'key', value: '' }]);
  };

  // 删除路径段
  const deleteSegment = (id: string) => {
    setSegments(prev => prev.filter(segment => segment.id !== id));
  };

  // 更新路径段的值
  const updateSegmentValue = (id: string, value: string) => {
    setSegments(prev =>
      prev.map(segment => (segment.id === id ? { ...segment, value } : segment))
    );
  };

  // 切换路径段类型（字符串键或数字索引）
  const toggleSegmentType = (id: string) => {
    setSegments(prev =>
      prev.map(segment =>
        segment.id === id
          ? { ...segment, type: segment.type === 'key' ? 'num' : 'key' }
          : segment
      )
    );
  };

  return (
    <div className='flex flex-col gap-2'>
      {segments.length === 0 ? (
        <button
          onClick={addSegment}
          className='w-full h-[28px] flex items-center justify-center gap-2 rounded-[6px] 
                   border border-[#6D7177]/30 bg-[#252525] text-[#CDCDCD] text-[10px] 
                   hover:border-[#6D7177]/50 hover:bg-[#1E1E1E] transition-colors'
        >
          <svg
            width='10'
            height='10'
            viewBox='0 0 24 24'
            fill='none'
            stroke='#6D7177'
          >
            <path d='M12 5v14M5 12h14' strokeWidth='2' strokeLinecap='round' />
          </svg>
          Add Path Segment
        </button>
      ) : (
        <>
          {segments.map((segment, index) => (
            <div
              key={segment.id}
              className='flex items-center gap-[4px] relative'
            >
              <div className='flex-1 relative h-[28px] bg-[#252525] rounded-[6px] border-[1px] border-[#6D7177]/30 hover:border-[#6D7177]/50 transition-colors overflow-hidden'>
                <input
                  value={segment.value}
                  onChange={e => updateSegmentValue(segment.id, e.target.value)}
                  className='w-full h-full bg-transparent border-none outline-none pl-[48px] pr-[4px]
                         text-[#CDCDCD] text-[10px] appearance-none'
                  placeholder={
                    segment.type === 'num' ? 'Enter number...' : 'Enter key...'
                  }
                />

                {/* 类型选择器 */}
                <div
                  className={`absolute left-[4px] top-1/2 -translate-y-1/2 h-[18px] flex items-center 
                          px-[3px] rounded-[4px] cursor-pointer transition-colors
                          ${
                            segment.type === 'key'
                              ? 'bg-[#2D2544] border border-[#9B6DFF]/30 hover:border-[#9B6DFF]/50 hover:bg-[#2D2544]/80'
                              : 'bg-[#443425] border border-[#FF9B4D]/30 hover:border-[#FF9B4D]/50 hover:bg-[#443425]/80'
                          }`}
                  onClick={() => toggleSegmentType(segment.id)}
                >
                  <div
                    className={`text-[10px] min-w-[24px] text-center
                              ${
                                segment.type === 'key'
                                  ? 'text-[#9B6DFF]'
                                  : 'text-[#FF9B4D]'
                              }`}
                  >
                    {segment.type}
                  </div>
                </div>
              </div>

              <button
                onClick={() => deleteSegment(segment.id)}
                className='p-0.5 w-[26px] h-[26px] flex items-center justify-center text-[#6D7177] hover:text-[#ff4d4d] transition-colors'
              >
                <svg
                  width='14'
                  height='14'
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                >
                  <path
                    d='M18 6L6 18M6 6l12 12'
                    strokeWidth='2'
                    strokeLinecap='round'
                  />
                </svg>
              </button>
            </div>
          ))}

          {/* 添加按钮 */}
          <button
            onClick={addSegment}
            className='w-[26px] h-[26px] flex items-center justify-center rounded-md
                    bg-[#252525] border-[1px] border-[#6D7177]/30
                    text-[#6D7177]
                    hover:border-[#6D7177]/50 hover:bg-[#1E1E1E] 
                    transition-colors'
          >
            <svg width='10' height='10' viewBox='0 0 14 14'>
              <path d='M7 0v14M0 7h14' stroke='currentColor' strokeWidth='2' />
            </svg>
          </button>
        </>
      )}
    </div>
  );
};

export default AdvancedPathEditor;
