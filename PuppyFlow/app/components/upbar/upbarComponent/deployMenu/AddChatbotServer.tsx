import React, { useEffect, useRef, useState } from 'react';
import { useReactFlow } from '@xyflow/react';
import ChatbotTestInterface from './ChatbotTestInterface';
import {
  useWorkspaceDeployedServices,
  useServers,
} from '@/app/components/states/UserServersContext';
import { useServerOperations } from '@/app/components/hooks/useServerManagement';
import { useWorkspaces } from '@/app/components/states/UserWorkspacesContext';
import { useEdgeNodeBackEndJsonBuilder } from '../../../workflow/edgesNode/edgeNodesNew/hook/hookhistory/useEdgeNodeBackEndJsonBuilder';
import { useBlockNodeBackEndJsonBuilder } from '../../../workflow/edgesNode/edgeNodesNew/hook/hookhistory/useBlockNodeBackEndJsonBuilder';
// Using same-origin BFF proxy for API server

interface DeployAsChatbotProps {
  selectedFlowId: string | null;
  setActivePanel: (panel: string | null) => void;
}

function DeployAsChatbot({
  selectedFlowId,
  setActivePanel,
}: DeployAsChatbotProps) {
  const { getNodes, getEdges } = useReactFlow();

  // 使用新的 context 和 hooks
  const { chatbots: deployedChatbots, isLoading: servicesLoading } =
    useWorkspaceDeployedServices(selectedFlowId || '');
  const { addChatbotService, removeChatbotService } = useServers();
  const { configChatbotService } = useServerOperations();
  const { workspaces } = useWorkspaces();

  // 构建器 hooks
  const { buildEdgeNodeJson } = useEdgeNodeBackEndJsonBuilder();
  const { buildBlockNodeJson } = useBlockNodeBackEndJsonBuilder();

  // 本地状态管理
  const [selectedInputs, setSelectedInputs] = useState<
    { id: string; label: string }[]
  >([]);
  const [selectedOutputs, setSelectedOutputs] = useState<
    { id: string; label: string }[]
  >([]);
  const [selectedChatHistory, setSelectedChatHistory] = useState<
    { id: string; label: string }[]
  >([]);
  const [chatbotConfig, setChatbotConfig] = useState({
    multiTurn: false,
    welcomeMessage: 'Hello! How can I help you today?',
  });
  const [activeTab, setActiveTab] = useState<'details' | 'bubble' | null>(null);
  const [showChatbotTest, setShowChatbotTest] = useState<boolean>(false);
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);

  // 部署状态
  const [isDeploying, setIsDeploying] = useState<boolean>(false);
  const [deployError, setDeployError] = useState<string | null>(null);

  // 获取当前已部署的聊天机器人
  const currentChatbot = deployedChatbots.find(
    chatbot => chatbot.workspace_id === selectedFlowId
  );
  const isDeployed = currentChatbot !== null;

  // 统一管理 API Server URL（同源代理）
  const API_SERVER_URL = '/api/server';

  // 初始化引用
  const initializedRef = useRef<boolean>(false);

  // 初始化节点选择
  const initializeNodeSelections = () => {
    const allInputNodes = getNodes()
      .filter(item => item.type === 'text')
      .filter(item => item.data?.isInput === true)
      .map(node => ({
        id: node.id,
        label: (node.data.label as string) || node.id,
      }));

    const allOutputNodes = getNodes()
      .filter(item => item.type === 'text')
      .filter(item => item.data?.isOutput === true)
      .map(node => ({
        id: node.id,
        label: (node.data.label as string) || node.id,
      }));

    // 新增：获取所有 structured 类型且具有 isInput 属性的节点作为聊天历史候选
    const allChatHistoryNodes = getNodes()
      .filter(item => item.type === 'structured')
      .filter(item => item.data?.isInput === true)
      .map(node => ({
        id: node.id,
        label: (node.data.label as string) || node.id,
      }));

    // 修改：只选择第一个输入和输出节点，而不是全选
    setSelectedInputs(allInputNodes.slice(0, 1)); // 只选择第一个输入节点
    setSelectedOutputs(allOutputNodes.slice(0, 1)); // 只选择第一个输出节点
    setSelectedChatHistory(allChatHistoryNodes.slice(0, 1)); // 默认选择第一个，聊天历史只允许一个
  };

  // 然后在 useEffect 中使用
  useEffect(() => {
    if (!initializedRef.current) {
      initializedRef.current = true;

      // 如果状态为空，初始化所有节点
      if (selectedInputs.length === 0 && selectedOutputs.length === 0) {
        initializeNodeSelections();
      }

      // 初始化聊天机器人部署设置
      if (selectedFlowId) {
        // ... existing code ...
      }
    }
  }, [selectedFlowId, initializeNodeSelections]);

  // 构建工作流 JSON 的函数
  const constructWorkflowJson = () => {
    const allNodes = getNodes();
    const reactFlowEdges = getEdges();

    // 创建blocks对象
    let blocks: { [key: string]: any } = {};
    let edges: { [key: string]: any } = {};

    // 定义哪些节点类型属于 block 节点
    const blockNodeTypes = ['text', 'file', 'weblink', 'structured'];

    // 处理所有节点
    allNodes.forEach(node => {
      const nodeId = node.id;
      // 确保 nodeLabel 是字符串类型
      const nodeLabel = node.data?.label || nodeId;

      // 根据节点类型决定如何构建JSON
      if (blockNodeTypes.includes(node.type || '')) {
        try {
          // 使用区块节点构建函数
          const blockJson = buildBlockNodeJson(nodeId);

          // 确保节点标签正确
          blocks[nodeId] = {
            ...blockJson,
            label: String(nodeLabel), // 确保 label 是字符串
          };
        } catch (e) {
          console.warn(`无法使用blockNodeBuilder构建节点 ${nodeId}:`, e);

          // 回退到默认行为
          blocks[nodeId] = {
            label: String(nodeLabel), // 确保 label 是字符串
            type: node.type || '',
            data: { ...node.data }, // 确保复制数据而不是引用
          };
        }
      } else {
        // 非 block 节点 (edge节点)
        try {
          // 构建边的JSON并添加到edges对象中
          const edgeJson = buildEdgeNodeJson(nodeId);
          edges[nodeId] = edgeJson;
        } catch (e) {
          console.warn(`无法构建边节点 ${nodeId} 的JSON:`, e);
        }
      }
    });

    return {
      blocks,
      edges,
    };
  };

  // 修改后的部署处理逻辑
  const handleDeploy = async () => {
    if (!selectedFlowId) {
      console.error('缺少必要的部署参数');
      return;
    }

    if (selectedInputs.length === 0 || selectedOutputs.length === 0) {
      console.error('请选择输入和输出节点');
      return;
    }

    setIsDeploying(true);
    setDeployError(null);

    try {
      // 构建工作流 JSON
      const workflow_json = constructWorkflowJson();

      // 构建部署参数
      const configParams = {
        workflow_json,
        input: selectedInputs[0].id,
        output: selectedOutputs[0].id,
        history:
          selectedChatHistory.length > 0 ? selectedChatHistory[0].id : null,
        workspace_id: selectedFlowId,
        multi_turn_enabled: chatbotConfig.multiTurn,
        welcome_message: chatbotConfig.welcomeMessage,
        integrations: {},
      };

      // 使用 hook 中的方法调用 API
      const { chatbot_id, chatbot_key, endpoint } =
        await configChatbotService(configParams);

      // 获取工作区名称
      const workspace = workspaces.find(w => w.workspace_id === selectedFlowId);
      const workspaceName = workspace?.workspace_name || 'Unknown Workspace';

      // 检查是否已有部署的聊天机器人（重新部署的情况）
      if (currentChatbot) {
        removeChatbotService(currentChatbot.chatbot_id);
      }

      // 添加新的聊天机器人服务到 context
      addChatbotService(
        {
          chatbot_id: chatbot_id,
          chatbot_key: chatbot_key,
          endpoint: endpoint || `${API_SERVER_URL}/api/${chatbot_id}`,
          created_at: new Date().toISOString(),
          workspace_id: selectedFlowId,
          input: selectedInputs[0].id,
          output: selectedOutputs[0].id,
          history:
            selectedChatHistory.length > 0 ? selectedChatHistory[0].id : null,
          multi_turn_enabled: chatbotConfig.multiTurn,
          welcome_message: chatbotConfig.welcomeMessage,
          config: {
            multiTurn: chatbotConfig.multiTurn,
            welcomeMessage: chatbotConfig.welcomeMessage,
            deployTo: 'chatbot',
          },
        },
        workspaceName
      );

      console.log(
        'Chatbot 部署成功，Chatbot Key 已存储到 context:',
        chatbot_key
      );
    } catch (error) {
      console.error('部署失败:', error);
      setDeployError(error instanceof Error ? error.message : '部署失败');
    } finally {
      setIsDeploying(false);
    }
  };

  // 处理输入节点点击 - 聊天机器人只允许一个输入
  const handleInputClick = (node: any) => {
    const isSelected = selectedInputs.some(item => item.id === node.id);

    if (isSelected) {
      setSelectedInputs([]);
    } else {
      setSelectedInputs([
        {
          id: node.id,
          label: (node.data.label as string) || node.id,
        },
      ]);
    }
  };

  // 处理输出节点点击 - 聊天机器人只允许一个输出
  const handleOutputClick = (node: any) => {
    const isSelected = selectedOutputs.some(item => item.id === node.id);

    if (isSelected) {
      setSelectedOutputs([]);
    } else {
      setSelectedOutputs([
        {
          id: node.id,
          label: (node.data.label as string) || node.id,
        },
      ]);
    }
  };

  // 切换多轮对话设置
  const toggleMultiTurn = () => {
    setChatbotConfig(prev => ({
      ...prev,
      multiTurn: !prev.multiTurn,
    }));
  };

  // 更新欢迎消息
  const updateWelcomeMessage = (message: string) => {
    setChatbotConfig(prev => ({
      ...prev,
      welcomeMessage: message,
    }));
  };

  // 修改：处理 tab 切换
  const handleTabSwitch = (tab: 'details' | 'bubble' | null) => {
    if (!isDeployed) return;
    setActiveTab(tab);
  };

  // 切换聊天机器人测试界面
  const toggleChatbotTest = (show: boolean) => {
    setShowChatbotTest(show);
  };

  // 添加处理聊天历史节点点击的函数
  const handleChatHistoryClick = (node: any) => {
    const isSelected = selectedChatHistory.some(item => item.id === node.id);

    if (isSelected) {
      setSelectedChatHistory([]);
    } else {
      setSelectedChatHistory([
        {
          id: node.id,
          label: (node.data.label as string) || node.id,
        },
      ]);
    }
  };

  const deploymentOptions = [
    // {
    //   id: 'webui',
    //   name: 'OpenWebUI',
    //   description: 'Chat interface for web browsers',
    //   icon: (
    //     <svg
    //       fill="currentColor"
    //       fillRule="evenodd"
    //       height="1em"
    //       width="1em"
    //       viewBox="0 0 24 24"
    //       xmlns="http://www.w3.org/2000/svg"
    //       className="mr-2"
    //     >
    //       <title>OpenWebUI</title>
    //       <path clipRule="evenodd" d="M17.697 12c0 4.97-3.962 9-8.849 9C3.962 21 0 16.97 0 12s3.962-9 8.848-9c4.887 0 8.849 4.03 8.849 9zm-3.636 0c0 2.928-2.334 5.301-5.213 5.301-2.878 0-5.212-2.373-5.212-5.301S5.97 6.699 8.848 6.699c2.88 0 5.213 2.373 5.213 5.301z"></path>
    //       <path d="M24 3h-3.394v18H24V3z"></path>
    //     </svg>
    //   )
    // },
    {
      id: 'puppychat',
      name: 'Puppy Chat',
      description: 'Deploy to PuppyChat platform',
      icon: (
        <svg
          width='16'
          height='16'
          viewBox='0 0 24 24'
          fill='none'
          xmlns='http://www.w3.org/2000/svg'
          className='mr-2'
        >
          <path
            d='M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C17.52 22 22 17.52 22 12C22 6.48 17.52 2 12 2ZM12 20C7.59 20 4 16.41 4 12C4 7.59 7.59 4 12 4C16.41 4 20 7.59 20 12C20 16.41 16.41 20 12 20Z'
            className='fill-current'
          />
          <path
            d='M8.5 10C9.33 10 10 9.33 10 8.5C10 7.67 9.33 7 8.5 7C7.67 7 7 7.67 7 8.5C7 9.33 7.67 10 8.5 10Z'
            className='fill-current'
          />
          <path
            d='M15.5 10C16.33 10 17 9.33 17 8.5C17 7.67 16.33 7 15.5 7C14.67 7 14 7.67 14 8.5C14 9.33 14.67 10 15.5 10Z'
            className='fill-current'
          />
          <path
            d='M12 17.5C14.33 17.5 16.31 16.04 17 14H7C7.69 16.04 9.67 17.5 12 17.5Z'
            className='fill-current'
          />
        </svg>
      ),
    },
    // {
    //   id: 'discord',
    //   name: 'Deploy to Discord',
    //   icon: (
    //     <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="mr-2">
    //       <path d="M20.317 4.492c-1.53-.69-3.17-1.2-4.885-1.49a.075.075 0 0 0-.079.036c-.21.369-.444.85-.608 1.23a18.566 18.566 0 0 0-5.487 0 12.36 12.36 0 0 0-.617-1.23A.077.077 0 0 0 8.562 3c-1.714.29-3.354.8-4.885 1.491a.07.07 0 0 0-.032.027C.533 9.093-.32 13.555.099 17.961a.08.08 0 0 0 .031.055 20.03 20.03 0 0 0 5.993 2.98.078.078 0 0 0 .084-.026 13.83 13.83 0 0 0 1.226-1.963.074.074 0 0 0-.041-.104 13.175 13.175 0 0 1-1.872-.878.075.075 0 0 1-.008-.125c.126-.093.252-.19.372-.287a.075.075 0 0 1 .078-.01c3.927 1.764 8.18 1.764 12.061 0a.075.075 0 0 1 .079.009c.12.098.245.195.372.288a.075.075 0 0 1-.006.125c-.598.344-1.22.635-1.873.877a.075.075 0 0 0-.041.105c.36.687.772 1.341 1.225 1.962a.077.077 0 0 0 .084.028 19.963 19.963 0 0 0 6.002-2.981.076.076 0 0 0 .032-.054c.5-5.094-.838-9.52-3.549-13.442a.06.06 0 0 0-.031-.028z" className="fill-current" />
    //     </svg>
    //   )
    // },
    // {
    //   id: 'slack',
    //   name: 'Deploy to Slack',
    //   icon: (
    //     <svg width="21" height="20" viewBox="0 0 21 20" fill="none" xmlns="http://www.w3.org/2000/svg" className="mr-2">
    //       <path d="M4.21948 12.6434C4.21948 13.8059 3.27998 14.7454 2.11755 14.7454C0.955122 14.7454 0.015625 13.8059 0.015625 12.6434C0.015625 11.481 0.955122 10.5415 2.11755 10.5415H4.21948V12.6434ZM5.27044 12.6434C5.27044 11.481 6.20994 10.5415 7.37237 10.5415C8.53479 10.5415 9.47429 11.481 9.47429 12.6434V17.8982C9.47429 19.0607 8.53479 20.0002 7.37237 20.0002C6.20994 20.0002 5.27044 19.0607 5.27044 17.8982V12.6434Z" className="fill-current" />
    //       <path d="M7.37266 4.20385C6.21024 3.26435 5.27074 2.10193 5.27074 2.10193C5.27074 0.939497 6.21024 0 7.37266 0C8.53509 0 9.47459 0.939497 9.47459 2.10193V4.20385H7.37266ZM7.37266 5.27074C8.53509 5.27074 9.47459 6.21024 9.47459 7.37267C9.47459 8.53509 8.53509 9.47459 7.37266 9.47459H2.10193C0.939497 9.47459 0 8.53509 0 7.37267C0 6.21024 0.939497 5.27074 2.10193 5.27074H7.37266Z" className="fill-current" />
    //       <path d="M15.7978 7.37267C15.7978 6.21024 16.7373 5.27074 17.8997 5.27074C19.0621 5.27074 20.0016 6.21024 20.0016 7.37267C20.0016 8.53509 19.0621 9.47459 17.8997 9.47459H15.7978V7.37267ZM14.7468 7.37267C14.7468 8.53509 13.8073 9.47459 12.6449 9.47459C11.4825 9.47459 10.543 8.53509 10.543 7.37267V2.10193C10.543 0.939497 11.4825 0 12.6449 0C13.8073 0 14.7468 0.939497 14.7468 2.10193V7.37267Z" className="fill-current" />
    //       <path d="M12.6449 15.7963C13.8073 15.7963 14.7468 16.7358 14.7468 17.8982C14.7468 19.0607 13.8073 20.0002 12.6449 20.0002C11.4825 20.0002 10.543 19.0607 10.543 17.8982V15.7963H12.6449ZM12.6449 14.7454C11.4825 14.7454 10.543 13.8059 10.543 12.6434C10.543 11.481 11.4825 10.5415 12.6449 10.5415H17.9156C19.0781 10.5415 20.0176 11.481 20.0176 12.6434C20.0176 13.8059 19.0781 14.7454 17.9156 14.7454H12.6449Z" className="fill-current" />
    //     </svg>
    //   )
    // },
    {
      id: 'bubble',
      name: 'Web Bubble',
      description: 'Add a chat bubble to your website',
      icon: (
        <svg
          width='16'
          height='16'
          viewBox='0 0 24 24'
          fill='none'
          xmlns='http://www.w3.org/2000/svg'
          className='mr-2'
        >
          <rect
            x='2'
            y='2'
            width='20'
            height='16'
            rx='2'
            className='stroke-current'
            strokeWidth='1.5'
            fill='none'
          />
          <path d='M2 6h20' className='stroke-current' strokeWidth='1.5' />
          <circle cx='4.5' cy='4' r='0.75' className='fill-current' />
          <circle cx='7.5' cy='4' r='0.75' className='fill-current' />
          <circle cx='10.5' cy='4' r='0.75' className='fill-current' />
          <circle cx='19.5' cy='18' r='4.5' className='fill-current' />
        </svg>
      ),
    },
  ];

  return (
    <div className='py-[16px] px-[16px] max-h-[80vh] overflow-y-auto'>
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
        <h2 className='text-[#CDCDCD] text-[16px]'>Deploy as Chatbot</h2>
      </div>

      <div className='grid grid-cols-2 gap-0 mb-8 rounded-lg overflow-hidden border border-[#404040]'>
        <div className='p-4 bg-[#1A1A1A]'>
          <h3 className='text-[#CDCDCD] text-[14px] mb-4 border-b border-[#333333] pb-2'>
            <div className='flex items-center justify-between'>
              <span>User Messages</span>
            </div>
            <div className='flex items-center mt-2 gap-2'>
              <span className='text-[12px] text-[#808080]'>type:</span>
              <div className='flex items-center bg-[#252525] px-[4px] py-[4px] rounded-md border border-[#404040]'>
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
            </div>
          </h3>

          <div className='space-y-3 text-[14px] font-medium max-h-[160px] overflow-y-auto pr-1'>
            {getNodes()
              .filter(item => item.type === 'text')
              .filter(item => item.data?.isInput === true)
              .map(node => {
                const isSelected = selectedInputs?.some(
                  item => item.id === node.id
                );
                const nodeType = node.type || 'text';

                // 为不同类型的节点定义颜色
                const colorClasses = {
                  text: {
                    active: 'bg-[#3B9BFF]/20 border-[#3B9BFF] text-[#3B9BFF]',
                    default:
                      'bg-[#252525] border-[#404040] text-[#CDCDCD] hover:border-[#3B9BFF]/80 hover:bg-[#3B9BFF]/5',
                  },
                  block: {
                    active: 'bg-[#9E7E5F]/20 border-[#9E7E5F] text-[#9E7E5F]',
                    default:
                      'bg-[#252525] border-[#404040] text-[#CDCDCD] hover:border-[#9E7E5F]/80 hover:bg-[#9E7E5F]/5',
                  },
                  structured: {
                    active: 'bg-[#9B7EDB]/20 border-[#9B7EDB] text-[#9B7EDB]',
                    default:
                      'bg-[#252525] border-[#404040] text-[#CDCDCD] hover:border-[#9B7EDB]/80 hover:bg-[#9B7EDB]/5',
                  },
                };

                // 为不同类型的节点定义图标
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
                  block: (
                    <svg
                      width='12'
                      height='12'
                      viewBox='0 0 24 24'
                      fill='none'
                      xmlns='http://www.w3.org/2000/svg'
                      className='group mr-2'
                    >
                      <path
                        d='M4 6H10L12 8H20V18H4V6Z'
                        className='fill-transparent stroke-current'
                        strokeWidth='1.5'
                      />
                      <path
                        d='M8 13.5H16'
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
          </div>
        </div>

        <div className='p-4 bg-[#1A1A1A] border-l border-[#404040]'>
          <h3 className='text-[#CDCDCD] text-[14px] mb-4 border-b border-[#333333] pb-2'>
            <div className='flex items-center justify-between'>
              <span>Bot Responses</span>
            </div>
            <div className='flex items-center mt-2 gap-2'>
              <span className='text-[12px] text-[#808080]'>type:</span>
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
            </div>
          </h3>

          <div className='space-y-3 text-[14px] font-medium max-h-[160px] overflow-y-auto pr-1'>
            {getNodes()
              .filter(item => item.type === 'text')
              .filter(item => item.data?.isOutput === true)
              .map(node => {
                const isSelected = selectedOutputs?.some(
                  item => item.id === node.id
                );
                const nodeType = node.type || 'text';

                // 为不同类型的节点定义颜色
                const colorClasses = {
                  text: {
                    active: 'bg-[#3B9BFF]/20 border-[#3B9BFF] text-[#3B9BFF]',
                    default:
                      'bg-[#252525] border-[#404040] text-[#CDCDCD] hover:border-[#3B9BFF]/80 hover:bg-[#3B9BFF]/5',
                  },
                  block: {
                    active: 'bg-[#9E7E5F]/20 border-[#9E7E5F] text-[#9E7E5F]',
                    default:
                      'bg-[#252525] border-[#404040] text-[#CDCDCD] hover:border-[#9E7E5F]/80 hover:bg-[#9E7E5F]/5',
                  },
                  structured: {
                    active: 'bg-[#9B7EDB]/20 border-[#9B7EDB] text-[#9B7EDB]',
                    default:
                      'bg-[#252525] border-[#404040] text-[#CDCDCD] hover:border-[#9B7EDB]/80 hover:bg-[#9B7EDB]/5',
                  },
                };

                // 为不同类型的节点定义图标
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
                  block: (
                    <svg
                      width='12'
                      height='12'
                      viewBox='0 0 24 24'
                      fill='none'
                      xmlns='http://www.w3.org/2000/svg'
                      className='group mr-2'
                    >
                      <path
                        d='M4 6H10L12 8H20V18H4V6Z'
                        className='fill-transparent stroke-current'
                        strokeWidth='1.5'
                      />
                      <path
                        d='M8 13.5H16'
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
          </div>
        </div>
      </div>

      <div className='mb-6'>
        <button
          onClick={() => setIsAdvancedOpen(!isAdvancedOpen)}
          className='w-full flex items-center justify-between text-[#CDCDCD] text-[14px] mb-2 hover:text-white'
        >
          <span className='flex items-center'>
            <svg
              className={`w-4 h-4 mr-2 transition-transform ${isAdvancedOpen ? 'rotate-90' : ''}`}
              fill='currentColor'
              viewBox='0 0 20 20'
            >
              <path
                fillRule='evenodd'
                d='M7.293 4.707a1 1 0 011.414 0l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414-1.414L10.586 10 7.293 6.707a1 1 0 010-1.414z'
                clipRule='evenodd'
              />
            </svg>
            Chatbot Settings
          </span>
        </button>

        <div
          className={`overflow-hidden transition-all duration-200 ${isAdvancedOpen ? 'max-h-[500px] opacity-100' : 'max-h-0 opacity-0'}`}
        >
          <div className='space-y-4 pt-2'>
            <div className='flex items-center justify-between'>
              <label className='text-[#CDCDCD] text-[14px]'>
                Enable Multi-turn Dialogue
              </label>
              <button
                className={`w-12 h-6 rounded-full transition-colors duration-200 ${
                  chatbotConfig.multiTurn ? 'bg-[#3B9BFF]' : 'bg-[#404040]'
                }`}
                onClick={toggleMultiTurn}
              >
                <div
                  className={`w-5 h-5 rounded-full bg-white transform transition-transform duration-200 ${
                    chatbotConfig.multiTurn ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            {chatbotConfig.multiTurn && (
              <div className='grid grid-cols-2 gap-0 rounded-lg overflow-hidden border border-[#404040]'>
                <div className='p-4 bg-[#1A1A1A]'>
                  <h3 className='text-[#CDCDCD] text-[14px] mb-4 border-b border-[#333333] pb-2'>
                    <div className='flex items-center justify-between'>
                      <span>Chat History</span>
                    </div>
                    <div className='flex items-center mt-2 gap-2'>
                      <span className='text-[12px] text-[#808080]'>type:</span>
                      <div className='flex items-center bg-[#252525] px-[4px] py-[4px] rounded-md border border-[#404040]'>
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
                          <path
                            d='M9 13H11V15H9V13Z'
                            className='fill-current'
                          />
                          <path
                            d='M13 9H15V11H13V9Z'
                            className='fill-current'
                          />
                          <path
                            d='M13 13H15V15H13V13Z'
                            className='fill-current'
                          />
                        </svg>
                      </div>
                    </div>
                  </h3>

                  <div className='space-y-3 text-[14px] font-medium max-h-[160px] overflow-y-auto pr-1'>
                    {getNodes()
                      .filter(item => item.type === 'structured')
                      .filter(item => item.data?.isInput === true)
                      .map(node => {
                        const isSelected = selectedChatHistory?.some(
                          item => item.id === node.id
                        );

                        return (
                          <div
                            key={node.id}
                            className={`h-[26px] border-[1.5px] pl-[8px] pr-[8px] rounded-lg flex items-center transition-all cursor-pointer ${
                              isSelected
                                ? 'bg-[#9B7EDB]/20 border-[#9B7EDB] text-[#9B7EDB]'
                                : 'bg-[#252525] border-[#404040] text-[#CDCDCD] hover:border-[#9B7EDB]/80 hover:bg-[#9B7EDB]/5'
                            }`}
                            onClick={() => handleChatHistoryClick(node)}
                          >
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
                              <path
                                d='M9 9H11V11H9V9Z'
                                className='fill-current'
                              />
                              <path
                                d='M9 13H11V15H9V13Z'
                                className='fill-current'
                              />
                              <path
                                d='M13 9H15V11H13V9Z'
                                className='fill-current'
                              />
                              <path
                                d='M13 13H15V15H13V13Z'
                                className='fill-current'
                              />
                            </svg>
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

                    {getNodes()
                      .filter(item => item.type === 'structured')
                      .filter(item => item.data?.isInput === true).length ===
                      0 && (
                      <div className='text-[12px] text-[#808080] italic py-2 text-center'>
                        No structured input blocks available
                      </div>
                    )}
                  </div>
                </div>

                {/* 右侧空白区域，可以添加说明文字 */}
                <div className='p-4 bg-[#1A1A1A] border-l border-[#404040] flex items-center justify-center'>
                  <div className='text-center text-[#808080]'></div>
                </div>
              </div>
            )}

            <div>
              <label className='block text-[#CDCDCD] text-[14px] mb-2'>
                Welcome Message
              </label>
              <input
                type='text'
                value={chatbotConfig.welcomeMessage}
                onChange={e => updateWelcomeMessage(e.target.value)}
                className='w-full bg-[#2A2A2A] border-[1px] border-[#404040] rounded-[8px] px-3 py-2 text-[14px] text-[#CDCDCD]'
              />
            </div>
          </div>
        </div>
      </div>

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
                    Congrats! Your chatbot is ready to be deployed.
                    {chatbotConfig.multiTurn &&
                      selectedChatHistory?.length > 0 && (
                        <span className='block text-[#9B7EDB] text-[12px] mt-1'>
                          ✓ Chat history will be stored in:{' '}
                          {selectedChatHistory[0].label}
                        </span>
                      )}
                    {chatbotConfig.multiTurn &&
                      selectedChatHistory?.length === 0 && (
                        <span className='block text-[#808080] text-[11px] mt-1'>
                          💡 Consider selecting a chat history storage for
                          better conversations
                        </span>
                      )}
                  </span>
                )}
              </>
            )}

            {!isDeployed ? (
              <button
                className={`w-[210px] h-[48px] rounded-[8px] transition duration-200 
                  flex items-center justify-center gap-2
                  ${
                    selectedInputs?.length > 0 && selectedOutputs?.length > 0
                      ? 'bg-[#FFA73D] text-black hover:bg-[#FF9B20] hover:scale-105'
                      : 'bg-[#2A2A2A] border-[1.5px] border-[#404040] text-[#808080] cursor-not-allowed opacity-50'
                  }`}
                onClick={handleDeploy}
                disabled={
                  !(
                    selectedInputs?.length > 0 && selectedOutputs?.length > 0
                  ) || isDeploying
                }
              >
                {isDeploying ? (
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
                    <path d='M2 5a2 2 0 012-2h7a2 2 0 012 2v4a2 2 0 01-2 2H9l-3 3v-3H4a2 2 0 01-2-2V5z' />
                    <path d='M15 7v2a4 4 0 01-4 4H9.828l-1.766 1.767c.28.149.599.233.938.233h2l3 3v-3h2a2 2 0 002-2V9a2 2 0 00-2-2h-1z' />
                  </svg>
                )}
                {isDeploying ? 'Deploying...' : 'Deploy as Chatbot'}
              </button>
            ) : (
              <>
                <div className='w-full flex flex-col gap-3'>
                  {/* 第一行：Redeploy 和 Delete 按钮 */}
                  <div className='flex gap-3'>
                    <button
                      className='flex-1 h-[48px] rounded-[8px] transition duration-200 
                        flex items-center justify-center gap-2
                        bg-[#FFA73D] text-black hover:bg-[#FF9B20] hover:scale-105'
                      onClick={handleDeploy}
                      disabled={
                        !(
                          selectedInputs?.length > 0 &&
                          selectedOutputs?.length > 0
                        ) || isDeploying
                      }
                    >
                      {isDeploying ? (
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
                            d='M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z'
                            clipRule='evenodd'
                          />
                        </svg>
                      )}
                      {isDeploying ? 'Updating...' : 'Deploy'}
                    </button>
                  </div>

                  {/* 第二行：Test 按钮 */}
                  <button
                    className='w-full h-[48px] rounded-[8px] transition duration-200 
                      flex items-center justify-center gap-2
                      bg-[#3B9BFF] text-white hover:bg-[#2980B9] hover:scale-105'
                    onClick={() => toggleChatbotTest(true)}
                  >
                    <svg
                      className='w-5 h-5'
                      viewBox='0 0 24 24'
                      fill='none'
                      xmlns='http://www.w3.org/2000/svg'
                    >
                      <path
                        d='M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12Z'
                        stroke='currentColor'
                        strokeWidth='2'
                      />
                      <path
                        d='M9 12L11 14L15 10'
                        stroke='currentColor'
                        strokeWidth='2'
                        strokeLinecap='round'
                        strokeLinejoin='round'
                      />
                    </svg>
                    Test Chatbot
                  </button>
                </div>

                {showChatbotTest && currentChatbot && (
                  <ChatbotTestInterface
                    apiEndpoint={currentChatbot.endpoint || API_SERVER_URL}
                    chatbotId={currentChatbot.chatbot_id || ''}
                    apiKey={currentChatbot.chatbot_key || ''}
                    onClose={() => toggleChatbotTest(false)}
                    input={
                      selectedInputs.length > 0
                        ? selectedInputs[0].id
                        : undefined
                    }
                    output={
                      selectedOutputs.length > 0
                        ? selectedOutputs[0].id
                        : undefined
                    }
                    history={
                      chatbotConfig.multiTurn && selectedChatHistory.length > 0
                        ? selectedChatHistory[0].id
                        : undefined
                    }
                  />
                )}
              </>
            )}

            <div className='mt-4 w-full'>
              {/* 只在已部署时显示 tab 选项和内容 */}
              {isDeployed && currentChatbot && (
                <>
                  {/* Tab 选择器 */}
                  <div className='flex gap-4 justify-center mb-4'>
                    <div
                      className={`flex flex-col items-center cursor-pointer transition duration-200 hover:scale-105`}
                      style={{ width: '80px' }}
                      onClick={() => handleTabSwitch('details')}
                    >
                      <div
                        className={`w-[48px] h-[48px] rounded-[8px] transition duration-200 
                          flex items-center justify-center
                          hover:bg-[#252525] hover:shadow-md
                          bg-[#1A1A1A] border border-[#404040]
                          ${
                            activeTab === 'details'
                              ? 'border-[#3B9BFF] text-[#3B9BFF] bg-[#3B9BFF]/10'
                              : 'text-[#CDCDCD] hover:border-[#505050]'
                          }`}
                      >
                        <svg
                          width='24'
                          height='24'
                          viewBox='0 0 24 24'
                          fill='none'
                          xmlns='http://www.w3.org/2000/svg'
                        >
                          <path
                            d='M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C17.52 22 22 17.52 22 12C22 6.48 17.52 2 12 2ZM12 20C7.59 20 4 16.41 4 12C4 7.59 7.59 4 12 4C16.41 4 20 7.59 20 12C20 16.41 16.41 20 12 20Z'
                            className='fill-current'
                          />
                          <path
                            d='M8.5 10C9.33 10 10 9.33 10 8.5C10 7.67 9.33 7 8.5 7C7.67 7 7 7.67 7 8.5C7 9.33 7.67 10 8.5 10Z'
                            className='fill-current'
                          />
                          <path
                            d='M15.5 10C16.33 10 17 9.33 17 8.5C17 7.67 16.33 7 15.5 7C14.67 7 14 7.67 14 8.5C14 9.33 14.67 10 15.5 10Z'
                            className='fill-current'
                          />
                          <path
                            d='M12 17.5C14.33 17.5 16.31 16.04 17 14H7C7.69 16.04 9.67 17.5 12 17.5Z'
                            className='fill-current'
                          />
                        </svg>
                      </div>
                      <span className='text-[10px] leading-tight text-center mt-1 text-[#CDCDCD]'>
                        Chatbot Details
                      </span>
                    </div>

                    <div
                      className={`flex flex-col items-center cursor-pointer transition duration-200 hover:scale-105`}
                      style={{ width: '80px' }}
                      onClick={() => handleTabSwitch('bubble')}
                    >
                      <div
                        className={`w-[48px] h-[48px] rounded-[8px] transition duration-200 
                          flex items-center justify-center
                          hover:bg-[#252525] hover:shadow-md
                          bg-[#1A1A1A] border border-[#404040]
                          ${
                            activeTab === 'bubble'
                              ? 'border-[#3B9BFF] text-[#3B9BFF] bg-[#3B9BFF]/10'
                              : 'text-[#CDCDCD] hover:border-[#505050]'
                          }`}
                      >
                        <svg
                          width='24'
                          height='24'
                          viewBox='0 0 24 24'
                          fill='none'
                          xmlns='http://www.w3.org/2000/svg'
                        >
                          <rect
                            x='2'
                            y='2'
                            width='20'
                            height='16'
                            rx='2'
                            className='stroke-current'
                            strokeWidth='1.5'
                            fill='none'
                          />
                          <path
                            d='M2 6h20'
                            className='stroke-current'
                            strokeWidth='1.5'
                          />
                          <circle
                            cx='4.5'
                            cy='4'
                            r='0.75'
                            className='fill-current'
                          />
                          <circle
                            cx='7.5'
                            cy='4'
                            r='0.75'
                            className='fill-current'
                          />
                          <circle
                            cx='10.5'
                            cy='4'
                            r='0.75'
                            className='fill-current'
                          />
                          <circle
                            cx='19.5'
                            cy='18'
                            r='4.5'
                            className='fill-current'
                          />
                        </svg>
                      </div>
                      <span className='text-[10px] leading-tight text-center mt-1 text-[#CDCDCD]'>
                        Website Bubble
                      </span>
                    </div>
                  </div>

                  {/* Tab 内容区域 */}
                  {activeTab && (
                    <div className='py-3 px-4 bg-[#1A1A1A] rounded-[8px] border border-[#404040]'>
                      <div className='flex justify-between items-start'>
                        <span className='text-[14px] text-[#CDCDCD] font-medium'>
                          {activeTab === 'bubble'
                            ? 'Website Bubble Integration'
                            : 'Chatbot Details'}
                        </span>
                        <button
                          className='text-[12px] text-[#3B9BFF] hover:underline flex items-center'
                          onClick={() => handleTabSwitch(null)}
                        >
                          <svg
                            width='14'
                            height='14'
                            viewBox='0 0 24 24'
                            fill='none'
                            xmlns='http://www.w3.org/2000/svg'
                          >
                            <path
                              d='M6 18L18 6M6 6L18 18'
                              stroke='currentColor'
                              strokeWidth='2'
                              strokeLinecap='round'
                              strokeLinejoin='round'
                            />
                          </svg>
                          <span className='ml-1'>Close</span>
                        </button>
                      </div>

                      {activeTab === 'bubble' ? (
                        <div className='mt-3'>
                          <code className='block p-2 mt-2 bg-[#252525] rounded text-[12px] text-[#CDCDCD] overflow-x-auto max-h-[200px] overflow-y-auto'>
                            <pre className='text-left whitespace-pre'>
                              {`import { ChatBubbleDeployed } from 'puppychat';

// Add this component to your React app
<ChatBubbleDeployed
  chatbotId="${currentChatbot?.chatbot_id || 'your_chatbot_id'}"
  baseUrl="${currentChatbot?.endpoint?.replace('/api/' + (currentChatbot?.chatbot_id || ''), '') || API_SERVER_URL}"
  chatbotKey="${currentChatbot?.chatbot_key || 'your_chatbot_key'}"
  inputBlockId="${selectedInputs?.[0]?.id || 'input_block'}"${
    chatbotConfig.multiTurn && selectedChatHistory?.[0]?.id
      ? `
  historyBlockId="${selectedChatHistory[0].id}"`
      : ''
  }
  chatProps={{
    title: "AI Assistant",
    placeholder: "Ask me anything...",
    welcomeMessage: "${chatbotConfig.welcomeMessage}",
    width: '400px',
    height: '600px',
    recommendedQuestions: [
      "Introduce your product",
      "Introduce your company",
      "Introduce your team",
    ]
  }}
  bubbleProps={{
    size: 64,
    pulseAnimation: true
  }}
  position="bottom-right"
  enableOverlay={true}
  overlayOpacity={0.3}
  animationDuration={300}
  enableFallback={true}
  
/>`}
                            </pre>
                          </code>
                        </div>
                      ) : (
                        <div className='mt-2 space-y-3'>
                          <div>
                            <label className='text-[12px] text-[#808080] '>
                              Chatbot Endpoint:
                            </label>
                            <code className='block p-2 mt-1 bg-[#252525] rounded text-[12px] text-[#CDCDCD] overflow-x-auto'>
                              {currentChatbot?.endpoint ||
                                `${API_SERVER_URL}/api/${currentChatbot?.chatbot_id || ''}`}
                            </code>
                          </div>

                          <div>
                            <label className='text-[12px] text-[#808080]'>
                              Chatbot ID:
                            </label>
                            <code className='block p-2 mt-1 bg-[#252525] rounded text-[12px] text-[#CDCDCD] overflow-x-auto'>
                              {currentChatbot?.chatbot_id || 'api_xxxxxxxxxxxx'}
                            </code>
                          </div>

                          <div>
                            <label className='text-[12px] text-[#808080]'>
                              Chatbot Key:
                            </label>
                            <div className='flex items-start'>
                              <div className='px-3 py-2 flex-grow bg-[#252525] rounded-md text-[12px] text-[#CDCDCD] font-mono overflow-x-auto'>
                                {currentChatbot?.chatbot_key ||
                                  'sk_xxxxxxxxxxxx'}
                              </div>
                              <button
                                className='ml-2 p-2 rounded-md hover:bg-[#2A2A2A]'
                                onClick={() => {
                                  navigator.clipboard.writeText(
                                    currentChatbot?.chatbot_key || ''
                                  );
                                }}
                              >
                                <svg
                                  className='w-4 h-4 text-[#CDCDCD]'
                                  fill='currentColor'
                                  viewBox='0 0 20 20'
                                  xmlns='http://www.w3.org/2000/svg'
                                >
                                  <path d='M8 2a1 1 0 000 2h2a1 1 0 100-2H8z' />
                                  <path d='M3 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v6h-4.586l1.293-1.293a1 1 0 00-1.414-1.414l-3 3a1 1 0 000 1.414l3 3a1 1 0 001.414-1.414L10.414 13H15v3a2 2 0 01-2 2H5a2 2 0 01-2-2V5zM15 11h2a1 1 0 110 2h-2v-2z' />
                                </svg>
                              </button>
                            </div>
                          </div>

                          <p className='text-[12px] text-[#808080] mt-3'>
                            Reference the example above to make API calls to
                            your endpoint
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 在部署按钮区域显示错误信息 */}
      {deployError && (
        <div className='mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-md'>
          <span className='text-red-400 text-[13px]'>{deployError}</span>
        </div>
      )}
    </div>
  );
}

export default DeployAsChatbot;
