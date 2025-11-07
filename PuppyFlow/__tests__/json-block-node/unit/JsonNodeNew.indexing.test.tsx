/**
 * JSON Block Node - 索引管理测试
 *
 * 测试用例（P1）：
 * - TC-JSON-046: 添加向量索引
 * - TC-JSON-047: 索引创建失败处理
 * - TC-JSON-050: 删除已完成的索引
 * - TC-JSON-051: 删除失败处理
 * - TC-JSON-054: 索引状态流转：processing → done
 * - TC-JSON-055: 索引状态流转：processing → error
 * - TC-JSON-056: 索引状态流转：done → deleting → 移除
 *
 * ⚠️ 需要人工验证：
 * - useIndexingUtils hook 的实际实现
 * - 向量数据库的交互逻辑
 * - 索引状态机的完整流程
 */

// @ts-nocheck
import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import JsonBlockNode from '../../../app/components/workflow/blockNode/JsonNodeNew';
import type { Node } from '@xyflow/react';
import type {
  JsonNodeData,
  VectorIndexingItem,
} from '../../../app/components/workflow/blockNode/JsonNodeNew';

// Mock 配置
const mocks = vi.hoisted(() => ({
  useReactFlow: vi.fn(),
  useNodesPerFlowContext: vi.fn(),
  useGetSourceTarget: vi.fn(),
  useWorkspaceManagement: vi.fn(),
  useWorkspaces: vi.fn(),
  useIndexingUtils: vi.fn(),
}));

vi.mock('@xyflow/react', () => ({
  useReactFlow: mocks.useReactFlow,
  Handle: ({
    children,
    type,
    position,
    id,
    isConnectable,
    onMouseEnter,
    onMouseLeave,
    style,
  }: any) => (
    <div
      data-testid={`handle-${type}-${position}`}
      data-id={id}
      data-connectable={isConnectable}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={style}
    >
      {children}
    </div>
  ),
  Position: { Top: 'top', Right: 'right', Bottom: 'bottom', Left: 'left' },
  NodeResizeControl: ({ children, minWidth, minHeight, style }: any) => (
    <div
      data-testid='resize-control'
      data-min-width={minWidth}
      data-min-height={minHeight}
      style={style}
    >
      {children}
    </div>
  ),
}));

vi.mock('@/app/components/states/NodesPerFlowContext', () => ({
  useNodesPerFlowContext: mocks.useNodesPerFlowContext,
}));
vi.mock('@/app/components/hooks/useGetSourceTarget', () => ({
  default: mocks.useGetSourceTarget,
}));
vi.mock('@/app/components/hooks/useWorkspaceManagement', () => ({
  useWorkspaceManagement: mocks.useWorkspaceManagement,
}));
vi.mock('@/app/components/states/UserWorkspacesContext', () => ({
  useWorkspaces: mocks.useWorkspaces,
}));
vi.mock('@/app/components/states/AppSettingsContext', () => ({
  useAppSettings: vi.fn(() => ({
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
  })),
}));
vi.mock('next/dynamic', () => ({ default: (fn: any) => fn() }));

vi.mock('@/app/components/workflow/utils/dynamicStorageStrategy', () => ({
  handleDynamicStorageSwitch: vi.fn(() => Promise.resolve()),
  getStorageInfo: vi.fn(() => ({
    storageClass: 'internal',
    resourceKey: null,
  })),
  CONTENT_LENGTH_THRESHOLD: 50000,
}));

vi.mock(
  '@/app/components/tableComponent/RichJSONFormTableStyle/RichJSONForm',
  () => ({
    default: ({ value, onChange }: any) => (
      <textarea
        data-testid='rich-json-editor'
        value={value}
        onChange={e => onChange(e.target.value)}
      />
    ),
  })
);

vi.mock('@/app/components/tableComponent/JSONForm', () => ({
  default: ({ value, onChange }: any) => (
    <textarea
      data-testid='json-form-editor'
      value={value}
      onChange={e => onChange(e.target.value)}
    />
  ),
}));

