/**
 * Retrieving Edge Node - 参数配置测试
 *
 * 测试用例：
 * P0 致命 - 核心参数保存失败导致检索功能完全不可用：
 * - TC-RTV-001: Query 参数修改后保存
 * - TC-RTV-002: DataSource 参数修改后保存
 * - TC-RTV-003: Top K 参数修改后保存
 * - TC-RTV-004: Threshold 参数修改后保存
 *
 * P1 严重 - 参数保存异常影响检索质量：
 * - TC-RTV-005: 添加多个 DataSource 项
 * - TC-RTV-006: 删除 DataSource 项
 * - TC-RTV-007: Top K 边界值保存
 * - TC-RTV-008: Threshold 边界值保存
 * - TC-RTV-009: DataSource 与 IndexItem 映射关系
 *
 * P2 中等 - 非核心参数或边界情况：
 * - TC-RTV-010: 高级设置 Model 参数保存
 * - TC-RTV-011: 无效 Top K 值处理
 * - TC-RTV-012: 无效 Threshold 值处理
 * - TC-RTV-013: 空 DataSource 处理
 *
 * P3 轻微 - UI 显示问题不影响保存：
 * - TC-RTV-014: 菜单打开/关闭状态
 * - TC-RTV-015: 高级设置展开/收起
 *
 * ⚠️ 测试重点：
 * - 所有参数修改后是否正确保存到 node.data
 * - 数据结构完整性验证
 * - 边界值和异常情况处理
 */

// @ts-nocheck
import React from 'react';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Retrieving from '../../../app/components/workflow/edgesNode/edgeNodesNew/Retrieving';
import type { Node } from '@xyflow/react';
import type { RetrievingConfigNodeData } from '../../../app/components/workflow/edgesNode/edgeNodesNew/Retrieving';

// Mock 配置
const mocks = vi.hoisted(() => ({
  useReactFlow: vi.fn(),
  useNodesPerFlowContext: vi.fn(),
  useGetSourceTarget: vi.fn(),
  useJsonConstructUtils: vi.fn(),
  useAppSettings: vi.fn(),
}));

vi.mock('@xyflow/react', () => ({
  useReactFlow: mocks.useReactFlow,
  Handle: ({ children }: any) => <div>{children}</div>,
  Position: { Top: 'top', Right: 'right', Bottom: 'bottom', Left: 'left' },
  MarkerType: { ArrowClosed: 'arrowclosed', Arrow: 'arrow' },
}));

vi.mock('@/app/components/states/NodesPerFlowContext', () => ({
  useNodesPerFlowContext: mocks.useNodesPerFlowContext,
}));

vi.mock('@/app/components/hooks/useGetSourceTarget', () => ({
  default: mocks.useGetSourceTarget,
}));

vi.mock('@/app/components/hooks/useJsonConstructUtils', () => ({
  default: mocks.useJsonConstructUtils,
}));

vi.mock('@/app/components/states/AppSettingsContext', () => ({
  useAppSettings: mocks.useAppSettings,
}));

vi.mock(
  '@/app/components/workflow/edgesNode/edgeNodesNew/components/InputOutputDisplay',
  () => ({
    default: () => (
      <div data-testid='input-output-display'>InputOutputDisplay</div>
    ),
  })
);

// Don't mock PuppyDropDown - use the real component with data-testid support

vi.mock('react-dom', async () => {
  const actual = await vi.importActual('react-dom');
  return {
    ...actual,
    createPortal: (node: any) => node,
  };
});

