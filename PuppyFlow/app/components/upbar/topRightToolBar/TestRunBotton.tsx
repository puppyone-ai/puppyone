import React, { useState } from 'react';
import { useReactFlow } from '@xyflow/react';
import {
  runAllNodes,
  RunAllNodesContext,
} from '../../workflow/edgesNode/edgeNodesNew/hook/runAllNodesExecutor';
import useJsonConstructUtils from '@/app/components/hooks/useJsonConstructUtils';
import { useNodesPerFlowContext } from '@/app/components/states/NodesPerFlowContext';
import { useAppSettings } from '@/app/components/states/AppSettingsContext';
import useGetSourceTarget from '@/app/components/hooks/useGetSourceTarget';

function TestRunBotton() {
  const [hovered, setHovered] = useState(false);
  const [isComplete, setIsComplete] = useState(true);
  const { getNodes, getNode, setNodes, getEdges } = useReactFlow();

  // 获取需要的hooks
  const { reportError, resetLoadingUI } = useJsonConstructUtils();
  const { clearAll } = useNodesPerFlowContext();
  const { getAuthHeaders } = useAppSettings();
  const { getSourceNodeIdWithLabel, getTargetNodeIdWithLabel } =
    useGetSourceTarget();

  const onDataSubmit = async () => {
    // 如果正在加载中，则不执行
    if (!isComplete) {
      console.log('Already processing. Not executing.');
      return;
    }

    // 检查是否有节点
    const nodes = getNodes();
    if (nodes.length === 0) {
      alert('No nodes to process. Please add some nodes first.');
      return;
    }

    try {
      // 设置为处理中
      setIsComplete(false);

      // 创建执行上下文
      const context: RunAllNodesContext = {
        getNode,
        getNodes,
        getEdges,
        setNodes,
        getSourceNodeIdWithLabel,
        getTargetNodeIdWithLabel,
        clearAll,
        reportError,
        resetLoadingUI,
        getAuthHeaders,
      };

      // 执行全局运行
      await runAllNodes({
        context,
        onComplete: () => setIsComplete(true),
        onStart: () => console.log('开始全局运行'),
      });

      console.log('All nodes have been processed successfully');
    } catch (error) {
      console.error('Error processing nodes:', error);
      alert(
        'An error occurred while processing nodes. See console for details.'
      );
    } finally {
      setIsComplete(true);
    }
  };

  return (
    <button
      className={`h-[36px] px-[12px] rounded-r-[8px] ${!isComplete ? 'bg-gray-200' : 'bg-[rgba(217,217,217, 0)]'} flex items-center justify-center gap-[4px] hover:cursor-pointer hover:bg-main-green transition-colors`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onDataSubmit}
      disabled={!isComplete}
    >
      {!isComplete ? (
        // 加载状态指示器
        <svg
          className='animate-spin h-4 w-4 text-gray-500'
          xmlns='http://www.w3.org/2000/svg'
          fill='none'
          viewBox='0 0 24 24'
        >
          <circle
            className='opacity-25'
            cx='12'
            cy='12'
            r='10'
            stroke='currentColor'
            strokeWidth='4'
          ></circle>
          <path
            className='opacity-75'
            fill='currentColor'
            d='M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z'
          ></path>
        </svg>
      ) : (
        <svg
          width='14'
          height='14'
          viewBox='0 0 14 14'
          fill='none'
          xmlns='http://www.w3.org/2000/svg'
          className='transition-[fill]'
        >
          <path
            className='transition-[fill]'
            d='M12 7L3 13V1L12 7Z'
            fill={hovered === true ? '#000' : '#39BC66'}
          />
        </svg>
      )}
      <div
        className={`text-[14px] font-normal leading-normal transition-colors ${!isComplete ? 'text-gray-500' : hovered === true ? 'text-[#000]' : 'text-[#39BC66]'}`}
      >
        {!isComplete ? 'Processing...' : 'Test Run'}
      </div>
    </button>
  );
}

export default TestRunBotton;
