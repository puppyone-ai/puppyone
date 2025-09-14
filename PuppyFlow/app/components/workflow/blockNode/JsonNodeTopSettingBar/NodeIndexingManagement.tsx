'use client';

import React from 'react';

interface BaseIndexingItem {
  type: string;
}

interface VectorIndexingItem extends BaseIndexingItem {
  type: 'vector';
  status: 'notStarted' | 'processing' | 'done' | 'error' | 'deleting';
  index_name: string;
}

interface OtherIndexingItem extends BaseIndexingItem {
  type: 'other';
}

type IndexingItem = VectorIndexingItem | OtherIndexingItem;

interface NodeIndexingManagementProps {
  indexingList: IndexingItem[];
  onClose: () => void;
  onAddIndexClick: (
    e: React.MouseEvent,
    optionType?: 'vector' | 'create' | 'update'
  ) => void;
  onRemoveIndex: (index: number) => void;
}

const NodeIndexingManagement: React.FC<NodeIndexingManagementProps> = ({
  indexingList,
  onClose,
  onAddIndexClick,
  onRemoveIndex,
}) => {
  const createOptions = [
    {
      id: 'vector',
      label: 'Vector Search MCP',
      description: 'Search this context using embeddings',
    },
    {
      id: 'insert',
      label: 'Insert Element MCP',
      description: 'Create new content into this context',
    },
    {
      id: 'update',
      label: 'Update Element MCP',
      description: 'Update or enrich content in this context',
    },
  ];
  return (
    <>
      <div className='flex items-start justify-between pl-[8px] border-b border-[#6D7177]/30 py-1'>
        <div className='flex flex-col min-w-0 gap-1'>
          <span className='text-[12px] font-medium text-[#9B9B9B]'>
            Agent-Context Interactions (MCP)
          </span>
          <span className='text-[#606060] text-[11px] whitespace-nowrap truncate'>
            Define how the agent can access, insert, or update this context via MCP.
          </span>
        </div>
        <button
          onClick={onClose}
          className='p-0.5 w-6 h-6 flex items-center justify-center text-[#6D7177] hover:text-[#CDCDCD] rounded-full hover:bg-[#3A3A3A] transition-colors'
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

      <div className='py-1 px-1'>
        
        {/* 无索引时的提示 */}
        {indexingList.length === 0 && (
          <div className='mb-3'>
            <div className='text-center py-4'>
              <div className='text-[#808080] text-[12px]'>
                No interactions configured yet
              </div>
              <div className='text-[#606060] text-[11px] mt-1'>
                Add an MCP-capable interaction below
              </div>
            </div>
          </div>
        )}

        {/* 已有索引列表 */}
        {indexingList.length > 0 && (
          <div className='mb-3'>
            <div className='flex items-center mb-2 pl-[4px]'>
              <h3 className='text-[#808080] text-[11px] font-normal'>
                Configured Interactions (MCP)
              </h3>
              <span className='ml-1 text-[11px] text-[#606060]'>
                {indexingList.length}
              </span>
            </div>
            <div className='space-y-1 max-h-[200px] overflow-y-auto px-1'>
              {indexingList.map((item, index) => (
                <div
                  key={index}
                  className='flex items-center gap-2 px-3 py-2 rounded-md border border-[#404040] transition-colors group cursor-default hover:bg-[#2A2A2A]'
                >
                  {/* 左侧图标：完成/失败显示 MCP SVG，否则状态点 */}
                  {item.type === 'vector' && (((item as VectorIndexingItem).status === 'done') || ((item as VectorIndexingItem).status === 'error')) ? (
                    <div className={`w-6 h-6 rounded-full border flex items-center justify-center flex-shrink-0 ${ (item as VectorIndexingItem).status === 'done' ? 'border-[#39BC66]' : 'border-[#E53935]' }`}>
                      <svg className={`w-4 h-4 transition-colors ${ (item as VectorIndexingItem).status === 'done' ? 'text-[#39BC66]' : 'text-[#E53935]' }`} viewBox='0 0 24 24' fill='none' xmlns='http://www.w3.org/2000/svg'>
                        <path d='M12.1699 3L14.768 6.75H9.57185L12.1699 3Z' fill='currentColor' />
                        <path d='M2.58478 18.9505L4.45961 14.6978L7.20515 19.4532L2.58478 18.9505Z' fill='currentColor' />
                        <path d='M22.0848 19.2455L17.4644 19.7482L20.21 14.9928L22.0848 19.2455Z' fill='currentColor' />
                        <path d='M12.1699 14V5' stroke='currentColor' strokeWidth='2' />
                        <path d='M12.1699 14L20.1699 18' stroke='currentColor' strokeWidth='2' />
                        <path d='M12.1699 14L4.16992 18' stroke='currentColor' strokeWidth='2' />
                      </svg>
                    </div>
                  ) : (
                    <div
                      className={`w-2 h-2 rounded-full flex-shrink-0 ${
                        item.type === 'vector' && (item as VectorIndexingItem).status === 'error'
                          ? 'bg-[#E53935]'
                          : item.type === 'vector' && (item as VectorIndexingItem).status === 'processing'
                          ? 'bg-[#FFC107]'
                          : item.type === 'vector' && (item as VectorIndexingItem).status === 'deleting'
                          ? 'bg-[#FF9800]'
                          : 'bg-[#39BC66]'
                      }`}
                    />
                  )}
                  
                  {/* 索引信息 */}
                  <div className='flex-1 min-w-0 text-left'>
                    <div className='flex items-center'>
                      <div
                        className={`text-[#CDCDCD] text-[12px] font-medium group-hover:text-white max-w-[200px] truncate ${
                          item.type === 'vector' && (item as VectorIndexingItem).status === 'error'
                            ? 'text-[#E53935]'
                            : item.type === 'vector' && (item as VectorIndexingItem).status === 'processing'
                            ? 'text-[#FFC107]'
                            : ''
                        }`}
                      >
                        {(item as VectorIndexingItem).index_name}
                      </div>

                      {/* 状态标签（保留原有逻辑） */}
                      {(item as VectorIndexingItem).status !== 'notStarted' && (
                        <div
                          className={`ml-2 flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-medium ${
                            (item as VectorIndexingItem).status === 'processing'
                              ? 'bg-[#FFC107]/10 text-[#FFC107]'
                              : (item as VectorIndexingItem).status === 'deleting'
                              ? 'bg-[#FF9800]/10 text-[#FF9800]'
                              : (item as VectorIndexingItem).status === 'error'
                              ? 'bg-[#E53935]/10 text-[#E53935]'
                              : 'bg-[#39BC66]/10 text-[#39BC66]'
                          }`}
                        >
                          {(item as VectorIndexingItem).status === 'processing' && (
                            <svg width='8' height='8' viewBox='0 0 24 24' fill='none' stroke='currentColor' className='animate-spin' style={{ animationDuration: '1.5s' }}>
                              <path d='M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83' strokeWidth='3' strokeLinecap='round' />
                            </svg>
                          )}
                          {(item as VectorIndexingItem).status === 'deleting' && (
                            <svg width='8' height='8' viewBox='0 0 24 24' fill='none' stroke='currentColor' className='animate-spin' style={{ animationDuration: '1.5s' }}>
                              <path d='M18 6L6 18M6 6l12 12' strokeWidth='3' strokeLinecap='round' strokeLinejoin='round' />
                            </svg>
                          )}
                          {(item as VectorIndexingItem).status === 'error' && (
                            <svg width='8' height='8' viewBox='0 0 24 24' fill='none' stroke='currentColor'>
                              <path d='M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z' strokeWidth='2' strokeLinecap='round' />
                            </svg>
                          )}
                          {(item as VectorIndexingItem).status === 'done' && (
                            <svg width='8' height='8' viewBox='0 0 24 24' fill='none' stroke='currentColor'>
                              <path d='M5 13l4 4L19 7' strokeWidth='3' strokeLinecap='round' strokeLinejoin='round' />
                            </svg>
                          )}
                          <span>
                            {(item as VectorIndexingItem).status === 'processing' && 'Processing'}
                            {(item as VectorIndexingItem).status === 'deleting' && 'Deleting'}
                            {(item as VectorIndexingItem).status === 'error' && 'Error'}
                            {(item as VectorIndexingItem).status === 'done' && 'Complete'}
                          </span>
                        </div>
                      )}
                    </div>
                    <div className='text-[11px] text-[#808080] mt-[1px] text-left'>
                      {item.type === 'vector' ? 'vector search (MCP)' : 'Interaction (MCP)'}
                    </div>
                  </div>

                  {/* 删除按钮（样式与部署列表一致） */}
                  <button
                    onClick={e => {
                      e.stopPropagation();
                      onRemoveIndex(index);
                    }}
                    className='flex items-center justify-center w-[24px] h-[24px] text-[#E74C3C] rounded-[4px] hover:bg-[#E74C3C]/20 transition-colors duration-200'
                    title='Delete Index'
                  >
                    <svg className='w-3 h-3' fill='currentColor' viewBox='0 0 20 20' xmlns='http://www.w3.org/2000/svg'>
                      <path fillRule='evenodd' d='M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z' clipRule='evenodd' />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 新建索引选项（位于下方） */}
        <div className={`${indexingList.length > 0 ? 'pt-2' : ''}`}>
          <h3 className='text-[#808080] text-[11px] font-normal mb-2 text-left pl-[4px]'>
            Add Interaction (MCP)
          </h3>
          <div className='space-y-1 px-1'>
            {createOptions.map(option => (
              <div
                key={option.id}
                className={`flex items-center gap-2 px-3 py-2 rounded-md border border-[#404040] transition-colors group ${option.id === 'insert' || option.id === 'update' ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-[#2A2A2A]'}`}
                title={option.id === 'insert' || option.id === 'update' ? 'Coming soon' : undefined}
                onClick={e => {
                  if (option.id === 'insert' || option.id === 'update') {
                    e.preventDefault();
                    e.stopPropagation();
                    return;
                  }
                  onAddIndexClick(
                    e,
                    option.id === 'vector'
                      ? 'vector'
                      : option.id === 'insert'
                      ? 'create'
                      : option.id === 'update'
                      ? 'update'
                      : undefined
                  );
                }}
              >
                {/* 左侧图标容器（Vector Search：笛卡尔坐标风格） */}
                <div className='w-6 h-6 rounded-full border border-[#606060] flex items-center justify-center flex-shrink-0'>
                  {option.id === 'vector' && (
                    <svg className='w-4 h-4 text-[#606060] group-hover:text-[#CDCDCD] transition-colors' viewBox='0 0 24 24' fill='none' xmlns='http://www.w3.org/2000/svg'>
                      <path d='M12.1699 3L14.768 6.75H9.57185L12.1699 3Z' fill='currentColor' />
                      <path d='M2.58478 18.9505L4.45961 14.6978L7.20515 19.4532L2.58478 18.9505Z' fill='currentColor' />
                      <path d='M22.0848 19.2455L17.4644 19.7482L20.21 14.9928L22.0848 19.2455Z' fill='currentColor' />
                      <path d='M12.1699 14V5' stroke='currentColor' strokeWidth='2' />
                      <path d='M12.1699 14L20.1699 18' stroke='currentColor' strokeWidth='2' />
                      <path d='M12.1699 14L4.16992 18' stroke='currentColor' strokeWidth='2' />
                    </svg>
                  )}
                  {option.id === 'insert' && (
                    <svg className='w-4 h-4 text-[#606060] group-hover:text-[#CDCDCD] transition-colors' viewBox='0 0 24 24' fill='none' xmlns='http://www.w3.org/2000/svg'>
                      <circle cx='12' cy='12' r='8' stroke='currentColor' strokeWidth='2' />
                      <path d='M12 8v8M8 12h8' stroke='currentColor' strokeWidth='2' strokeLinecap='round' />
                    </svg>
                  )}
                  {option.id === 'update' && (
                    <svg className='w-4 h-4 text-[#606060] group-hover:text-[#CDCDCD] transition-colors' viewBox='0 0 24 24' fill='none' xmlns='http://www.w3.org/2000/svg'>
                      <path d='M15.232 5.232l3.536 3.536' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' />
                      <path d='M4 20h4l9.5-9.5a2 2 0 10-2.828-2.828L5.172 17.172 4 20z' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' />
                    </svg>
                  )}
                </div>

                {/* 文字信息 */}
                <div className='flex-1 min-w-0 text-left'>
                  <div className='text-[#CDCDCD] text-[12px] font-medium group-hover:text-white text-left'>
                    {option.label}
                  </div>
                  <div className='text-[11px] text-[#808080] mt-[1px] text-left'>
                    {option.description}
                  </div>
                </div>

                {/* 右侧加号图标 */}
                <div className='flex items-center justify-center w-[24px] h-[24px] text-[#606060] group-hover:text-[#CDCDCD] transition-colors duration-200'>
                  <svg className='w-4 h-4' fill='none' stroke='currentColor' viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'>
                    <path strokeLinecap='round' strokeLinejoin='round' strokeWidth={2.5} d='M12 4v16m8-8H4' />
                  </svg>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
};

export default NodeIndexingManagement;


