import React, { useEffect, useRef, useState } from 'react';
import { useReactFlow } from '@xyflow/react';
import { useServers } from '@/app/components/states/UserServersContext';
import { useServerOperations } from '@/app/components/hooks/useServerManagement';
import { useWorkspaces } from '@/app/components/states/UserWorkspacesContext';
import { useAppSettings } from '@/app/components/states/AppSettingsContext';
import { useEdgeNodeBackEndJsonBuilder } from '@/app/components/workflow/edgesNode/edgeNodesNew/hook/hookhistory/useEdgeNodeBackEndJsonBuilder';
import { useBlockNodeBackEndJsonBuilder } from '@/app/components/workflow/edgesNode/edgeNodesNew/hook/hookhistory/useBlockNodeBackEndJsonBuilder';
import useGetSourceTarget from '@/app/components/hooks/useGetSourceTarget';
import useJsonConstructUtils from '@/app/components/hooks/useJsonConstructUtils';
import { useNodesPerFlowContext } from '@/app/components/states/NodesPerFlowContext';
import {
  buildGroupNodeJson,
  RunGroupNodeContext,
} from '@/app/components/workflow/edgesNode/edgeNodesNew/hook/runGroupNodeExecutor';
import { SYSTEM_URLS } from '@/config/urls';

interface DeployAsApiProps {
  selectedFlowId: string | null;
  groupNodeId: string;
  setActivePanel: (panel: string | null) => void;
}