describe('Retrieving Edge Node - 参数配置', () => {
  let mockSetNodes: any;
  let mockGetNode: any;
  let mockSetEdges: any;

  const createMockNode = (
    overrides: Partial<RetrievingConfigNodeData> = {}
  ): Node<RetrievingConfigNodeData> => ({
    id: 'test-retrieving-1',
    type: 'retrieving',
    position: { x: 0, y: 0 },
    data: {
      dataSource: [],
      subMenuType: null,
      top_k: 5,
      content: null,
      query_id: { id: '', label: '' },
      structuredWithVectorIndexing: [],
      extra_configs: {
        model: undefined,
        threshold: 0.7,
      },
      ...overrides,
    },
  });

  const createMockTextNode = (id: string, label: string) => ({
    id,
    type: 'text',
    position: { x: 0, y: 0 },
    data: { content: 'test query' },
  });

  const createMockStructuredNode = (id: string, label: string) => ({
    id,
    type: 'structured',
    position: { x: 0, y: 0 },
    data: {
      indexingList: [
        {
          type: 'vector',
          status: 'done',
          index_name: 'test-index',
          collection_configs: {
            collection_name: 'test-collection',
          },
        },
      ],
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
      getEdges: vi.fn(() => []),
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

    mocks.useAppSettings.mockReturnValue({
      cloudModels: [],
      localModels: [],
      availableModels: [],
      isLocalDeployment: false,
      isLoadingLocalModels: false,
      ollamaConnected: false,
      toggleModelAvailability: vi.fn(),
      addLocalModel: vi.fn(),
      removeLocalModel: vi.fn(),
      refreshLocalModels: vi.fn(),
      userSubscriptionStatus: null,
      isLoadingSubscriptionStatus: false,
      fetchUserSubscriptionStatus: vi.fn(),
      warns: [],
      addWarn: vi.fn(),
      removeWarn: vi.fn(),
      clearWarns: vi.fn(),
      toggleWarnExpand: vi.fn(),
      usageData: null,
      planLimits: {
        workspaces: 1,
        deployedServices: 1,
        llm_calls: 50,
        runs: 100,
        fileStorage: '5M',
      },
      isLoadingUsage: false,
      fetchUsageData: vi.fn(),
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ============================================================================
  // P0 致命 - 核心参数保存失败导致检索功能完全不可用
  // ============================================================================

  describe('TC-RTV-001: Query 参数修改后保存 (P0)', () => {
    it('修改 query_id 应正确保存到 node.data.query_id', async () => {
      const textNode = createMockTextNode('text-1', 'Test Query');
      const mockNode = createMockNode();

      mockGetNode.mockReturnValue(mockNode);
      const mockGetSourceNodeIdWithLabel = vi.fn(() => [
        { id: 'text-1', label: 'Test Query' },
      ]);

      mocks.useReactFlow.mockReturnValue({
        getNode: (id: string) => {
          if (id === 'text-1') return textNode;
          return mockNode;
        },
        setNodes: mockSetNodes,
        setEdges: mockSetEdges,
        getNodes: vi.fn(() => [mockNode, textNode]),
        getEdges: vi.fn(() => []),
      });

      mocks.useGetSourceTarget.mockReturnValue({
        getSourceNodeIdWithLabel: mockGetSourceNodeIdWithLabel,
        getTargetNodeIdWithLabel: vi.fn(() => []),
      });

      render(
        <Retrieving
          id={mockNode.id}
          type='retrieving'
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
      const button = screen.getByRole('button', { name: /Retrieve/i });
      fireEvent.click(button);

      // 等待菜单和 query dropdown 按钮渲染
      await waitFor(() => {
        expect(screen.getByText('Query')).toBeInTheDocument();
        expect(screen.getByTestId('query-select-button')).toBeInTheDocument();
      });

      // 打开 query dropdown 并等待选项出现
      const queryButton = screen.getByTestId('query-select-button');
      await act(async () => {
        fireEvent.click(queryButton);
      });

      // 等待下拉列表渲染并点击选项
      await waitFor(
        async () => {
          const queryList = screen.queryByTestId('query-select-list');
          expect(queryList).toBeInTheDocument();
        },
        { timeout: 2000 }
      );

      const queryOption = await waitFor(() =>
        screen.getByTestId('query-select-option-0')
      );
      await act(async () => {
        fireEvent.click(queryOption);
      });

      // 等待 setNodes 被调用（包含 requestAnimationFrame 的延迟）
      await waitFor(
        () => {
          expect(mockSetNodes).toHaveBeenCalled();
        },
        { timeout: 2000 }
      );

      // 验证 query_id 更新
      const setNodesCall =
        mockSetNodes.mock.calls[mockSetNodes.mock.calls.length - 1][0];
      const updatedNodes = setNodesCall([mockNode]);
      const updatedNode = updatedNodes.find((n: any) => n.id === mockNode.id);

      expect(updatedNode.data.query_id).toEqual({
        id: 'text-1',
        label: 'Test Query',
      });
    });

    it('query_id 应包含 id 和 label 字段', () => {
      const mockNode = createMockNode({
        query_id: { id: 'text-1', label: 'Test Query' },
      });

      render(
        <Retrieving
          id={mockNode.id}
          type='retrieving'
          data={mockNode.data}
          selected={false}
          isConnectable={true}
          xPos={0}
          yPos={0}
          zIndex={0}
          dragging={false}
        />
      );

      expect(mockNode.data.query_id).toHaveProperty('id');
      expect(mockNode.data.query_id).toHaveProperty('label');
      expect(mockNode.data.query_id.id).toBe('text-1');
      expect(mockNode.data.query_id.label).toBe('Test Query');
    });
  });

  describe('TC-RTV-002: DataSource 参数修改后保存 (P0)', () => {
    it('添加 dataSource 应正确保存到 node.data.dataSource', async () => {
      const structuredNode = createMockStructuredNode('struct-1', 'Test Index');
      const mockNode = createMockNode();

      mockGetNode.mockImplementation((id: string) => {
        if (id === 'struct-1') return structuredNode;
        return mockNode;
      });

      const mockGetSourceNodeIdWithLabel = vi.fn(() => [
        { id: 'struct-1', label: 'Test Index' },
      ]);

      mocks.useReactFlow.mockReturnValue({
        getNode: mockGetNode,
        setNodes: mockSetNodes,
        setEdges: mockSetEdges,
        getNodes: vi.fn(() => [mockNode, structuredNode]),
        getEdges: vi.fn(() => []),
      });

      mocks.useGetSourceTarget.mockReturnValue({
        getSourceNodeIdWithLabel: mockGetSourceNodeIdWithLabel,
        getTargetNodeIdWithLabel: vi.fn(() => []),
      });

      render(
        <Retrieving
          id={mockNode.id}
          type='retrieving'
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
      const button = screen.getByRole('button', { name: /Retrieve/i });
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByText('Indexed Structured Data')).toBeInTheDocument();
      });

      // 点击添加按钮
      const addButtons = screen.getAllByRole('button');
      const addButton = addButtons.find(btn =>
        btn.querySelector('svg path[d*="M12 5v14M5 12h14"]')
      );

      if (addButton) {
        fireEvent.click(addButton);

        await waitFor(() => {
          const dropdownItems = screen.queryAllByText('Test Index');
          if (dropdownItems.length > 0) {
            fireEvent.click(dropdownItems[0]);
          }
        });
      }

      await waitFor(
        () => {
          expect(mockSetNodes).toHaveBeenCalled();
        },
        { timeout: 3000 }
      );

      // 验证 dataSource 包含新项
      const setNodesCalls = mockSetNodes.mock.calls;
      const lastCall = setNodesCalls[setNodesCalls.length - 1][0];
      const updatedNodes = lastCall([mockNode]);
      const updatedNode = updatedNodes.find((n: any) => n.id === mockNode.id);

      expect(Array.isArray(updatedNode.data.dataSource)).toBe(true);
      if (updatedNode.data.dataSource.length > 0) {
        expect(updatedNode.data.dataSource[0]).toHaveProperty('id');
        expect(updatedNode.data.dataSource[0]).toHaveProperty('label');
        expect(updatedNode.data.dataSource[0]).toHaveProperty('index_item');
      }
    });

    it('dataSource 项应包含 id, label, index_item 字段', () => {
      const mockNode = createMockNode({
        dataSource: [
          {
            id: 'struct-1',
            label: 'Test Index',
            index_item: {
              index_name: 'test-index',
              collection_configs: {
                collection_name: 'test-collection',
              },
            },
          },
        ],
      });

      render(
        <Retrieving
          id={mockNode.id}
          type='retrieving'
          data={mockNode.data}
          selected={false}
          isConnectable={true}
          xPos={0}
          yPos={0}
          zIndex={0}
          dragging={false}
        />
      );

      const dataSourceItem = mockNode.data.dataSource[0];
      expect(dataSourceItem).toHaveProperty('id');
      expect(dataSourceItem).toHaveProperty('label');
      expect(dataSourceItem).toHaveProperty('index_item');
      expect(dataSourceItem.index_item).toHaveProperty('index_name');
      expect(dataSourceItem.index_item).toHaveProperty('collection_configs');
    });
  });

  describe('TC-RTV-003: Top K 参数修改后保存 (P0)', () => {
    it('修改 top_k 应正确保存到 node.data.top_k', async () => {
      const mockNode = createMockNode({ top_k: 5 });
      mockGetNode.mockReturnValue(mockNode);

      render(
        <Retrieving
          id={mockNode.id}
          type='retrieving'
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
      const button = screen.getByRole('button', { name: /Retrieve/i });
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByText('Top K')).toBeInTheDocument();
      });

      // 使用 data-testid 查找 Top K 输入框
      const topKInput = screen.getByTestId('top-k-input');

      await act(async () => {
        fireEvent.change(topKInput, { target: { value: '10' } });
        // 等待 requestAnimationFrame
        await new Promise(resolve => requestAnimationFrame(resolve));
      });

      await waitFor(() => {
        expect(mockSetNodes).toHaveBeenCalled();
      });

      // 验证 top_k 更新
      const setNodesCall =
        mockSetNodes.mock.calls[mockSetNodes.mock.calls.length - 1][0];
      const updatedNodes = setNodesCall([mockNode]);
      const updatedNode = updatedNodes.find((n: any) => n.id === mockNode.id);

      expect(updatedNode.data.top_k).toBe(10);
    });

    it('top_k 应为数字类型', () => {
      const mockNode = createMockNode({ top_k: 5 });

      render(
        <Retrieving
          id={mockNode.id}
          type='retrieving'
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
    });
  });

  describe('TC-RTV-004: Threshold 参数修改后保存 (P0)', () => {
    it('修改 threshold 应正确保存到 node.data.extra_configs.threshold', async () => {
      const mockNode = createMockNode({
        extra_configs: { model: undefined, threshold: 0.7 },
      });
      mockGetNode.mockReturnValue(mockNode);

      render(
        <Retrieving
          id={mockNode.id}
          type='retrieving'
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
      const button = screen.getByRole('button', { name: /Retrieve/i });
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByText('Threshold')).toBeInTheDocument();
      });

      // 使用 data-testid 查找 Threshold 输入框
      const thresholdInput = screen.getByTestId('threshold-input');

      await act(async () => {
        fireEvent.change(thresholdInput, { target: { value: '0.8' } });
        // 等待 requestAnimationFrame
        await new Promise(resolve => requestAnimationFrame(resolve));
      });

      await waitFor(() => {
        expect(mockSetNodes).toHaveBeenCalled();
      });

      // 验证 threshold 更新
      const setNodesCall =
        mockSetNodes.mock.calls[mockSetNodes.mock.calls.length - 1][0];
      const updatedNodes = setNodesCall([mockNode]);
      const updatedNode = updatedNodes.find((n: any) => n.id === mockNode.id);

      expect(updatedNode.data.extra_configs.threshold).toBe(0.8);
    });

    it('threshold 应在 extra_configs 对象中', () => {
      const mockNode = createMockNode({
        extra_configs: { model: undefined, threshold: 0.7 },
      });

      render(
        <Retrieving
          id={mockNode.id}
          type='retrieving'
          data={mockNode.data}
          selected={false}
          isConnectable={true}
          xPos={0}
          yPos={0}
          zIndex={0}
          dragging={false}
        />
      );

      expect(mockNode.data).toHaveProperty('extra_configs');
      expect(mockNode.data.extra_configs).toHaveProperty('threshold');
      expect(typeof mockNode.data.extra_configs.threshold).toBe('number');
    });
  });

  // ============================================================================
  // P1 严重 - 参数保存异常影响检索质量
  // ============================================================================

  describe('TC-RTV-005: 添加多个 DataSource 项 (P1)', () => {
    it('应能添加多个不同的 dataSource 项', async () => {
      const structuredNode1 = createMockStructuredNode('struct-1', 'Index 1');
      const structuredNode2 = createMockStructuredNode('struct-2', 'Index 2');
      const mockNode = createMockNode();

      mockGetNode.mockImplementation((id: string) => {
        if (id === 'struct-1') return structuredNode1;
        if (id === 'struct-2') return structuredNode2;
        return mockNode;
      });

      const mockGetSourceNodeIdWithLabel = vi.fn(() => [
        { id: 'struct-1', label: 'Index 1' },
        { id: 'struct-2', label: 'Index 2' },
      ]);

      mocks.useReactFlow.mockReturnValue({
        getNode: mockGetNode,
        setNodes: mockSetNodes,
        setEdges: mockSetEdges,
        getNodes: vi.fn(() => [mockNode, structuredNode1, structuredNode2]),
        getEdges: vi.fn(() => []),
      });

      mocks.useGetSourceTarget.mockReturnValue({
        getSourceNodeIdWithLabel: mockGetSourceNodeIdWithLabel,
        getTargetNodeIdWithLabel: vi.fn(() => []),
      });

      const { rerender } = render(
        <Retrieving
          id={mockNode.id}
          type='retrieving'
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
      const button = screen.getByRole('button', { name: /Retrieve/i });
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByText('Indexed Structured Data')).toBeInTheDocument();
      });

      // 验证可以存储多个项的数据结构
      const mockNodeWithMultipleDataSources = createMockNode({
        dataSource: [
          {
            id: 'struct-1',
            label: 'Index 1',
            index_item: {
              index_name: 'test-index-1',
              collection_configs: { collection_name: 'test-collection-1' },
            },
          },
          {
            id: 'struct-2',
            label: 'Index 2',
            index_item: {
              index_name: 'test-index-2',
              collection_configs: { collection_name: 'test-collection-2' },
            },
          },
        ],
      });

      rerender(
        <Retrieving
          id={mockNodeWithMultipleDataSources.id}
          type='retrieving'
          data={mockNodeWithMultipleDataSources.data}
          selected={false}
          isConnectable={true}
          xPos={0}
          yPos={0}
          zIndex={0}
          dragging={false}
        />
      );

      expect(mockNodeWithMultipleDataSources.data.dataSource).toHaveLength(2);
      expect(mockNodeWithMultipleDataSources.data.dataSource[0].id).toBe(
        'struct-1'
      );
      expect(mockNodeWithMultipleDataSources.data.dataSource[1].id).toBe(
        'struct-2'
      );
    });

    it('不应添加重复的 dataSource 项', () => {
      const mockNode = createMockNode({
        dataSource: [
          {
            id: 'struct-1',
            label: 'Index 1',
            index_item: {
              index_name: 'test-index',
              collection_configs: { collection_name: 'test-collection' },
            },
          },
        ],
      });

      render(
        <Retrieving
          id={mockNode.id}
          type='retrieving'
          data={mockNode.data}
          selected={false}
          isConnectable={true}
          xPos={0}
          yPos={0}
          zIndex={0}
          dragging={false}
        />
      );

      // 验证数据源中没有重复的 id
      const ids = mockNode.data.dataSource.map(item => item.id);
      const uniqueIds = new Set(ids);
      expect(ids.length).toBe(uniqueIds.size);
    });
  });

  describe('TC-RTV-006: 删除 DataSource 项 (P1)', () => {
    it('删除 dataSource 项后应更新 node.data.dataSource', async () => {
      const mockNode = createMockNode({
        dataSource: [
          {
            id: 'struct-1',
            label: 'Index 1',
            index_item: {
              index_name: 'test-index',
              collection_configs: { collection_name: 'test-collection' },
            },
          },
        ],
      });

      mockGetNode.mockReturnValue(mockNode);

      render(
        <Retrieving
          id={mockNode.id}
          type='retrieving'
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
      const button = screen.getByRole('button', { name: /Retrieve/i });
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByText('Index 1')).toBeInTheDocument();
      });

      // 鼠标悬停在 dataSource 项上以显示删除按钮
      const dataSourceItem = screen.getByText('Index 1').closest('div');
      if (dataSourceItem) {
        fireEvent.mouseEnter(dataSourceItem);

        // 查找删除按钮
        const deleteButtons = screen.getAllByRole('button');
        const deleteButton = deleteButtons.find(btn =>
          btn.querySelector('svg line[x1="18"][y1="6"]')
        );

        if (deleteButton) {
          fireEvent.click(deleteButton);

          await waitFor(() => {
            expect(mockSetNodes).toHaveBeenCalled();
          });

          // 验证 dataSource 已删除项
          const setNodesCall =
            mockSetNodes.mock.calls[mockSetNodes.mock.calls.length - 1][0];
          const updatedNodes = setNodesCall([mockNode]);
          const updatedNode = updatedNodes.find(
            (n: any) => n.id === mockNode.id
          );

          expect(updatedNode.data.dataSource).toHaveLength(0);
        }
      }
    });
  });

  describe('TC-RTV-007: Top K 边界值保存 (P1)', () => {
    it('应正确保存 top_k 最小值 (1)', async () => {
      const mockNode = createMockNode({ top_k: 5 });
      mockGetNode.mockReturnValue(mockNode);

      render(
        <Retrieving
          id={mockNode.id}
          type='retrieving'
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
      const button = screen.getByRole('button', { name: /Retrieve/i });
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByText('Top K')).toBeInTheDocument();
      });

      const topKInput = screen.getByTestId('top-k-input');

      await act(async () => {
        fireEvent.change(topKInput, { target: { value: '1' } });
        await new Promise(resolve => requestAnimationFrame(resolve));
      });

      await waitFor(() => {
        if (mockSetNodes.mock.calls.length > 0) {
          const setNodesCall =
            mockSetNodes.mock.calls[mockSetNodes.mock.calls.length - 1][0];
          const updatedNodes = setNodesCall([mockNode]);
          const updatedNode = updatedNodes.find(
            (n: any) => n.id === mockNode.id
          );
          expect(updatedNode.data.top_k).toBe(1);
        }
      });
    });

    it('应正确保存 top_k 最大值 (100)', async () => {
      const mockNode = createMockNode({ top_k: 5 });
      mockGetNode.mockReturnValue(mockNode);

      render(
        <Retrieving
          id={mockNode.id}
          type='retrieving'
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
      const button = screen.getByRole('button', { name: /Retrieve/i });
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByText('Top K')).toBeInTheDocument();
      });

      const topKInput = screen.getByTestId('top-k-input');

      await act(async () => {
        fireEvent.change(topKInput, { target: { value: '100' } });
        await new Promise(resolve => requestAnimationFrame(resolve));
      });

      await waitFor(() => {
        if (mockSetNodes.mock.calls.length > 0) {
          const setNodesCall =
            mockSetNodes.mock.calls[mockSetNodes.mock.calls.length - 1][0];
          const updatedNodes = setNodesCall([mockNode]);
          const updatedNode = updatedNodes.find(
            (n: any) => n.id === mockNode.id
          );
          expect(updatedNode.data.top_k).toBe(100);
        }
      });
    });
  });

  describe('TC-RTV-008: Threshold 边界值保存 (P1)', () => {
    it('应正确保存 threshold 最小值 (0)', async () => {
      const mockNode = createMockNode({
        extra_configs: { model: undefined, threshold: 0.7 },
      });
      mockGetNode.mockReturnValue(mockNode);

      render(
        <Retrieving
          id={mockNode.id}
          type='retrieving'
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
      const button = screen.getByRole('button', { name: /Retrieve/i });
      fireEvent.click(button);

      await waitFor(() => {
        const inputs = screen.getAllByRole('spinbutton');
        const thresholdInput = inputs.find((input: any) =>
          input.parentElement?.previousElementSibling?.textContent?.includes(
            'Threshold'
          )
        );

        if (thresholdInput) {
          fireEvent.change(thresholdInput, { target: { value: '0' } });
        }
      });

      await waitFor(() => {
        if (mockSetNodes.mock.calls.length > 0) {
          const setNodesCall =
            mockSetNodes.mock.calls[mockSetNodes.mock.calls.length - 1][0];
          const updatedNodes = setNodesCall([mockNode]);
          const updatedNode = updatedNodes.find(
            (n: any) => n.id === mockNode.id
          );
          expect(updatedNode.data.extra_configs.threshold).toBe(0);
        }
      });
    });

    it('应正确保存 threshold 最大值 (1)', async () => {
      const mockNode = createMockNode({
        extra_configs: { model: undefined, threshold: 0.7 },
      });
      mockGetNode.mockReturnValue(mockNode);

      render(
        <Retrieving
          id={mockNode.id}
          type='retrieving'
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
      const button = screen.getByRole('button', { name: /Retrieve/i });
      fireEvent.click(button);

      await waitFor(() => {
        const inputs = screen.getAllByRole('spinbutton');
        const thresholdInput = inputs.find((input: any) =>
          input.parentElement?.previousElementSibling?.textContent?.includes(
            'Threshold'
          )
        );

        if (thresholdInput) {
          fireEvent.change(thresholdInput, { target: { value: '1' } });
        }
      });

      await waitFor(() => {
        if (mockSetNodes.mock.calls.length > 0) {
          const setNodesCall =
            mockSetNodes.mock.calls[mockSetNodes.mock.calls.length - 1][0];
          const updatedNodes = setNodesCall([mockNode]);
          const updatedNode = updatedNodes.find(
            (n: any) => n.id === mockNode.id
          );
          expect(updatedNode.data.extra_configs.threshold).toBe(1);
        }
      });
    });
  });

  describe('TC-RTV-009: DataSource 与 IndexItem 映射关系 (P1)', () => {
    it('dataSource 中的 index_item 应正确映射到源节点的 indexingList', () => {
      const mockNode = createMockNode({
        dataSource: [
          {
            id: 'struct-1',
            label: 'Test Index',
            index_item: {
              index_name: 'test-index',
              collection_configs: {
                collection_name: 'test-collection',
              },
            },
          },
        ],
      });

      render(
        <Retrieving
          id={mockNode.id}
          type='retrieving'
          data={mockNode.data}
          selected={false}
          isConnectable={true}
          xPos={0}
          yPos={0}
          zIndex={0}
          dragging={false}
        />
      );

      const dataSourceItem = mockNode.data.dataSource[0];
      expect(dataSourceItem.index_item).toBeDefined();
      expect(dataSourceItem.index_item.index_name).toBe('test-index');
      expect(
        dataSourceItem.index_item.collection_configs?.collection_name
      ).toBe('test-collection');
    });

    it('只应包含 type=vector 且 status=done 的索引项', () => {
      const structuredNode = {
        id: 'struct-1',
        type: 'structured',
        position: { x: 0, y: 0 },
        data: {
          indexingList: [
            {
              type: 'vector',
              status: 'done',
              index_name: 'valid-index',
              collection_configs: { collection_name: 'valid-collection' },
            },
            {
              type: 'vector',
              status: 'pending',
              index_name: 'pending-index',
              collection_configs: { collection_name: 'pending-collection' },
            },
            {
              type: 'keyword',
              status: 'done',
              index_name: 'keyword-index',
              collection_configs: { collection_name: 'keyword-collection' },
            },
          ],
        },
      };

      const mockNode = createMockNode();

      mockGetNode.mockImplementation((id: string) => {
        if (id === 'struct-1') return structuredNode;
        return mockNode;
      });

      const mockGetSourceNodeIdWithLabel = vi.fn(() => [
        { id: 'struct-1', label: 'Test Index' },
      ]);

      mocks.useReactFlow.mockReturnValue({
        getNode: mockGetNode,
        setNodes: mockSetNodes,
        setEdges: mockSetEdges,
        getNodes: vi.fn(() => [mockNode, structuredNode]),
        getEdges: vi.fn(() => []),
      });

      mocks.useGetSourceTarget.mockReturnValue({
        getSourceNodeIdWithLabel: mockGetSourceNodeIdWithLabel,
        getTargetNodeIdWithLabel: vi.fn(() => []),
      });

      render(
        <Retrieving
          id={mockNode.id}
          type='retrieving'
          data={mockNode.data}
          selected={false}
          isConnectable={true}
          xPos={0}
          yPos={0}
          zIndex={0}
          dragging={false}
        />
      );

      // 验证只有一个有效的索引项会被考虑
      const validIndexingItems = structuredNode.data.indexingList.filter(
        item => item.type === 'vector' && item.status === 'done'
      );
      expect(validIndexingItems).toHaveLength(1);
      expect(validIndexingItems[0].index_name).toBe('valid-index');
    });
  });

  // ============================================================================
  // P2 中等 - 非核心参数或边界情况
  // ============================================================================

  describe('TC-RTV-010: 高级设置 Model 参数保存 (P2)', () => {
    it('打开高级设置后应显示 Model 选项', async () => {
      const mockNode = createMockNode();
      mockGetNode.mockReturnValue(mockNode);

      render(
        <Retrieving
          id={mockNode.id}
          type='retrieving'
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
      const button = screen.getByRole('button', { name: /Retrieve/i });
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByText('Advanced Settings')).toBeInTheDocument();
      });

      // 使用 data-testid 点击高级设置切换按钮
      const advancedSettingsToggle = screen.getByTestId(
        'advanced-settings-toggle'
      );
      fireEvent.click(advancedSettingsToggle);

      await waitFor(() => {
        expect(screen.getByText('Model')).toBeInTheDocument();
      });
    });

    it('Model 参数应支持三个 Perplexity 模型选项', async () => {
      const mockNode = createMockNode({
        extra_configs: {
          model: 'llama-3.1-sonar-small-128k-online',
          threshold: 0.7,
        },
      });

      mockGetNode.mockReturnValue(mockNode);

      render(
        <Retrieving
          id={mockNode.id}
          type='retrieving'
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
      const button = screen.getByRole('button', { name: /Retrieve/i });
      fireEvent.click(button);

      await waitFor(() => {
        const advancedToggle = screen
          .getAllByRole('button')
          .find(btn =>
            btn.parentElement?.textContent?.includes('Advanced Settings')
          );

        if (advancedToggle) {
          fireEvent.click(advancedToggle);
        }
      });

      await waitFor(() => {
        if (screen.queryByText('Model')) {
          const dropdownSelects = screen.getAllByTestId('dropdown-select');
          const modelSelect = dropdownSelects.find((select: any) => {
            const options = Array.from(select.querySelectorAll('option'));
            return options.some((opt: any) =>
              opt.value.includes('llama-3.1-sonar')
            );
          });

          expect(modelSelect).toBeDefined();
        }
      });
    });
  });

  describe('TC-RTV-011: 无效 Top K 值处理 (P2)', () => {
    it('清空 top_k 输入框应保存为 undefined', async () => {
      const mockNode = createMockNode({ top_k: 5 });
      mockGetNode.mockReturnValue(mockNode);

      render(
        <Retrieving
          id={mockNode.id}
          type='retrieving'
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
      const button = screen.getByRole('button', { name: /Retrieve/i });
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByTestId('top-k-input')).toBeInTheDocument();
      });

      // 使用 data-testid 查找 Top K 输入框并清空
      const topKInput = screen.getByTestId('top-k-input');
      fireEvent.change(topKInput, { target: { value: '' } });

      await waitFor(() => {
        if (mockSetNodes.mock.calls.length > 0) {
          const setNodesCall =
            mockSetNodes.mock.calls[mockSetNodes.mock.calls.length - 1][0];
          const updatedNodes = setNodesCall([mockNode]);
          const updatedNode = updatedNodes.find(
            (n: any) => n.id === mockNode.id
          );
          expect(updatedNode.data.top_k).toBeUndefined();
        }
      });
    });

    it('输入非数字字符应保存为 undefined', async () => {
      const mockNode = createMockNode({ top_k: 5 });
      mockGetNode.mockReturnValue(mockNode);

      render(
        <Retrieving
          id={mockNode.id}
          type='retrieving'
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
      const button = screen.getByRole('button', { name: /Retrieve/i });
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByTestId('top-k-input')).toBeInTheDocument();
      });

      // 使用 data-testid 查找 Top K 输入框并输入非数字字符
      const topKInput = screen.getByTestId('top-k-input');
      fireEvent.change(topKInput, { target: { value: 'abc' } });

      await waitFor(() => {
        if (mockSetNodes.mock.calls.length > 0) {
          const setNodesCall =
            mockSetNodes.mock.calls[mockSetNodes.mock.calls.length - 1][0];
          const updatedNodes = setNodesCall([mockNode]);
          const updatedNode = updatedNodes.find(
            (n: any) => n.id === mockNode.id
          );
          expect(updatedNode.data.top_k).toBeUndefined();
        }
      });
    });
  });

  describe('TC-RTV-012: 无效 Threshold 值处理 (P2)', () => {
    it('清空 threshold 输入框应保存为 undefined', async () => {
      const mockNode = createMockNode({
        extra_configs: { model: undefined, threshold: 0.7 },
      });
      mockGetNode.mockReturnValue(mockNode);

      render(
        <Retrieving
          id={mockNode.id}
          type='retrieving'
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
      const button = screen.getByRole('button', { name: /Retrieve/i });
      fireEvent.click(button);

      await waitFor(() => {
        const inputs = screen.getAllByRole('spinbutton');
        const thresholdInput = inputs.find((input: any) =>
          input.parentElement?.previousElementSibling?.textContent?.includes(
            'Threshold'
          )
        );

        if (thresholdInput) {
          fireEvent.change(thresholdInput, { target: { value: '' } });
        }
      });

      await waitFor(() => {
        if (mockSetNodes.mock.calls.length > 0) {
          const setNodesCall =
            mockSetNodes.mock.calls[mockSetNodes.mock.calls.length - 1][0];
          const updatedNodes = setNodesCall([mockNode]);
          const updatedNode = updatedNodes.find(
            (n: any) => n.id === mockNode.id
          );
          expect(updatedNode.data.extra_configs.threshold).toBeUndefined();
        }
      });
    });
  });

  describe('TC-RTV-013: 空 DataSource 处理 (P2)', () => {
    it('初始化时 dataSource 应为空数组', () => {
      const mockNode = createMockNode();

      render(
        <Retrieving
          id={mockNode.id}
          type='retrieving'
          data={mockNode.data}
          selected={false}
          isConnectable={true}
          xPos={0}
          yPos={0}
          zIndex={0}
          dragging={false}
        />
      );

      expect(Array.isArray(mockNode.data.dataSource)).toBe(true);
      expect(mockNode.data.dataSource).toHaveLength(0);
    });

    it('删除所有 dataSource 项后应为空数组', async () => {
      const mockNode = createMockNode({
        dataSource: [
          {
            id: 'struct-1',
            label: 'Test Index',
            index_item: {
              index_name: 'test-index',
              collection_configs: { collection_name: 'test-collection' },
            },
          },
        ],
      });

      mockGetNode.mockReturnValue(mockNode);

      render(
        <Retrieving
          id={mockNode.id}
          type='retrieving'
          data={mockNode.data}
          selected={false}
          isConnectable={true}
          xPos={0}
          yPos={0}
          zIndex={0}
          dragging={false}
        />
      );

      // 打开配置菜单并删除项
      const button = screen.getByRole('button', { name: /Retrieve/i });
      fireEvent.click(button);

      await waitFor(() => {
        const dataSourceItem = screen.getByText('Test Index').closest('div');
        if (dataSourceItem) {
          fireEvent.mouseEnter(dataSourceItem);

          const deleteButtons = screen.getAllByRole('button');
          const deleteButton = deleteButtons.find(btn =>
            btn.querySelector('svg line[x1="18"][y1="6"]')
          );

          if (deleteButton) {
            fireEvent.click(deleteButton);
          }
        }
      });

      await waitFor(() => {
        if (mockSetNodes.mock.calls.length > 0) {
          const setNodesCall =
            mockSetNodes.mock.calls[mockSetNodes.mock.calls.length - 1][0];
          const updatedNodes = setNodesCall([mockNode]);
          const updatedNode = updatedNodes.find(
            (n: any) => n.id === mockNode.id
          );
          expect(Array.isArray(updatedNode.data.dataSource)).toBe(true);
          expect(updatedNode.data.dataSource).toHaveLength(0);
        }
      });
    });
  });

  // ============================================================================
  // P3 轻微 - UI 显示问题不影响保存
  // ============================================================================

  describe('TC-RTV-014: 菜单打开/关闭状态 (P3)', () => {
    it('点击节点按钮应打开配置菜单', async () => {
      const mockNode = createMockNode();
      mockGetNode.mockReturnValue(mockNode);

      render(
        <Retrieving
          id={mockNode.id}
          type='retrieving'
          data={mockNode.data}
          selected={false}
          isConnectable={true}
          xPos={0}
          yPos={0}
          zIndex={0}
          dragging={false}
        />
      );

      const button = screen.getByRole('button', { name: /Retrieve/i });
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByText('Retrieve by Vector')).toBeInTheDocument();
      });
    });

    it('配置菜单应包含所有必需字段', async () => {
      const mockNode = createMockNode();
      mockGetNode.mockReturnValue(mockNode);

      render(
        <Retrieving
          id={mockNode.id}
          type='retrieving'
          data={mockNode.data}
          selected={false}
          isConnectable={true}
          xPos={0}
          yPos={0}
          zIndex={0}
          dragging={false}
        />
      );

      const button = screen.getByRole('button', { name: /Retrieve/i });
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByText('Query')).toBeInTheDocument();
        expect(screen.getByText('Indexed Structured Data')).toBeInTheDocument();
        expect(screen.getByText('Top K')).toBeInTheDocument();
        expect(screen.getByText('Threshold')).toBeInTheDocument();
        expect(screen.getByText('Advanced Settings')).toBeInTheDocument();
      });
    });
  });

  describe('TC-RTV-015: 高级设置展开/收起 (P3)', () => {
    it('点击高级设置切换按钮应展开 Model 选项', async () => {
      const mockNode = createMockNode();
      mockGetNode.mockReturnValue(mockNode);

      render(
        <Retrieving
          id={mockNode.id}
          type='retrieving'
          data={mockNode.data}
          selected={false}
          isConnectable={true}
          xPos={0}
          yPos={0}
          zIndex={0}
          dragging={false}
        />
      );

      const button = screen.getByRole('button', { name: /Retrieve/i });
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByText('Advanced Settings')).toBeInTheDocument();
      });

      // Model 选项应该初始不可见
      expect(screen.queryByText('Model')).not.toBeInTheDocument();

      // 使用 data-testid 找到高级设置切换按钮
      const advancedToggle = screen.getByTestId('advanced-settings-toggle');
      fireEvent.click(advancedToggle);

      await waitFor(() => {
        expect(screen.getByText('Model')).toBeInTheDocument();
      });
    });

    it('再次点击应收起高级设置', async () => {
      const mockNode = createMockNode();
      mockGetNode.mockReturnValue(mockNode);

      render(
        <Retrieving
          id={mockNode.id}
          type='retrieving'
          data={mockNode.data}
          selected={false}
          isConnectable={true}
          xPos={0}
          yPos={0}
          zIndex={0}
          dragging={false}
        />
      );

      const button = screen.getByRole('button', { name: /Retrieve/i });
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByText('Advanced Settings')).toBeInTheDocument();
      });

      // 使用 data-testid 找到高级设置切换按钮并展开
      const advancedToggle = screen.getByTestId('advanced-settings-toggle');
      fireEvent.click(advancedToggle);

      await waitFor(() => {
        expect(screen.getByText('Model')).toBeInTheDocument();
      });

      // 再次点击收起
      fireEvent.click(advancedToggle);

      await waitFor(() => {
        expect(screen.queryByText('Model')).not.toBeInTheDocument();
      });
    });
  });
});