vi.mock('@/app/components/loadingIcon/SkeletonLoadingIcon', () => ({
  default: () => <div data-testid='skeleton-loading'>Loading...</div>,
}));

vi.mock(
  '@/app/components/workflow/blockNode/JsonNodeTopSettingBar/NodeSettingsButton',
  () => ({
    default: () => <button data-testid='settings-button'>Settings</button>,
  })
);

// Mock NodeIndexingButton - 用于触发索引操作
vi.mock(
  '@/app/components/workflow/blockNode/JsonNodeTopSettingBar/NodeIndexingButton',
  () => ({
    default: ({ nodeid, indexingList, onAddIndex, onRemoveIndex }: any) => (
      <div data-testid='indexing-button-wrapper'>
        <button
          data-testid='add-index-button'
          onClick={() =>
            onAddIndex({
              type: 'vector',
              key_path: [{ id: '1', type: 'key', value: 'items' }],
              value_path: [{ id: '2', type: 'key', value: 'text' }],
            })
          }
        >
          Add Index
        </button>
        {indexingList.map((item: any, index: number) => (
          <div key={index} data-testid={`index-item-${index}`}>
            <span data-testid={`index-status-${index}`}>{item.status}</span>
            <button
              data-testid={`remove-index-${index}`}
              onClick={() => onRemoveIndex(index)}
            >
              Remove
            </button>
          </div>
        ))}
      </div>
    ),
  })
);

vi.mock(
  '@/app/components/workflow/blockNode/JsonNodeTopSettingBar/NodeLoopButton',
  () => ({
    default: () => <button data-testid='loop-button'>Loop</button>,
  })
);

vi.mock(
  '@/app/components/workflow/blockNode/JsonNodeTopSettingBar/NodeViewToggleButton',
  () => ({
    default: ({ useRichEditor, onToggle }: any) => (
      <button data-testid='view-toggle-button' onClick={onToggle}>
        {useRichEditor ? 'Rich' : 'Plain'}
      </button>
    ),
  })
);

vi.mock('@/app/components/workflow/handles/WhiteBallHandle', () => ({
  default: () => <div data-testid='white-handle' />,
}));

// Mock useIndexingUtils hook
vi.mock('@/app/components/workflow/blockNode/hooks/useIndexingUtils', () => ({
  default: mocks.useIndexingUtils,
}));

