import React, { useMemo } from 'react';
import { useDashboardContext } from './states/DashBoardContext';

const Models: React.FC = () => {
  const { cloudModels, localModels } = useDashboardContext();

  // 按类型分组模型 - 先按模型类型，合并本地和云端
  const groupedModels = useMemo(() => {
    const allLLMs = [
      ...localModels
        .filter(model => model.type !== 'embedding')
        .map(model => ({ ...model, deployment: 'local' })),
      ...cloudModels
        .filter(model => model.type !== 'embedding')
        .map(model => ({ ...model, deployment: 'cloud' })),
    ];

    const allEmbeddings = [
      ...localModels
        .filter(model => model.type === 'embedding')
        .map(model => ({ ...model, deployment: 'local' })),
      ...cloudModels
        .filter(model => model.type === 'embedding')
        .map(model => ({ ...model, deployment: 'cloud' })),
    ];

    return {
      llm: allLLMs,
      embedding: allEmbeddings,
    };
  }, [localModels, cloudModels]);

  // 渲染模型列表的通用组件
  const ModelList = ({
    models,
    emptyMessage,
  }: {
    models: any[];
    emptyMessage: string;
  }) =>
    models.length > 0 ? (
      <div className='rounded-lg border border-[#343434] bg-[#2B2B2B] p-4 space-y-3'>
        {models.map(model => (
          <div
            key={model.id}
            className='flex items-center justify-between border-b border-[#343434] pb-2 last:border-0 last:pb-0'
          >
            <div>
              <div className='text-[#E5E5E5] text-[13px]'>{model.name}</div>
              <div className='text-[#8B8B8B] text-[12px] flex items-center gap-2'>
                <span>{model.provider || 'Local Model'}</span>
              </div>
            </div>
            <div className='text-sm'>
              <span
                className={`px-2 py-1 rounded text-[11px] font-medium ${
                  model.deployment === 'local'
                    ? 'bg-[#2A4365] text-[#90CDF4]'
                    : 'bg-[#3A3A3A] text-[#CDCDCD]'
                }`}
              >
                {model.deployment === 'local' ? 'Local' : 'Cloud'}
              </span>
            </div>
          </div>
        ))}
      </div>
    ) : (
      <div className='rounded-lg border border-[#343434] bg-[#2B2B2B] p-4 text-center'>
        <span className='text-[#8B8B8B] block text-[13px]'>{emptyMessage}</span>
      </div>
    );

  return (
    <div className='space-y-4 max-h-[500px] pr-2 text-[13px] text-[#D4D4D4]'>
      <h3 className='text-[16px] font-semibold text-[#E5E5E5] sticky top-0 z-10 bg-[#2A2A2A] border-b border-[#343434] py-2'>
        AI Models Configuration
      </h3>

      <div className='py-[8px] space-y-4 overflow-y-auto'>
        {/* LLM Models Section */}
        <div className='space-y-4'>
          <div className='flex items-center justify-between'>
            <h4 className='text-[14px] font-semibold text-[#E5E5E5]'>
              LLM Models
            </h4>
            <button
              onClick={() => {
                /* refresh function will be added later */
              }}
              className='inline-flex items-center justify-center rounded-md text-[13px] font-medium border border-[#404040] text-[#A1A1A1] hover:border-[#505050] hover:text-white transition-colors gap-1 px-2 py-1 active:scale-95'
            >
              <svg
                className='w-4 h-4'
                viewBox='0 0 24 24'
                fill='none'
                xmlns='http://www.w3.org/2000/svg'
              >
                <path
                  d='M4 4V9H4.58152M19.9381 11C19.446 7.05369 16.0796 4 12 4C8.64262 4 5.76829 6.06817 4.58152 9M4.58152 9H9M20 20V15H19.4185M19.4185 15C18.2317 17.9318 15.3574 20 12 20C7.92038 20 4.55399 16.9463 4.06189 13M19.4185 15H15'
                  stroke='currentColor'
                  strokeWidth='2'
                  strokeLinecap='round'
                  strokeLinejoin='round'
                />
              </svg>
              <span>Refresh</span>
            </button>
          </div>

          <ModelList
            models={groupedModels.llm}
            emptyMessage='No LLM models found'
          />
        </div>

        {/* Embedding Models Section */}
        <div className='space-y-4'>
          <h4 className='text-[14px] font-semibold text-[#E5E5E5]'>
            Embedding Models
          </h4>

          <ModelList
            models={groupedModels.embedding}
            emptyMessage='No embedding models found'
          />
        </div>
      </div>
    </div>
  );
};

export default Models;