function DeployAsApi({
  selectedFlowId,
  groupNodeId,
  setActivePanel,
}: DeployAsApiProps) {
  const { getNodes, getNode, getEdges, setNodes } = useReactFlow();

  // 使用新的 UserServersContext 和 ServerOperations
  const { getServicesByWorkspace, addApiService, removeApiService } =
    useServers();

  const serverOperations = useServerOperations();
  const { workspaces } = useWorkspaces();
  const { isLocalDeployment, getAuthHeaders } = useAppSettings();

  // 添加必要的hooks
  const { getSourceNodeIdWithLabel, getTargetNodeIdWithLabel } =
    useGetSourceTarget();
  const {
    streamResult,
    streamResultForMultipleNodes,
    reportError,
    resetLoadingUI,
  } = useJsonConstructUtils();
  const { clearAll } = useNodesPerFlowContext();

  // 简化的本地状态管理
  const [selectedInputs, setSelectedInputs] = useState<string[]>([]);
  const [selectedOutputs, setSelectedOutputs] = useState<string[]>([]);
  const [isDeploying, setIsDeploying] = useState<boolean>(false);
  const [deploySuccess, setDeploySuccess] = useState<boolean>(false);

  // 获取当前工作区名称
  const currentWorkspace = workspaces.find(
    w => w.workspace_id === selectedFlowId
  );
  const workspaceName = currentWorkspace?.workspace_name || 'Unknown Workspace';

  // 获取当前已部署的 API
  const { apis } = getServicesByWorkspace(selectedFlowId || '');
  const currentApi = apis.find(api => api.workspace_id === selectedFlowId);
  const isDeployed = currentApi !== null;

  // 使用构建器
  const { buildEdgeNodeJson } = useEdgeNodeBackEndJsonBuilder();
  const { buildBlockNodeJson } = useBlockNodeBackEndJsonBuilder();

  // 统一管理 API Server URL
  const API_SERVER_URL = SYSTEM_URLS.API_SERVER.BASE;

  // 初始化引用
  const initializedRef = useRef<boolean>(false);

  // 修改：只支持 text 和 structured 类型
  const ALLOWED_BLOCK_TYPES = ['text', 'structured'];

  // 获取当前 group 内的所有支持的 block 节点
  const getGroupBlockNodes = () => {
    return getNodes().filter(node => {
      // 检查节点是否属于当前 group
      const groupIds = (node.data as any)?.groupIds;
      const isInGroup =
        Array.isArray(groupIds) && groupIds.includes(groupNodeId);

      // 检查是否是允许的 block 类型（只有 text 和 structured）
      const isBlockType = ALLOWED_BLOCK_TYPES.includes(node.type || '');

      return isInGroup && isBlockType;
    });
  };

  // 修改初始化节点选择逻辑 - 默认不选中任何节点
  const initializeNodeSelections = () => {
    // 不自动选择任何节点，让用户手动选择
    setSelectedInputs([]);
    setSelectedOutputs([]);
  };

  // 修改：构建工作流 JSON - 使用新的 buildGroupNodeJson 函数
  const constructWorkflowJson = () => {
    // 创建运行上下文
    const context: RunGroupNodeContext = {
      getNode,
      getNodes,
      setNodes,
      getSourceNodeIdWithLabel,
      getTargetNodeIdWithLabel,
      clearAll,
      streamResult,
      streamResultForMultipleNodes,
      reportError,
      resetLoadingUI,
      getAuthHeaders,
    };

    // 使用新的 buildGroupNodeJson 函数
    return buildGroupNodeJson({
      groupNodeId,
      context,
    });
  };

  // 使用新的 serverOperations 处理部署逻辑
  const handleDeploy = async () => {
    console.log('🚀 开始API部署流程...');

    if (!selectedFlowId) {
      console.error('缺少必要的部署参数');
      return;
    }

    console.log('✅ API部署参数验证通过');
    setIsDeploying(true);
    setDeploySuccess(false); // 重置成功状态

    try {
      const payload = {
        workflow_json: constructWorkflowJson(),
        inputs: selectedInputs,
        outputs: selectedOutputs,
        workspace_id: selectedFlowId,
      };

      // Get user token according to API documentation
      const userToken = serverOperations.getUserToken();

      // Build headers according to API documentation
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'x-user-token': `Bearer ${userToken || ''}`, // Use Bearer token authentication
      };

      console.log('🌐 开始调用API部署服务...', payload);
      const res = await fetch(`${API_SERVER_URL}/config_api`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        throw new Error(`部署失败: ${res.status}`);
      }

      const { api_id, api_key } = await res.json();
      console.log('✅ API部署成功，返回结果:', { api_id, api_key });

      // 如果是重新部署，先移除旧的 API
      if (currentApi) {
        console.log('🔄 检测到已有API，正在删除...');
        removeApiService(currentApi.api_id);
      }

      console.log('💾 开始保存API服务到context...');
      // 添加新的 API 服务到 context
      addApiService(
        {
          api_id,
          api_key,
          endpoint: `${API_SERVER_URL}/execute_workflow/${api_id}`,
          created_at: new Date().toISOString(),
          workspace_id: selectedFlowId,
          inputs: selectedInputs,
          outputs: selectedOutputs,
        },
        workspaceName
      );

      console.log('💾 API服务保存完成');

      console.log('🎉 设置API成功状态...');
      // 设置成功状态
      setDeploySuccess(true);
      console.log('✅ API成功状态已设置为true');

      // 3秒后自动清除成功状态
      setTimeout(() => {
        console.log('⏰ 清除API成功状态');
        setDeploySuccess(false);
      }, 3000);
    } catch (error) {
      console.error('❌ API部署失败:', error);
    } finally {
      console.log('🏁 API部署流程结束，设置loading为false');
      setIsDeploying(false);
    }
  };

  // 组件初始化
  useEffect(() => {
    if (!initializedRef.current && selectedFlowId) {
      initializedRef.current = true;

      // 如果状态为空，初始化所有节点
      if (selectedInputs.length === 0 && selectedOutputs.length === 0) {
        initializeNodeSelections();
      }
    }
  }, [selectedFlowId]);

  // 重置初始化状态当 flowId 改变时
  useEffect(() => {
    initializedRef.current = false;
  }, [selectedFlowId]);

  // 处理输入节点点击
  const handleInputClick = (node: any) => {
    const isSelected = selectedInputs.includes(node.id);
    if (isSelected) {
      setSelectedInputs(selectedInputs.filter(id => id !== node.id));
    } else {
      setSelectedInputs([...selectedInputs, node.id]);
    }
  };

  // 处理输出节点点击
  const handleOutputClick = (node: any) => {
    const isSelected = selectedOutputs.includes(node.id);
    if (isSelected) {
      setSelectedOutputs(selectedOutputs.filter(id => id !== node.id));
    } else {
      setSelectedOutputs([...selectedOutputs, node.id]);
    }
  };

  return (
    <div className='py-[16px] px-[16px] overflow-y-auto'>
      {/* 头部导航 */}
      <div className='flex items-center mb-4'>
        <button
          className='mr-2 p-1 rounded-full hover:bg-[#2A2A2A]'
          onClick={() => setActivePanel(null)}
        >
          <svg
            className='w-5 h-5'
            fill='#CDCDCD'
            viewBox='0 0 20 20'
            xmlns='http://www.w3.org/2000/svg'
          >
            <path
              fillRule='evenodd'
              d='M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z'
              clipRule='evenodd'
            />
          </svg>
        </button>
        <h2 className='text-[#CDCDCD] text-[16px]'>Deploy as API</h2>
      </div>

      {/* 输入输出节点选择区域 */}
      <div className='grid grid-cols-2 gap-0 mb-8 rounded-lg overflow-hidden border border-[#404040]'>
        {/* 输入节点区域 */}
        <div className='p-4 bg-[#1A1A1A]'>
          <h3 className='text-[#CDCDCD] text-[14px] mb-4 border-b border-[#333333] pb-2'>
            <div className='flex items-center justify-between'>
              <span>Inputs</span>
            </div>
            <div className='flex items-center mt-2 gap-2'>
              <span className='text-[12px] text-[#808080]'>
                from group blocks:
              </span>
              <div className='flex items-center gap-1'>
                <div
                  className='flex items-center bg-[#252525] px-[4px] py-[4px] rounded-md border border-[#3B9BFF]/30 hover:border-[#3B9BFF]/50 transition-colors cursor-help'
                  title='Text Block'
                >
                  <svg
                    width='14'
                    height='14'
                    viewBox='0 0 20 24'
                    fill='none'
                    xmlns='http://www.w3.org/2000/svg'
                    className='text-[#3B9BFF]'
                  >
                    <path
                      d='M3 8H17'
                      className='stroke-current'
                      strokeWidth='1.5'
                      strokeLinecap='round'
                    />
                    <path
                      d='M3 12H15'
                      className='stroke-current'
                      strokeWidth='1.5'
                      strokeLinecap='round'
                    />
                    <path
                      d='M3 16H13'
                      className='stroke-current'
                      strokeWidth='1.5'
                      strokeLinecap='round'
                    />
                  </svg>
                </div>
                <div
                  className='flex items-center bg-[#252525] px-[4px] py-[4px] rounded-md border border-[#9B7EDB]/30 hover:border-[#9B7EDB]/50 transition-colors cursor-help'
                  title='Structured Block'
                >
                  <svg
                    width='14'
                    height='14'
                    viewBox='0 0 24 24'
                    fill='none'
                    xmlns='http://www.w3.org/2000/svg'
                    className='text-[#9B7EDB]'
                  >
                    <path
                      d='M8 6.5V5H4V7.5V16.5V19H8V17.5H5.5V6.5H8Z'
                      className='fill-current'
                    />
                    <path
                      d='M16 6.5V5H20V7.5V16.5V19H16V17.5H18.5V6.5H16Z'
                      className='fill-current'
                    />
                    <path d='M9 9H11V11H9V9Z' className='fill-current' />
                    <path d='M9 13H11V15H9V13Z' className='fill-current' />
                    <path d='M13 9H15V11H13V9Z' className='fill-current' />
                    <path d='M13 13H15V15H13V13Z' className='fill-current' />
                  </svg>
                </div>
              </div>
            </div>
          </h3>

          <div className='space-y-3 text-[14px] font-medium'>
            {getGroupBlockNodes().map(node => {
              const isSelected = selectedInputs.includes(node.id);
              const nodeType = node.type || 'text';

              const colorClasses = {
                text: {
                  active: 'bg-[#3B9BFF]/20 border-[#3B9BFF] text-[#3B9BFF]',
                  default:
                    'bg-[#252525] border-[#404040] text-[#CDCDCD] hover:border-[#3B9BFF]/80 hover:bg-[#3B9BFF]/5',
                },
                structured: {
                  active: 'bg-[#9B7EDB]/20 border-[#9B7EDB] text-[#9B7EDB]',
                  default:
                    'bg-[#252525] border-[#404040] text-[#CDCDCD] hover:border-[#9B7EDB]/80 hover:bg-[#9B7EDB]/5',
                },
              };

              const nodeIcons = {
                text: (
                  <svg
                    width='12'
                    height='12'
                    viewBox='0 0 20 24'
                    fill='none'
                    xmlns='http://www.w3.org/2000/svg'
                    className='group mr-2'
                  >
                    <path
                      d='M3 8H17'
                      className='stroke-current'
                      strokeWidth='1.5'
                      strokeLinecap='round'
                    />
                    <path
                      d='M3 12H15'
                      className='stroke-current'
                      strokeWidth='1.5'
                      strokeLinecap='round'
                    />
                    <path
                      d='M3 16H13'
                      className='stroke-current'
                      strokeWidth='1.5'
                      strokeLinecap='round'
                    />
                  </svg>
                ),
                structured: (
                  <svg
                    width='12'
                    height='12'
                    viewBox='0 0 24 24'
                    fill='none'
                    xmlns='http://www.w3.org/2000/svg'
                    className='group mr-2'
                  >
                    <path
                      d='M8 6.5V5H4V7.5V16.5V19H8V17.5H5.5V6.5H8Z'
                      className='fill-current'
                    />
                    <path
                      d='M16 6.5V5H20V7.5V16.5V19H16V17.5H18.5V6.5H16Z'
                      className='fill-current'
                    />
                    <path d='M9 9H11V11H9V9Z' className='fill-current' />
                    <path d='M9 13H11V15H9V13Z' className='fill-current' />
                    <path d='M13 9H15V11H13V9Z' className='fill-current' />
                    <path d='M13 13H15V15H13V13Z' className='fill-current' />
                  </svg>
                ),
              };

              return (
                <div
                  key={node.id}
                  className={`h-[26px] border-[1.5px] pl-[8px] pr-[8px] rounded-lg flex items-center transition-all cursor-pointer ${
                    isSelected
                      ? colorClasses[nodeType as keyof typeof colorClasses]
                          ?.active || colorClasses.text.active
                      : colorClasses[nodeType as keyof typeof colorClasses]
                          ?.default || colorClasses.text.default
                  }`}
                  onClick={() => handleInputClick(node)}
                >
                  {nodeIcons[nodeType as keyof typeof nodeIcons] ||
                    nodeIcons.text}
                  <span className='flex-shrink-0 text-[12px]'>
                    {(node.data.label as string) || node.id}
                  </span>
                  {isSelected && (
                    <div className='flex ml-auto h-[20px] w-[20px] justify-center items-center'>
                      <svg
                        width='14'
                        height='14'
                        viewBox='0 0 24 24'
                        fill='none'
                        xmlns='http://www.w3.org/2000/svg'
                      >
                        <path
                          d='M5 12L10 17L19 8'
                          stroke='currentColor'
                          strokeWidth='2'
                          strokeLinecap='round'
                          strokeLinejoin='round'
                        />
                      </svg>
                    </div>
                  )}
                </div>
              );
            })}

            {getGroupBlockNodes().length === 0 && (
              <div className='text-[12px] text-[#808080] py-2 text-center'>
                No text or structured blocks in this group. Add nodes to the
                group first.
              </div>
            )}
          </div>
        </div>

        {/* 输出节点区域 */}
        <div className='p-4 bg-[#1A1A1A] border-l border-[#404040]'>
          <h3 className='text-[#CDCDCD] text-[14px] mb-4 border-b border-[#333333] pb-2'>
            <div className='flex items-center justify-between'>
              <span>Outputs</span>
            </div>
            <div className='flex items-center mt-2 gap-2'>
              <span className='text-[12px] text-[#808080]'>
                from group blocks:
              </span>
              <div className='flex items-center gap-1'>
                <div
                  className='flex items-center bg-[#252525] px-[4px] py-[4px] rounded-md border border-[#3B9BFF]/30 hover:border-[#3B9BFF]/50 transition-colors cursor-help'
                  title='Text Block'
                >
                  <svg
                    width='14'
                    height='14'
                    viewBox='0 0 20 24'
                    fill='none'
                    xmlns='http://www.w3.org/2000/svg'
                    className='text-[#3B9BFF]'
                  >
                    <path
                      d='M3 8H17'
                      className='stroke-current'
                      strokeWidth='1.5'
                      strokeLinecap='round'
                    />
                    <path
                      d='M3 12H15'
                      className='stroke-current'
                      strokeWidth='1.5'
                      strokeLinecap='round'
                    />
                    <path
                      d='M3 16H13'
                      className='stroke-current'
                      strokeWidth='1.5'
                      strokeLinecap='round'
                    />
                  </svg>
                </div>
                <div
                  className='flex items-center bg-[#252525] px-[4px] py-[4px] rounded-md border border-[#9B7EDB]/30 hover:border-[#9B7EDB]/50 transition-colors cursor-help'
                  title='Structured Block'
                >
                  <svg
                    width='14'
                    height='14'
                    viewBox='0 0 24 24'
                    fill='none'
                    xmlns='http://www.w3.org/2000/svg'
                    className='text-[#9B7EDB]'
                  >
                    <path
                      d='M8 6.5V5H4V7.5V16.5V19H8V17.5H5.5V6.5H8Z'
                      className='fill-current'
                    />
                    <path
                      d='M16 6.5V5H20V7.5V16.5V19H16V17.5H18.5V6.5H16Z'
                      className='fill-current'
                    />
                    <path d='M9 9H11V11H9V9Z' className='fill-current' />
                    <path d='M9 13H11V15H9V13Z' className='fill-current' />
                    <path d='M13 9H15V11H13V9Z' className='fill-current' />
                    <path d='M13 13H15V15H13V13Z' className='fill-current' />
                  </svg>
                </div>
              </div>
            </div>
          </h3>

          <div className='space-y-3 text-[14px] font-medium'>
            {getGroupBlockNodes().map(node => {
              const isSelected = selectedOutputs.includes(node.id);
              const nodeType = node.type || 'text';

              const colorClasses = {
                text: {
                  active: 'bg-[#3B9BFF]/20 border-[#3B9BFF] text-[#3B9BFF]',
                  default:
                    'bg-[#252525] border-[#404040] text-[#CDCDCD] hover:border-[#3B9BFF]/80 hover:bg-[#3B9BFF]/5',
                },
                structured: {
                  active: 'bg-[#9B7EDB]/20 border-[#9B7EDB] text-[#9B7EDB]',
                  default:
                    'bg-[#252525] border-[#404040] text-[#CDCDCD] hover:border-[#9B7EDB]/80 hover:bg-[#9B7EDB]/5',
                },
              };

              const nodeIcons = {
                text: (
                  <svg
                    width='12'
                    height='12'
                    viewBox='0 0 20 24'
                    fill='none'
                    xmlns='http://www.w3.org/2000/svg'
                    className='group mr-2'
                  >
                    <path
                      d='M3 8H17'
                      className='stroke-current'
                      strokeWidth='1.5'
                      strokeLinecap='round'
                    />
                    <path
                      d='M3 12H15'
                      className='stroke-current'
                      strokeWidth='1.5'
                      strokeLinecap='round'
                    />
                    <path
                      d='M3 16H13'
                      className='stroke-current'
                      strokeWidth='1.5'
                      strokeLinecap='round'
                    />
                  </svg>
                ),
                structured: (
                  <svg
                    width='12'
                    height='12'
                    viewBox='0 0 24 24'
                    fill='none'
                    xmlns='http://www.w3.org/2000/svg'
                    className='group mr-2'
                  >
                    <path
                      d='M8 6.5V5H4V7.5V16.5V19H8V17.5H5.5V6.5H8Z'
                      className='fill-current'
                    />
                    <path
                      d='M16 6.5V5H20V7.5V16.5V19H16V17.5H18.5V6.5H16Z'
                      className='fill-current'
                    />
                    <path d='M9 9H11V11H9V9Z' className='fill-current' />
                    <path d='M9 13H11V15H9V13Z' className='fill-current' />
                    <path d='M13 9H15V11H13V9Z' className='fill-current' />
                    <path d='M13 13H15V15H13V13Z' className='fill-current' />
                  </svg>
                ),
              };

              return (
                <div
                  key={node.id}
                  className={`h-[26px] border-[1.5px] pl-[8px] pr-[8px] rounded-lg flex items-center transition-all cursor-pointer ${
                    isSelected
                      ? colorClasses[nodeType as keyof typeof colorClasses]
                          ?.active || colorClasses.text.active
                      : colorClasses[nodeType as keyof typeof colorClasses]
                          ?.default || colorClasses.text.default
                  }`}
                  onClick={() => handleOutputClick(node)}
                >
                  {nodeIcons[nodeType as keyof typeof nodeIcons] ||
                    nodeIcons.text}
                  <span className='flex-shrink-0 text-[12px]'>
                    {(node.data.label as string) || node.id}
                  </span>
                  {isSelected && (
                    <div className='flex ml-auto h-[20px] w-[20px] justify-center items-center'>
                      <svg
                        width='14'
                        height='14'
                        viewBox='0 0 24 24'
                        fill='none'
                        xmlns='http://www.w3.org/2000/svg'
                      >
                        <path
                          d='M5 12L10 17L19 8'
                          stroke='currentColor'
                          strokeWidth='2'
                          strokeLinecap='round'
                          strokeLinejoin='round'
                        />
                      </svg>
                    </div>
                  )}
                </div>
              );
            })}

            {getGroupBlockNodes().length === 0 && (
              <div className='text-[12px] text-[#808080] py-2 text-center'>
                No text or structured blocks in this group. Add nodes to the
                group first.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 部署按钮区域 */}
      <div className='pt-6 border-t border-[#404040]'>
        <div className='flex flex-col items-center text-center'>
          <div className='flex flex-col w-full items-center gap-4'>
            {!isDeployed && (
              <>
                {!(
                  selectedInputs?.length > 0 && selectedOutputs?.length > 0
                ) ? (
                  <span className='text-[#808080] text-[13px]'>
                    Please select input and output nodes first
                  </span>
                ) : (
                  <span className='text-[#808080] text-[13px]'>
                    Congrats! Your API is ready to be deployed.
                  </span>
                )}
              </>
            )}

            {!isDeployed ? (
              <button
                className={`w-[210px] h-[48px] rounded-[8px] transition duration-200 
                  flex items-center justify-center gap-2
                  ${
                    deploySuccess
                      ? 'bg-[#22C55E] text-white hover:bg-[#16A34A]' // 成功状态：绿色
                      : selectedInputs?.length > 0 &&
                          selectedOutputs?.length > 0
                        ? 'bg-[#FFA73D] text-black hover:bg-[#FF9B20] hover:scale-105'
                        : 'bg-[#2A2A2A] border-[1.5px] border-[#404040] text-[#808080] cursor-not-allowed opacity-50'
                  }`}
                onClick={handleDeploy}
                disabled={
                  !(
                    selectedInputs?.length > 0 && selectedOutputs?.length > 0
                  ) ||
                  isDeploying ||
                  deploySuccess
                }
              >
                {deploySuccess ? (
                  // 成功状态图标
                  <svg
                    className='w-5 h-5'
                    fill='currentColor'
                    viewBox='0 0 20 20'
                    xmlns='http://www.w3.org/2000/svg'
                  >
                    <path
                      fillRule='evenodd'
                      d='M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z'
                      clipRule='evenodd'
                    />
                  </svg>
                ) : isDeploying ? (
                  <svg
                    className='animate-spin h-5 w-5 text-black'
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
                    className='w-5 h-5'
                    fill='currentColor'
                    viewBox='0 0 20 20'
                    xmlns='http://www.w3.org/2000/svg'
                  >
                    <path
                      fillRule='evenodd'
                      d='M12.316 3.051a1 1 0 01.633 1.265l-4 12a1 1 0 11-1.898-.632l4-12a1 1 0 011.265-.633zM5.707 6.293a1 1 0 010 1.414L3.414 10l2.293 2.293a1 1 0 11-1.414 1.414l-3-3a1 1 0 010-1.414l3-3a1 1 0 011.414 0zm8.586 0a1 1 0 011.414 0l3 3a1 1 0 010 1.414l-3 3a1 1 0 11-1.414-1.414L16.586 10l-2.293-2.293a1 1 0 010-1.414z'
                      clipRule='evenodd'
                    />
                  </svg>
                )}
                {deploySuccess
                  ? 'Deploy Success ✅'
                  : isDeploying
                    ? 'Deploying...'
                    : 'Deploy as API'}
              </button>
            ) : (
              <>
                <div className='w-full flex flex-col gap-3'>
                  <div className='flex gap-3'>
                    <button
                      className={`flex-1 h-[48px] rounded-[8px] transition duration-200 
                        flex items-center justify-center gap-2
                        ${
                          deploySuccess
                            ? 'bg-[#22C55E] text-white hover:bg-[#16A34A]' // 成功状态：绿色
                            : 'bg-[#FFA73D] text-black hover:bg-[#FF9B20] hover:scale-105'
                        }`}
                      onClick={handleDeploy}
                      disabled={
                        !(
                          selectedInputs?.length > 0 &&
                          selectedOutputs?.length > 0
                        ) ||
                        isDeploying ||
                        deploySuccess
                      }
                    >
                      {deploySuccess ? (
                        // 成功状态图标
                        <svg
                          className='w-5 h-5'
                          fill='currentColor'
                          viewBox='0 0 20 20'
                          xmlns='http://www.w3.org/2000/svg'
                        >
                          <path
                            fillRule='evenodd'
                            d='M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z'
                            clipRule='evenodd'
                          />
                        </svg>
                      ) : isDeploying ? (
                        <svg
                          className='animate-spin h-5 w-5 text-black'
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
                          className='w-5 h-5'
                          fill='currentColor'
                          viewBox='0 0 20 20'
                          xmlns='http://www.w3.org/2000/svg'
                        >
                          <path
                            fillRule='evenodd'
                            d='M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z'
                            clipRule='evenodd'
                          />
                        </svg>
                      )}
                      {deploySuccess
                        ? 'Deploy Success'
                        : isDeploying
                          ? 'Updating...'
                          : 'Deploy'}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default DeployAsApi;