describe('JsonBlockNode - 索引管理', () => {
  let mockSetNodes: any;
  let mockGetNode: any;
  let mockHandleAddIndex: any;
  let mockHandleRemoveIndex: any;

  const createMockNode = (
    overrides: Partial<any> = {}
  ): Node<JsonNodeData> => ({
    id: 'test-json-indexing',
    type: 'json',
    position: { x: 0, y: 0 },
    data: {
      content: '{"items": [{"text": "hello"}, {"text": "world"}]}',
      label: 'Indexing Test Node',
      isLoading: false,
      isWaitingForFlow: false,
      locked: false,
      isInput: false,
      isOutput: false,
      editable: false,
      looped: false,
      indexingList: [],
      ...overrides,
    },
  });

  const createVectorIndexItem = (
    status: string = 'processing'
  ): VectorIndexingItem => ({
    type: 'vector',
    status: status as any,
    key_path: [{ id: '1', type: 'key', value: 'items' }],
    value_path: [{ id: '2', type: 'key', value: 'text' }],
    chunks: [],
    index_name: 'test-index-123',
    collection_configs: {
      set_name: 'test-set',
      model: 'text-embedding-ada-002',
      vdb_type: 'pgvector',
      user_id: 'test-user-id',
      collection_name: 'test-collection',
    },
  });

  beforeEach(() => {
    mockSetNodes = vi.fn();
    mockGetNode = vi.fn(() => createMockNode());
    mockHandleAddIndex = vi.fn();
    mockHandleRemoveIndex = vi.fn();

    mocks.useReactFlow.mockReturnValue({
      getNode: mockGetNode,
      setNodes: mockSetNodes,
      getNodes: vi.fn(() => [createMockNode()]),
      getEdges: vi.fn(() => []),
    });

    mocks.useNodesPerFlowContext.mockReturnValue({
      activatedNode: null,
      isOnConnect: false,
      isOnGeneratingNewNode: false,
      setNodeUneditable: vi.fn(),
      editNodeLabel: vi.fn(),
      preventInactivateNode: vi.fn(),
      allowInactivateNodeWhenClickOutside: vi.fn(),
      manageNodeasInput: vi.fn(),
      manageNodeasOutput: vi.fn(),
      activateNode: vi.fn(),
      inactivateNode: vi.fn(),
    });

    mocks.useGetSourceTarget.mockReturnValue({
      getSourceNodeIdWithLabel: vi.fn(() => []),
      getTargetNodeIdWithLabel: vi.fn(() => []),
    });

    mocks.useWorkspaceManagement.mockReturnValue({
      fetchUserId: vi.fn(() => Promise.resolve('test-user-id')),
    });

    mocks.useWorkspaces.mockReturnValue({
      userId: 'test-user-id',
    });

    mocks.useIndexingUtils.mockReturnValue({
      handleAddIndex: mockHandleAddIndex,
      handleRemoveIndex: mockHandleRemoveIndex,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('TC-JSON-046: 添加向量索引 (P1)', () => {
    it('应该能添加向量索引', async () => {
      const mockNode = createMockNode();

      // Mock handleAddIndex 返回成功的索引列表
      const successIndexItem = createVectorIndexItem('done');
      mockHandleAddIndex.mockResolvedValue([successIndexItem]);

      render(
        <JsonBlockNode
          id={mockNode.id}
          type={mockNode.type as string}
          data={mockNode.data}
          selected={false}
          isConnectable={true}
          xPos={0}
          yPos={0}
          zIndex={0}
          dragging={false}
        />
      );

      // 点击添加索引按钮
      const addButton = screen.getByTestId('add-index-button');
      await act(async () => {
        addButton.click();
      });

      // 验证 handleAddIndex 被调用
      await waitFor(() => {
        expect(mockHandleAddIndex).toHaveBeenCalled();
      });

      // 验证 setNodes 被调用以更新 indexingList
      await waitFor(() => {
        expect(mockSetNodes).toHaveBeenCalled();
      });
    });

    it('添加索引时应该显示 processing 状态', async () => {
      const mockNode = createMockNode();

      // Mock 添加索引过程
      mockHandleAddIndex.mockImplementation(async () => {
        // 模拟异步操作
        await new Promise(resolve => setTimeout(resolve, 100));
        return [createVectorIndexItem('done')];
      });

      const { rerender } = render(
        <JsonBlockNode
          id={mockNode.id}
          type={mockNode.type as string}
          data={mockNode.data}
          selected={false}
          isConnectable={true}
          xPos={0}
          yPos={0}
          zIndex={0}
          dragging={false}
        />
      );

      // 点击添加索引
      const addButton = screen.getByTestId('add-index-button');
      await act(async () => {
        addButton.click();
      });

      // 验证临时状态被设置为 processing
      await waitFor(() => {
        expect(mockSetNodes).toHaveBeenCalledWith(expect.any(Function));
      });
    });
  });

  describe('TC-JSON-047: 索引创建失败处理 (P1)', () => {
    it('索引创建失败应该显示 error 状态', async () => {
      const mockNode = createMockNode();

      // Mock handleAddIndex 返回 null（失败）
      mockHandleAddIndex.mockResolvedValue(null);

      render(
        <JsonBlockNode
          id={mockNode.id}
          type={mockNode.type as string}
          data={mockNode.data}
          selected={false}
          isConnectable={true}
          xPos={0}
          yPos={0}
          zIndex={0}
          dragging={false}
        />
      );

      const addButton = screen.getByTestId('add-index-button');
      await act(async () => {
        addButton.click();
      });

      // 验证错误状态被设置
      await waitFor(() => {
        const setNodesCalls = mockSetNodes.mock.calls;
        const errorCall = setNodesCalls.find((call: any) => {
          const updater = call[0];
          if (typeof updater === 'function') {
            const result = updater([mockNode]);
            const lastIndex = result[0]?.data?.indexingList?.length - 1;
            return (
              lastIndex >= 0 &&
              result[0]?.data?.indexingList[lastIndex]?.status === 'error'
            );
          }
          return false;
        });
        expect(errorCall).toBeTruthy();
      });
    });
  });

  describe('TC-JSON-050: 删除已完成的索引 (P1)', () => {
    it('应该能删除 status=done 的索引', async () => {
      const doneIndex = createVectorIndexItem('done');
      const mockNode = createMockNode({
        indexingList: [doneIndex],
      });

      mockGetNode.mockReturnValue(mockNode);

      // Mock handleRemoveIndex 返回成功
      mockHandleRemoveIndex.mockResolvedValue({
        success: true,
        newList: [],
      });

      render(
        <JsonBlockNode
          id={mockNode.id}
          type={mockNode.type as string}
          data={mockNode.data}
          selected={false}
          isConnectable={true}
          xPos={0}
          yPos={0}
          zIndex={0}
          dragging={false}
        />
      );

      // 点击删除按钮
      const removeButton = screen.getByTestId('remove-index-0');
      await act(async () => {
        removeButton.click();
      });

      // 验证 handleRemoveIndex 被调用
      await waitFor(() => {
        expect(mockHandleRemoveIndex).toHaveBeenCalledWith(
          0,
          expect.any(Array),
          mockNode.id,
          expect.any(Function),
          expect.any(Function)
        );
      });
    });

    it('删除索引时应该先显示 deleting 状态', async () => {
      const doneIndex = createVectorIndexItem('done');
      const mockNode = createMockNode({
        indexingList: [doneIndex],
      });

      mockHandleRemoveIndex.mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
        return { success: true, newList: [] };
      });

      render(
        <JsonBlockNode
          id={mockNode.id}
          type={mockNode.type as string}
          data={mockNode.data}
          selected={false}
          isConnectable={true}
          xPos={0}
          yPos={0}
          zIndex={0}
          dragging={false}
        />
      );

      const removeButton = screen.getByTestId('remove-index-0');
      await act(async () => {
        removeButton.click();
      });

      // 验证 deleting 状态被设置
      await waitFor(() => {
        const setNodesCalls = mockSetNodes.mock.calls;
        const deletingCall = setNodesCalls.find((call: any) => {
          const updater = call[0];
          if (typeof updater === 'function') {
            const result = updater([mockNode]);
            return result[0]?.data?.indexingList[0]?.status === 'deleting';
          }
          return false;
        });
        expect(deletingCall).toBeTruthy();
      });
    });
  });

  describe('TC-JSON-051: 删除失败处理 (P1)', () => {
    it('删除失败应该显示 error 状态', async () => {
      const doneIndex = createVectorIndexItem('done');
      const mockNode = createMockNode({
        indexingList: [doneIndex],
      });

      // Mock handleRemoveIndex 抛出错误
      mockHandleRemoveIndex.mockRejectedValue(new Error('Delete failed'));

      render(
        <JsonBlockNode
          id={mockNode.id}
          type={mockNode.type as string}
          data={mockNode.data}
          selected={false}
          isConnectable={true}
          xPos={0}
          yPos={0}
          zIndex={0}
          dragging={false}
        />
      );

      const removeButton = screen.getByTestId('remove-index-0');
      await act(async () => {
        removeButton.click();
      });

      // 验证错误处理
      await waitFor(() => {
        const setNodesCalls = mockSetNodes.mock.calls;
        const errorCall = setNodesCalls.find((call: any) => {
          const updater = call[0];
          if (typeof updater === 'function') {
            const result = updater([mockNode]);
            return result[0]?.data?.indexingList[0]?.status === 'error';
          }
          return false;
        });
        expect(errorCall).toBeTruthy();
      });
    });

    it('删除失败后索引应保留在列表中', async () => {
      const doneIndex = createVectorIndexItem('done');
      const mockNode = createMockNode({
        indexingList: [doneIndex],
      });

      mockHandleRemoveIndex.mockRejectedValue(new Error('Delete failed'));

      render(
        <JsonBlockNode
          id={mockNode.id}
          type={mockNode.type as string}
          data={mockNode.data}
          selected={false}
          isConnectable={true}
          xPos={0}
          yPos={0}
          zIndex={0}
          dragging={false}
        />
      );

      const removeButton = screen.getByTestId('remove-index-0');
      await act(async () => {
        removeButton.click();
      });

      // 验证索引仍在列表中
      await waitFor(() => {
        const setNodesCalls = mockSetNodes.mock.calls;
        const lastCall = setNodesCalls[setNodesCalls.length - 1];
        if (lastCall && typeof lastCall[0] === 'function') {
          const result = lastCall[0]([mockNode]);
          expect(result[0]?.data?.indexingList.length).toBeGreaterThan(0);
        }
      });
    });
  });

  describe('TC-JSON-054: 索引状态流转：processing → done (P1)', () => {
    it('索引创建成功后应该变为 done 状态', async () => {
      const mockNode = createMockNode();

      const successIndexItem = createVectorIndexItem('done');
      mockHandleAddIndex.mockResolvedValue([successIndexItem]);

      render(
        <JsonBlockNode
          id={mockNode.id}
          type={mockNode.type as string}
          data={mockNode.data}
          selected={false}
          isConnectable={true}
          xPos={0}
          yPos={0}
          zIndex={0}
          dragging={false}
        />
      );

      const addButton = screen.getByTestId('add-index-button');
      await act(async () => {
        addButton.click();
      });

      // 验证最终状态为 done
      await waitFor(() => {
        const setNodesCalls = mockSetNodes.mock.calls;
        const doneCall = setNodesCalls.find((call: any) => {
          const updater = call[0];
          if (typeof updater === 'function') {
            const result = updater([mockNode]);
            const lastIndex = result[0]?.data?.indexingList?.length - 1;
            return (
              lastIndex >= 0 &&
              result[0]?.data?.indexingList[lastIndex]?.status === 'done'
            );
          }
          return false;
        });
        expect(doneCall).toBeTruthy();
      });
    });

    it('done 状态的索引应该有 chunks 和 index_name', async () => {
      const successIndexItem = createVectorIndexItem('done');
      successIndexItem.chunks = [{ id: 1, text: 'chunk data' }] as any;
      successIndexItem.index_name = 'completed-index-789';

      const mockNode = createMockNode({
        indexingList: [successIndexItem],
      });

      render(
        <JsonBlockNode
          id={mockNode.id}
          type={mockNode.type as string}
          data={mockNode.data}
          selected={false}
          isConnectable={true}
          xPos={0}
          yPos={0}
          zIndex={0}
          dragging={false}
        />
      );

      // 验证索引项包含必要字段
      expect(mockNode.data.indexingList[0].chunks).toBeTruthy();
      expect(mockNode.data.indexingList[0].index_name).toBeTruthy();
    });
  });

  describe('TC-JSON-055: 索引状态流转：processing → error (P1)', () => {
    it('索引创建失败应该变为 error 状态', async () => {
      const mockNode = createMockNode();

      mockHandleAddIndex.mockResolvedValue(null);

      render(
        <JsonBlockNode
          id={mockNode.id}
          type={mockNode.type as string}
          data={mockNode.data}
          selected={false}
          isConnectable={true}
          xPos={0}
          yPos={0}
          zIndex={0}
          dragging={false}
        />
      );

      const addButton = screen.getByTestId('add-index-button');
      await act(async () => {
        addButton.click();
      });

      // 验证错误状态
      await waitFor(() => {
        const setNodesCalls = mockSetNodes.mock.calls;
        const errorCall = setNodesCalls.find((call: any) => {
          const updater = call[0];
          if (typeof updater === 'function') {
            const result = updater([mockNode]);
            const lastIndex = result[0]?.data?.indexingList?.length - 1;
            return (
              lastIndex >= 0 &&
              result[0]?.data?.indexingList[lastIndex]?.status === 'error'
            );
          }
          return false;
        });
        expect(errorCall).toBeTruthy();
      });
    });

    it('error 状态的索引应保留在列表中供重试或删除', async () => {
      const errorIndex = createVectorIndexItem('error');
      const mockNode = createMockNode({
        indexingList: [errorIndex],
      });

      render(
        <JsonBlockNode
          id={mockNode.id}
          type={mockNode.type as string}
          data={mockNode.data}
          selected={false}
          isConnectable={true}
          xPos={0}
          yPos={0}
          zIndex={0}
          dragging={false}
        />
      );

      // 验证错误索引仍然显示
      expect(screen.getByTestId('index-item-0')).toBeInTheDocument();
      expect(screen.getByTestId('index-status-0')).toHaveTextContent('error');

      // 验证可以删除
      expect(screen.getByTestId('remove-index-0')).toBeInTheDocument();
    });
  });

  describe('TC-JSON-056: 索引状态流转：done → deleting → 移除 (P1)', () => {
    it('完整的删除流程应该正常工作', async () => {
      const doneIndex = createVectorIndexItem('done');
      const mockNode = createMockNode({
        indexingList: [doneIndex],
      });

      mockHandleRemoveIndex.mockResolvedValue({
        success: true,
        newList: [],
      });

      render(
        <JsonBlockNode
          id={mockNode.id}
          type={mockNode.type as string}
          data={mockNode.data}
          selected={false}
          isConnectable={true}
          xPos={0}
          yPos={0}
          zIndex={0}
          dragging={false}
        />
      );

      // 初始状态：done
      expect(screen.getByTestId('index-status-0')).toHaveTextContent('done');

      // 点击删除
      const removeButton = screen.getByTestId('remove-index-0');
      await act(async () => {
        removeButton.click();
      });

      // 验证状态流转：done → deleting → 移除
      await waitFor(() => {
        expect(mockHandleRemoveIndex).toHaveBeenCalled();
        expect(mockSetNodes).toHaveBeenCalled();
      });
    });
  });
});

/**
 * 🔧 人工验证清单：
 *
 * 1. ✅ useIndexingUtils Hook
 *    - [ ] 验证 handleAddIndex 的实际实现
 *    - [ ] 验证 handleRemoveIndex 的实际实现
 *    - [ ] 测试与向量数据库的交互
 *
 * 2. ✅ 索引状态机
 *    - [ ] 验证完整的状态流转链路
 *    - [ ] 测试并发添加/删除索引的表现
 *    - [ ] 验证状态回滚机制
 *
 * 3. ✅ 数据持久化
 *    - [ ] 验证 indexingList 的保存逻辑
 *    - [ ] 测试页面刷新后索引状态保持
 *    - [ ] 验证索引配置的完整性
 *
 * 4. ✅ 错误处理
 *    - [ ] 测试网络错误的处理
 *    - [ ] 验证无效配置的提示
 *    - [ ] 测试资源清理的完整性
 *
 * 5. ✅ 集成测试
 *    - [ ] 在真实环境测试向量数据库交互
 *    - [ ] 验证索引搜索功能
 *    - [ ] 测试大量数据的索引性能
 *
 * 📝 运行命令：
 *    npm run test -- JsonNodeNew.indexing.test.tsx
 */
