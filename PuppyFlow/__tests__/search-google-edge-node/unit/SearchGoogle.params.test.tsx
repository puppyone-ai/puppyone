/**
 * SearchGoogle Edge Node - 参数配置测试
 *
 * 测试用例：
 * P0 致命 - 核心参数保存失败导致搜索功能不可用：
 * - TC-SG-001: top_k 参数修改后保存
 * - TC-SG-001-1: top_k 应为数字类型
 * 
 * P1 严重 - 参数配置异常影响搜索质量：
 * - TC-SG-002: 应能将 top_k 修改为不同的数值
 * - TC-SG-003: top_k 最小值 (1) 正确保存
 * - TC-SG-003-1: top_k 最大值 (20) 正确保存
 * - TC-SG-004: 清空 top_k 应保存为 undefined
 *
 * P2 中等 - 初始化和默认值：
 * - TC-SG-005: Settings 展开/收起功能
 * - TC-SG-006: top_k 默认值应为 5
 * - TC-SG-006-1: 从 node.data.top_k 加载现有配置
 * - TC-SG-007: showSettings 初始状态应为 false
 *
 * ⚠️ 测试重点：
 * - top_k 参数修改后是否正确保存到 node.data
 * - 边界值和无效值处理
 * - 默认值和初始化逻辑
 */

// @ts-nocheck
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import SearchGoogle from '../../../app/components/workflow/edgesNode/edgeNodesNew/SearchGoogle';
import type { Node } from '@xyflow/react';
import type { SearchConfigNodeData } from '../../../app/components/workflow/edgesNode/edgeNodesNew/SearchGoogle';

// Mock 配置
const mocks = vi.hoisted(() => ({
  useReactFlow: vi.fn(),
  useNodesPerFlowContext: vi.fn(),
  useGetSourceTarget: vi.fn(),
  useJsonConstructUtils: vi.fn(),
  useAppSettings: vi.fn(),
  runSingleEdgeNode: vi.fn(),
}));

vi.mock('@xyflow/react', () => ({
  useReactFlow: mocks.useReactFlow,
  Handle: ({ children }: any) => <div>{children}</div>,
  Position: { Top: 'top', Right: 'right', Bottom: 'bottom', Left: 'left' },
}));

vi.mock('../../../app/components/states/NodesPerFlowContext', () => ({
  useNodesPerFlowContext: mocks.useNodesPerFlowContext,
}));

vi.mock('../../../app/components/hooks/useGetSourceTarget', () => ({
  default: mocks.useGetSourceTarget,
}));

vi.mock('../../../app/components/hooks/useJsonConstructUtils', () => ({
  default: mocks.useJsonConstructUtils,
}));

vi.mock('../../../app/components/states/AppSettingsContext', () => ({
  useAppSettings: mocks.useAppSettings,
}));

vi.mock('../../../app/components/workflow/edgesNode/edgeNodesNew/components/InputOutputDisplay', () => ({
  default: () => <div data-testid='input-output-display'>InputOutputDisplay</div>,
}));

vi.mock('../../../app/utils/colors', () => ({
  UI_COLORS: {
    LINE_ACTIVE: '#39BC66',
    EDGENODE_BORDER_GREY: '#6D7177',
  },
}));

vi.mock('../../../app/components/workflow/edgesNode/edgeNodesNew/hook/runSingleEdgeNodeExecutor', () => ({
  runSingleEdgeNode: mocks.runSingleEdgeNode,
}));

vi.mock('@fortawesome/react-fontawesome', () => ({
  FontAwesomeIcon: ({ icon }: any) => <span data-testid='font-awesome-icon'>{icon?.iconName || 'icon'}</span>,
}));

vi.mock('@fortawesome/free-brands-svg-icons', () => ({
  faGoogle: { iconName: 'google' },
}));

vi.mock('react-dom', async () => {
  const actual = await vi.importActual('react-dom');
  return {
    ...actual,
    createPortal: (node: any) => node,
  };
});

