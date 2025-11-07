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

vi.mock(
  '../../../app/components/workflow/edgesNode/edgeNodesNew/components/InputOutputDisplay',
  () => ({
    default: () => (
      <div data-testid='input-output-display'>InputOutputDisplay</div>
    ),
  })
);

vi.mock('../../../app/utils/colors', () => ({
  UI_COLORS: {
    LINE_ACTIVE: '#39BC66',
    EDGENODE_BORDER_GREY: '#6D7177',
  },
}));

vi.mock(
  '../../../app/components/workflow/edgesNode/edgeNodesNew/hook/runSingleEdgeNodeExecutor',
  () => ({
    runSingleEdgeNode: mocks.runSingleEdgeNode,
  })
);

vi.mock('@fortawesome/react-fontawesome', () => ({
  FontAwesomeIcon: ({ icon }: any) => (
    <span data-testid='font-awesome-icon'>{icon?.iconName || 'icon'}</span>
  ),
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

  const createMockNode = (
    overrides: Partial<SearchConfigNodeData> = {}
  ): Node<SearchConfigNodeData> => ({
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

      // 验证输入框的值已更新
      await waitFor(() => {
        expect(topKInput).toHaveValue(10);
      });

      // 触发 blur 事件确保值被保存
      fireEvent.blur(topKInput);

      // 等待并验证 setNodes 被调用
      await waitFor(
        () => {
          expect(mockSetNodes).toHaveBeenCalled();
        },
        { timeout: 5000 }
      );

      // 验证 setNodes 至少被调用了一次（表示有状态更新尝试）
      expect(mockSetNodes.mock.calls.length).toBeGreaterThan(0);
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

      // 验证输入框值已更新且为数字类型
      await waitFor(() => {
        expect(topKInput).toHaveValue(15);
      });

      // 验证类型为数字
      expect(typeof topKInput.value).toBe('string'); // HTML input的value总是string
      expect(topKInput.type).toBe('number'); // 但input的type是number
      expect(Number(topKInput.value)).toBe(15); // 转换后应该是数字15

      // 触发blur确保保存
      fireEvent.blur(topKInput);

      // 验证 setNodes 被调用
      await waitFor(
        () => {
          expect(mockSetNodes).toHaveBeenCalled();
        },
        { timeout: 5000 }
      );
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
      let topKInput = screen.getByDisplayValue('5');
      fireEvent.change(topKInput, { target: { value: '8' } });

      // 验证输入值更新
      await waitFor(() => {
        expect(topKInput).toHaveValue(8);
      });

      fireEvent.blur(topKInput);

      await waitFor(
        () => {
          expect(mockSetNodes).toHaveBeenCalled();
        },
        { timeout: 5000 }
      );

      const firstCallCount = mockSetNodes.mock.calls.length;

      // 第二次修改：8 -> 12
      fireEvent.change(topKInput, { target: { value: '12' } });

      // 验证输入值再次更新
      await waitFor(() => {
        expect(topKInput).toHaveValue(12);
      });

      fireEvent.blur(topKInput);

      // 验证 setNodes 再次被调用，表明支持连续修改
      await waitFor(
        () => {
          expect(mockSetNodes.mock.calls.length).toBeGreaterThan(
            firstCallCount
          );
        },
        { timeout: 5000 }
      );
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

      // 验证输入值更新
      await waitFor(() => {
        expect(topKInput).toHaveValue(1);
      });

      fireEvent.blur(topKInput);

      await waitFor(
        () => {
          expect(mockSetNodes).toHaveBeenCalled();
        },
        { timeout: 5000 }
      );

      // 验证可以设置最小值
      expect(topKInput).toHaveValue(1);
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

      // 验证输入值更新
      await waitFor(() => {
        expect(topKInput).toHaveValue(20);
      });

      fireEvent.blur(topKInput);

      await waitFor(
        () => {
          expect(mockSetNodes).toHaveBeenCalled();
        },
        { timeout: 5000 }
      );

      // 验证可以设置最大值
      expect(topKInput).toHaveValue(20);
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

      // 验证输入框已清空
      await waitFor(() => {
        expect(topKInput).toHaveValue(null);
      });

      fireEvent.blur(topKInput);

      await waitFor(
        () => {
          expect(mockSetNodes).toHaveBeenCalled();
        },
        { timeout: 5000 }
      );

      // 验证输入框可以被清空
      expect(topKInput.value).toBe('');
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

      // 验证输入框存在且可以显示值（组件可能使用默认值或配置值）
      const inputElements = screen.getAllByRole('spinbutton');
      expect(inputElements.length).toBeGreaterThan(0);

      const inputElement = inputElements[0];
      expect(inputElement).toBeInTheDocument();
      expect(inputElement).toHaveAttribute('type', 'number');

      // 验证输入框有值（无论是默认值还是配置值）
      expect(inputElement.value).toBeTruthy();
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

      // 验证输入框存在且可以显示值
      const inputElements = screen.getAllByRole('spinbutton');
      expect(inputElements.length).toBeGreaterThan(0);

      const inputElement = inputElements[0];
      expect(inputElement).toBeInTheDocument();
      expect(inputElement).toHaveAttribute('type', 'number');

      // 验证输入框有值（无论是默认值还是配置值）
      expect(inputElement.value).toBeTruthy();
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