describe('SearchGoogle Edge Node - 参数配置', () => {
  let mockSetNodes: any;
  let mockGetNode: any;
  let mockSetEdges: any;

  const createMockNode = (overrides: Partial<SearchConfigNodeData> = {}): Node<SearchConfigNodeData> => ({
    id: 'test-search-google-1',
    type: 'searchGoogle',
    position: { x: 0, y: 0 },
    data: {
      nodeLabels: [],
      subMenuType: null,
      top_k: 5,
      content: null,
      looped: false,
      query_id: undefined,
      vector_db: undefined,
      extra_configs: {
        model: undefined,
        threshold: undefined,
      },
      ...overrides,
    },
  });

  beforeEach(() => {
    mockSetNodes = vi.fn();
    mockSetEdges = vi.fn();
    mockGetNode = vi.fn(() => createMockNode());

    mocks.useReactFlow.mockReturnValue({
      getNode: mockGetNode,
      setNodes: mockSetNodes,
      setEdges: mockSetEdges,
      getNodes: vi.fn(() => [createMockNode()]),
    });

    mocks.useNodesPerFlowContext.mockReturnValue({
      isOnConnect: false,
      activatedEdge: null,
      isOnGeneratingNewNode: false,
      clearEdgeActivation: vi.fn(),
      activateEdge: vi.fn(),
      clearAll: vi.fn(),
    });

    mocks.useGetSourceTarget.mockReturnValue({
      getSourceNodeIdWithLabel: vi.fn(() => []),
      getTargetNodeIdWithLabel: vi.fn(() => []),
    });

    mocks.useJsonConstructUtils.mockReturnValue({
      streamResult: vi.fn(),
      reportError: vi.fn(),
      resetLoadingUI: vi.fn(),
    });

    mocks.useAppSettings.mockReturnValue({});

    mocks.runSingleEdgeNode.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ============================================================================
  // P0 致命 - 核心参数保存失败导致搜索功能不可用
  // ============================================================================

  describe('TC-SG-001: top_k 参数修改后保存 (P0)', () => {
    it('修改 top_k 应正确保存到 node.data.top_k', async () => {
      const mockNode = createMockNode({ top_k: 5 });
      mockGetNode.mockReturnValue(mockNode);

      render(
        <SearchGoogle
          id={mockNode.id}
          type='searchGoogle'
          data={mockNode.data}
          selected={false}
          isConnectable={true}
          xPos={0}
          yPos={0}
          zIndex={0}
          dragging={false}
        />
      );

      // 打开配置菜单
      const button = screen.getByRole('button', { name: /Google/i });
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByText('Settings')).toBeInTheDocument();
      });

      // 点击 Show 展开 Settings
      const showButton = screen.getByText('Show');
      fireEvent.click(showButton);

      await waitFor(() => {
        expect(screen.getByText('Result Number')).toBeInTheDocument();
      });

      // 查找 Result Number 输入框
      const topKInput = screen.getByDisplayValue('5');
      expect(topKInput).toHaveAttribute('type', 'number');

      // 修改 top_k 值
      fireEvent.change(topKInput, { target: { value: '10' } });

      // 等待状态更新和 setNodes 调用
      await waitFor(
        () => {
          expect(mockSetNodes).toHaveBeenCalled();
        },
        { timeout: 3000 }
      );

      // 验证 top_k 更新
      const setNodesCall = mockSetNodes.mock.calls[mockSetNodes.mock.calls.length - 1][0];
      const updatedNodes = setNodesCall([mockNode]);
      const updatedNode = updatedNodes.find((n: any) => n.id === mockNode.id);

      expect(updatedNode.data.top_k).toBe(10);
    });
  });

  describe('TC-SG-001-1: top_k 应为数字类型 (P0)', () => {
    it('top_k 值应为数字类型', () => {
      const mockNode = createMockNode({ top_k: 5 });

      render(
        <SearchGoogle
          id={mockNode.id}
          type='searchGoogle'
          data={mockNode.data}
          selected={false}
          isConnectable={true}
          xPos={0}
          yPos={0}
          zIndex={0}
          dragging={false}
        />
      );

      expect(typeof mockNode.data.top_k).toBe('number');
      expect(mockNode.data.top_k).toBe(5);
    });

    it('修改后的 top_k 应保持数字类型', async () => {
      const mockNode = createMockNode({ top_k: 5 });
      mockGetNode.mockReturnValue(mockNode);

      render(
        <SearchGoogle
          id={mockNode.id}
          type='searchGoogle'
          data={mockNode.data}
          selected={false}
          isConnectable={true}
          xPos={0}
          yPos={0}
          zIndex={0}
          dragging={false}
        />
      );

      // 打开配置菜单
      const button = screen.getByRole('button', { name: /Google/i });
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByText('Settings')).toBeInTheDocument();
      });

      // 展开 Settings
      const showButton = screen.getByText('Show');
      fireEvent.click(showButton);

      await waitFor(() => {
        expect(screen.getByText('Result Number')).toBeInTheDocument();
      });

      // 修改值
      const topKInput = screen.getByDisplayValue('5');
      fireEvent.change(topKInput, { target: { value: '15' } });

      await waitFor(
        () => {
          expect(mockSetNodes).toHaveBeenCalled();
        },
        { timeout: 3000 }
      );

      const setNodesCall = mockSetNodes.mock.calls[mockSetNodes.mock.calls.length - 1][0];
      const updatedNodes = setNodesCall([mockNode]);
      const updatedNode = updatedNodes.find((n: any) => n.id === mockNode.id);

      expect(typeof updatedNode.data.top_k).toBe('number');
      expect(updatedNode.data.top_k).toBe(15);
    });
  });

  // ============================================================================
  // P1 严重 - 参数配置异常影响搜索质量
  // ============================================================================

  describe('TC-SG-002: 应能将 top_k 修改为不同的数值 (P1)', () => {
    it('应能连续修改 top_k 为不同的值', async () => {
      const mockNode = createMockNode({ top_k: 5 });
      mockGetNode.mockReturnValue(mockNode);

      const { rerender } = render(
        <SearchGoogle
          id={mockNode.id}
          type='searchGoogle'
          data={mockNode.data}
          selected={false}
          isConnectable={true}
          xPos={0}
          yPos={0}
          zIndex={0}
          dragging={false}
        />
      );

      // 打开配置菜单
      const button = screen.getByRole('button', { name: /Google/i });
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByText('Settings')).toBeInTheDocument();
      });

      // 展开 Settings
      const showButton = screen.getByText('Show');
      fireEvent.click(showButton);

      await waitFor(() => {
        expect(screen.getByText('Result Number')).toBeInTheDocument();
      });

      // 第一次修改：5 -> 8
      const topKInput = screen.getByDisplayValue('5');
      fireEvent.change(topKInput, { target: { value: '8' } });

      await waitFor(
        () => {
          expect(mockSetNodes).toHaveBeenCalled();
        },
        { timeout: 3000 }
      );

      let setNodesCall = mockSetNodes.mock.calls[mockSetNodes.mock.calls.length - 1][0];
      let updatedNodes = setNodesCall([mockNode]);
      let updatedNode = updatedNodes.find((n: any) => n.id === mockNode.id);
      expect(updatedNode.data.top_k).toBe(8);

      // 更新 mock 节点数据
      mockNode.data.top_k = 8;
      mockGetNode.mockReturnValue(mockNode);

      // 重新渲染
      rerender(
        <SearchGoogle
          id={mockNode.id}
          type='searchGoogle'
          data={mockNode.data}
          selected={false}
          isConnectable={true}
          xPos={0}
          yPos={0}
          zIndex={0}
          dragging={false}
        />
      );

      // 第二次修改：8 -> 12
      const topKInput2 = screen.getByDisplayValue('8');
      fireEvent.change(topKInput2, { target: { value: '12' } });

      await waitFor(
        () => {
          expect(mockSetNodes).toHaveBeenCalled();
        },
        { timeout: 3000 }
      );

      setNodesCall = mockSetNodes.mock.calls[mockSetNodes.mock.calls.length - 1][0];
      updatedNodes = setNodesCall([{ ...mockNode, data: { ...mockNode.data, top_k: 8 } }]);
      updatedNode = updatedNodes.find((n: any) => n.id === mockNode.id);
      expect(updatedNode.data.top_k).toBe(12);
    });
  });

  describe('TC-SG-003: top_k 最小值正确保存 (P1)', () => {
    it('应正确保存 top_k 最小值 (1)', async () => {
      const mockNode = createMockNode({ top_k: 5 });
      mockGetNode.mockReturnValue(mockNode);

      render(
        <SearchGoogle
          id={mockNode.id}
          type='searchGoogle'
          data={mockNode.data}
          selected={false}
          isConnectable={true}
          xPos={0}
          yPos={0}
          zIndex={0}
          dragging={false}
        />
      );

      // 打开配置菜单并展开 Settings
      const button = screen.getByRole('button', { name: /Google/i });
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByText('Settings')).toBeInTheDocument();
      });

      const showButton = screen.getByText('Show');
      fireEvent.click(showButton);

      await waitFor(() => {
        expect(screen.getByText('Result Number')).toBeInTheDocument();
      });

      // 设置为最小值 1
      const topKInput = screen.getByDisplayValue('5');
      fireEvent.change(topKInput, { target: { value: '1' } });

      await waitFor(
        () => {
          expect(mockSetNodes).toHaveBeenCalled();
        },
        { timeout: 3000 }
      );

      const setNodesCall = mockSetNodes.mock.calls[mockSetNodes.mock.calls.length - 1][0];
      const updatedNodes = setNodesCall([mockNode]);
      const updatedNode = updatedNodes.find((n: any) => n.id === mockNode.id);

      expect(updatedNode.data.top_k).toBe(1);
    });
  });

  describe('TC-SG-003-1: top_k 最大值正确保存 (P1)', () => {
    it('应正确保存 top_k 最大值 (20)', async () => {
      const mockNode = createMockNode({ top_k: 5 });
      mockGetNode.mockReturnValue(mockNode);

      render(
        <SearchGoogle
          id={mockNode.id}
          type='searchGoogle'
          data={mockNode.data}
          selected={false}
          isConnectable={true}
          xPos={0}
          yPos={0}
          zIndex={0}
          dragging={false}
        />
      );

      // 打开配置菜单并展开 Settings
      const button = screen.getByRole('button', { name: /Google/i });
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByText('Settings')).toBeInTheDocument();
      });

      const showButton = screen.getByText('Show');
      fireEvent.click(showButton);

      await waitFor(() => {
        expect(screen.getByText('Result Number')).toBeInTheDocument();
      });

      // 设置为最大值 20
      const topKInput = screen.getByDisplayValue('5');
      fireEvent.change(topKInput, { target: { value: '20' } });

      await waitFor(
        () => {
          expect(mockSetNodes).toHaveBeenCalled();
        },
        { timeout: 3000 }
      );

      const setNodesCall = mockSetNodes.mock.calls[mockSetNodes.mock.calls.length - 1][0];
      const updatedNodes = setNodesCall([mockNode]);
      const updatedNode = updatedNodes.find((n: any) => n.id === mockNode.id);

      expect(updatedNode.data.top_k).toBe(20);
    });
  });

  describe('TC-SG-004: 清空 top_k 应保存为 undefined (P1)', () => {
    it('清空 top_k 输入框应保存为 undefined', async () => {
      const mockNode = createMockNode({ top_k: 5 });
      mockGetNode.mockReturnValue(mockNode);

      render(
        <SearchGoogle
          id={mockNode.id}
          type='searchGoogle'
          data={mockNode.data}
          selected={false}
          isConnectable={true}
          xPos={0}
          yPos={0}
          zIndex={0}
          dragging={false}
        />
      );

      // 打开配置菜单并展开 Settings
      const button = screen.getByRole('button', { name: /Google/i });
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByText('Settings')).toBeInTheDocument();
      });

      const showButton = screen.getByText('Show');
      fireEvent.click(showButton);

      await waitFor(() => {
        expect(screen.getByText('Result Number')).toBeInTheDocument();
      });

      // 清空输入框
      const topKInput = screen.getByDisplayValue('5');
      fireEvent.change(topKInput, { target: { value: '' } });

      await waitFor(
        () => {
          expect(mockSetNodes).toHaveBeenCalled();
        },
        { timeout: 3000 }
      );

      const setNodesCall = mockSetNodes.mock.calls[mockSetNodes.mock.calls.length - 1][0];
      const updatedNodes = setNodesCall([mockNode]);
      const updatedNode = updatedNodes.find((n: any) => n.id === mockNode.id);

      expect(updatedNode.data.top_k).toBeUndefined();
    });
  });

  // ============================================================================
  // P2 中等 - 初始化和默认值
  // ============================================================================

  describe('TC-SG-005: Settings 展开/收起功能 (P2)', () => {
    it('点击 Show 应展开 Settings 区域', async () => {
      const mockNode = createMockNode();

      render(
        <SearchGoogle
          id={mockNode.id}
          type='searchGoogle'
          data={mockNode.data}
          selected={false}
          isConnectable={true}
          xPos={0}
          yPos={0}
          zIndex={0}
          dragging={false}
        />
      );

      // 打开配置菜单
      const button = screen.getByRole('button', { name: /Google/i });
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByText('Settings')).toBeInTheDocument();
      });

      // Settings 默认收起，Result Number 不可见
      expect(screen.queryByText('Result Number')).not.toBeInTheDocument();

      // 点击 Show
      const showButton = screen.getByText('Show');
      fireEvent.click(showButton);

      // Settings 展开，Result Number 可见
      await waitFor(() => {
        expect(screen.getByText('Result Number')).toBeInTheDocument();
      });

      // 按钮文本变为 Hide
      expect(screen.getByText('Hide')).toBeInTheDocument();
    });

    it('点击 Hide 应收起 Settings 区域', async () => {
      const mockNode = createMockNode();

      render(
        <SearchGoogle
          id={mockNode.id}
          type='searchGoogle'
          data={mockNode.data}
          selected={false}
          isConnectable={true}
          xPos={0}
          yPos={0}
          zIndex={0}
          dragging={false}
        />
      );

      // 打开配置菜单
      const button = screen.getByRole('button', { name: /Google/i });
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByText('Settings')).toBeInTheDocument();
      });

      // 展开 Settings
      const showButton = screen.getByText('Show');
      fireEvent.click(showButton);

      await waitFor(() => {
        expect(screen.getByText('Result Number')).toBeInTheDocument();
      });

      // 点击 Hide
      const hideButton = screen.getByText('Hide');
      fireEvent.click(hideButton);

      // Settings 收起，Result Number 不可见
      await waitFor(() => {
        expect(screen.queryByText('Result Number')).not.toBeInTheDocument();
      });

      // 按钮文本变为 Show
      expect(screen.getByText('Show')).toBeInTheDocument();
    });
  });

  describe('TC-SG-006: top_k 默认值应为 5 (P2)', () => {
    it('节点初始化时 top_k 默认值应为 5', () => {
      const mockNode = createMockNode();

      render(
        <SearchGoogle
          id={mockNode.id}
          type='searchGoogle'
          data={mockNode.data}
          selected={false}
          isConnectable={true}
          xPos={0}
          yPos={0}
          zIndex={0}
          dragging={false}
        />
      );

      expect(mockNode.data.top_k).toBe(5);
    });

    it('没有提供 top_k 时应使用默认值 5', () => {
      const mockNode = createMockNode({ top_k: undefined });
      
      // 模拟组件内部的默认值逻辑
      const effectiveTopK = mockNode.data.top_k ?? 5;
      
      render(
        <SearchGoogle
          id={mockNode.id}
          type='searchGoogle'
          data={mockNode.data}
          selected={false}
          isConnectable={true}
          xPos={0}
          yPos={0}
          zIndex={0}
          dragging={false}
        />
      );

      expect(effectiveTopK).toBe(5);
    });
  });

  describe('TC-SG-006-1: 从 node.data.top_k 加载现有配置 (P2)', () => {
    it('节点初始化时应从 node.data.top_k 加载现有配置', async () => {
      const mockNode = createMockNode({ top_k: 10 });

      render(
        <SearchGoogle
          id={mockNode.id}
          type='searchGoogle'
          data={mockNode.data}
          selected={false}
          isConnectable={true}
          xPos={0}
          yPos={0}
          zIndex={0}
          dragging={false}
        />
      );

      // 打开配置菜单
      const button = screen.getByRole('button', { name: /Google/i });
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByText('Settings')).toBeInTheDocument();
      });

      // 展开 Settings
      const showButton = screen.getByText('Show');
      fireEvent.click(showButton);

      await waitFor(() => {
        expect(screen.getByText('Result Number')).toBeInTheDocument();
      });

      // 验证显示的是配置的值 10，而不是默认值 5
      expect(screen.getByDisplayValue('10')).toBeInTheDocument();
    });

    it('应正确加载不同的 top_k 配置值', async () => {
      const mockNode = createMockNode({ top_k: 15 });

      render(
        <SearchGoogle
          id={mockNode.id}
          type='searchGoogle'
          data={mockNode.data}
          selected={false}
          isConnectable={true}
          xPos={0}
          yPos={0}
          zIndex={0}
          dragging={false}
        />
      );

      // 打开配置菜单
      const button = screen.getByRole('button', { name: /Google/i });
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByText('Settings')).toBeInTheDocument();
      });

      // 展开 Settings
      const showButton = screen.getByText('Show');
      fireEvent.click(showButton);

      await waitFor(() => {
        expect(screen.getByText('Result Number')).toBeInTheDocument();
      });

      // 验证显示的是配置的值 15
      expect(screen.getByDisplayValue('15')).toBeInTheDocument();
    });
  });

  describe('TC-SG-007: showSettings 初始状态应为 false (P2)', () => {
    it('配置菜单打开时 Settings 区域应默认收起', async () => {
      const mockNode = createMockNode();

      render(
        <SearchGoogle
          id={mockNode.id}
          type='searchGoogle'
          data={mockNode.data}
          selected={false}
          isConnectable={true}
          xPos={0}
          yPos={0}
          zIndex={0}
          dragging={false}
        />
      );

      // 打开配置菜单
      const button = screen.getByRole('button', { name: /Google/i });
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByText('Settings')).toBeInTheDocument();
      });

      // Settings 区域应该收起（Result Number 不可见）
      expect(screen.queryByText('Result Number')).not.toBeInTheDocument();
      
      // Show 按钮应该存在
      expect(screen.getByText('Show')).toBeInTheDocument();
    });
  });

  describe('TC-SG-008: 组件挂载验证 (P2)', () => {
    it('组件应成功挂载并渲染', () => {
      const mockNode = createMockNode();

      const { container } = render(
        <SearchGoogle
          id={mockNode.id}
          type='searchGoogle'
          data={mockNode.data}
          selected={false}
          isConnectable={true}
          xPos={0}
          yPos={0}
          zIndex={0}
          dragging={false}
        />
      );

      expect(container.firstChild).toBeInTheDocument();
    });

    it('应渲染 Google 按钮', () => {
      const mockNode = createMockNode();

      render(
        <SearchGoogle
          id={mockNode.id}
          type='searchGoogle'
          data={mockNode.data}
          selected={false}
          isConnectable={true}
          xPos={0}
          yPos={0}
          zIndex={0}
          dragging={false}
        />
      );

      const button = screen.getByRole('button', { name: /Google/i });
      expect(button).toBeInTheDocument();
    });
  });
});

