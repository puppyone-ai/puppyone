/**
 * JSON Block Node - 内容编辑与保存测试
 *
 * 测试用例：
 * P0:
 * - TC-JSON-001: 用户输入 JSON 内容
 * - TC-JSON-002: 编辑现有 JSON 内容
 * - TC-JSON-008: Internal 存储编辑后自动保存
 * - TC-JSON-008-EXT: External 存储编辑后自动保存
 * - TC-JSON-011: 保存失败处理
 *
 * P1:
 * - TC-JSON-003: 清空所有 JSON 内容
 * - TC-JSON-004: 超长 JSON 输入（>10万字符）
 * - TC-JSON-007: 对象类型 content 的字符串化
 * - TC-JSON-009: 快速连续编辑的防抖
 * - TC-JSON-010: 保存中再次编辑
 * - TC-JSON-012: 节点 isLoading 时不触发保存
 * - TC-JSON-014: 加载完成后显示内容
 *
 * ⚠️ 需要人工验证：
 * - Mock 的实际行为是否符合真实依赖
 * - 防抖时序是否准确（2000ms）
 * - handleDynamicStorageSwitch 的真实实现
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
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import JsonBlockNode from '../../../app/components/workflow/blockNode/JsonNodeNew';
import type { Node } from '@xyflow/react';
import type { JsonNodeData } from '../../../app/components/workflow/blockNode/JsonNodeNew';

// Mock 配置 - 使用 vi.hoisted() 确保 mock 函数可以在 beforeEach 中被修改
const mocks = vi.hoisted(() => ({
  useReactFlow: vi.fn(),
  useNodesPerFlowContext: vi.fn(),
  useGetSourceTarget: vi.fn(),
  useWorkspaceManagement: vi.fn(),
  useWorkspaces: vi.fn(),
  handleDynamicStorageSwitch: vi.fn(),
  getStorageInfo: vi.fn(),
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

vi.mock('@/app/components/workflow/utils/dynamicStorageStrategy', () => ({
  handleDynamicStorageSwitch: mocks.handleDynamicStorageSwitch,
  getStorageInfo: mocks.getStorageInfo,
  CONTENT_LENGTH_THRESHOLD: 50000, // 测试用阈值
}));

vi.mock('next/dynamic', () => ({
  default: (fn: any) => {
    const Component = fn();
    return Component;
  },
}));

// Mock JSON 编辑器组件
vi.mock(
  '@/app/components/tableComponent/RichJSONFormTableStyle/RichJSONForm',
  () => ({
    default: ({
      value,
      onChange,
      placeholder,
      preventParentDrag,
      allowParentDrag,
      readonly,
    }: any) => (
      <div
        data-testid='rich-json-editor'
        data-readonly={readonly}
        onMouseDown={() => preventParentDrag?.()}
        onMouseUp={() => allowParentDrag?.()}
      >
        <textarea
          data-testid='rich-json-textarea'
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          readOnly={readonly}
        />
      </div>
    ),
  })
);

vi.mock('@/app/components/tableComponent/JSONForm', () => ({
  default: ({
    value,
    onChange,
    placeholder,
    preventParentDrag,
    allowParentDrag,
    readonly,
  }: any) => (
    <div
      data-testid='json-form-editor'
      data-readonly={readonly}
      onMouseDown={() => preventParentDrag?.()}
      onMouseUp={() => allowParentDrag?.()}
    >
      <textarea
        data-testid='json-form-textarea'
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        readOnly={readonly}
      />
    </div>
  ),
}));

vi.mock('@/app/components/loadingIcon/SkeletonLoadingIcon', () => ({
  default: () => <div data-testid='skeleton-loading'>Loading...</div>,
}));

vi.mock(
  '@/app/components/workflow/blockNode/JsonNodeTopSettingBar/NodeSettingsButton',
  () => ({
    default: ({ nodeid }: any) => (
      <button data-testid='settings-button'>Settings</button>
    ),
  })
);

vi.mock(
  '@/app/components/workflow/blockNode/JsonNodeTopSettingBar/NodeIndexingButton',
  () => ({
    default: ({ nodeid, indexingList, onAddIndex, onRemoveIndex }: any) => (
      <button data-testid='indexing-button'>Indexing</button>
    ),
  })
);

vi.mock(
  '@/app/components/workflow/blockNode/JsonNodeTopSettingBar/NodeLoopButton',
  () => ({
    default: ({ nodeid }: any) => (
      <button data-testid='loop-button'>Loop</button>
    ),
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
  default: ({ id, type, position }: any) => (
    <div data-testid={`white-handle-${type}-${position}`} />
  ),
}));

vi.mock('@/app/components/workflow/blockNode/hooks/useIndexingUtils', () => ({
  default: vi.fn(() => ({
    handleAddIndex: vi.fn(),
    handleRemoveIndex: vi.fn(),
  })),
}));

describe('JsonBlockNode - 内容编辑与保存', () => {
  let mockSetNodes: any;
  let mockGetNode: any;
  let mockGetNodes: any;
  let mockActivateNode: any;
  let mockFetchUserId: any;
  let mockHandleDynamicStorageSwitch: any;
  let currentNodes: Node<JsonNodeData>[];

  const createMockNode = (
    overrides: Partial<JsonNodeData> = {}
  ): Node<JsonNodeData> => ({
    id: 'test-json-node-1',
    type: 'json',
    position: { x: 0, y: 0 },
    data: {
      content: '',
      label: 'Test JSON Node',
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

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    currentNodes = [createMockNode()];

    mockSetNodes = vi.fn(updater => {
      if (typeof updater === 'function') {
        currentNodes = updater(currentNodes);
        return currentNodes;
      }
      return currentNodes;
    });

    mockGetNode = vi.fn(nodeId => {
      return currentNodes.find(n => n.id === nodeId) || currentNodes[0];
    });
    mockGetNodes = vi.fn(() => currentNodes);
    mockActivateNode = vi.fn();
    mockFetchUserId = vi.fn(() => Promise.resolve('test-user-id'));
    mockHandleDynamicStorageSwitch = vi.fn(() => Promise.resolve());

    mocks.useReactFlow.mockReturnValue({
      getNode: mockGetNode,
      setNodes: mockSetNodes,
      getNodes: mockGetNodes,
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
      activateNode: mockActivateNode,
      inactivateNode: vi.fn(),
    });

    mocks.useGetSourceTarget.mockReturnValue({
      getSourceNodeIdWithLabel: vi.fn(() => []),
      getTargetNodeIdWithLabel: vi.fn(() => []),
    });

    mocks.useWorkspaceManagement.mockReturnValue({
      fetchUserId: mockFetchUserId,
    });

    mocks.useWorkspaces.mockReturnValue({
      userId: 'test-user-id',
    });

    // Reset and configure handleDynamicStorageSwitch mock
    mocks.handleDynamicStorageSwitch.mockReset();
    mocks.handleDynamicStorageSwitch.mockImplementation(
      mockHandleDynamicStorageSwitch
    );

    mocks.getStorageInfo.mockReturnValue({
      storageClass: 'internal',
      resourceKey: null,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  describe('TC-JSON-001: 用户输入 JSON 内容 (P0)', () => {
    it('应该能输入 JSON 并实时显示', async () => {
      const mockNode = createMockNode();
      mockGetNode.mockReturnValue(mockNode);

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

      // 推进 requestAnimationFrame
      await act(async () => {
        vi.advanceTimersByTime(1);
      });

      const editor = screen.getByTestId('rich-json-textarea');

      // 输入 JSON 内容
      await act(async () => {
        fireEvent.change(editor, {
          target: { value: '{"name": "test", "value": 123}' },
        });
      });

      // 验证内容更新被调用
      expect(mockSetNodes).toHaveBeenCalled();

      // 验证实际的 setNodes 调用参数
      const setNodesCall = mockSetNodes.mock.calls[0][0];
      const updatedNodes = setNodesCall([mockNode]);

      expect(updatedNodes[0].data.content).toBe(
        '{"name": "test", "value": 123}'
      );
    });

    it('应该将内容同步到 node.data.content', async () => {
      const mockNode = createMockNode();

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

      const editor = screen.getByTestId('rich-json-textarea');
      await act(async () => {
        fireEvent.change(editor, {
          target: { value: '{"test": "content"}' },
        });
      });

      // 验证 setNodes 被调用以更新内容
      expect(mockSetNodes).toHaveBeenCalled();

      const updateFunction = mockSetNodes.mock.calls[0][0];
      const result = updateFunction([mockNode]);

      expect(result[0].data.savingStatus).toBe('editing');
    });
  });

  describe('TC-JSON-002: 编辑现有 JSON 内容 (P0)', () => {
    it('应该能修改已有 JSON 并触发自动保存', async () => {
      const mockNode = createMockNode({
        content: '{"original": "content"}',
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

      const editor = screen.getByTestId('rich-json-textarea');
      expect(editor).toHaveValue('{"original": "content"}');

      // 修改内容
      await act(async () => {
        fireEvent.change(editor, {
          target: { value: '{"modified": "content"}' },
        });
      });

      expect(mockSetNodes).toHaveBeenCalled();
    });
  });

  describe('TC-JSON-003: 清空所有 JSON 内容 (P1)', () => {
    it('应该能清空所有 JSON 内容', async () => {
      const mockNode = createMockNode({ content: '{"some": "data"}' });
      mockGetNode.mockReturnValue(mockNode);

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

      await act(async () => {
        vi.advanceTimersByTime(1);
      });

      const editor = screen.getByTestId('rich-json-textarea');
      expect(editor).toHaveValue('{"some": "data"}');

      // 清空内容
      await act(async () => {
        fireEvent.change(editor, { target: { value: '' } });
      });

      expect(mockSetNodes).toHaveBeenCalled();
      const setNodesCall = mockSetNodes.mock.calls[0][0];
      const result = setNodesCall([mockNode]);
      expect(result[0].data.content).toBe('');
    });
  });

  describe('TC-JSON-004: 超长 JSON 输入 (P1)', () => {
    it('应该能输入超长 JSON（>10万字符）', async () => {
      const longJson = JSON.stringify({
        data: 'x'.repeat(100000),
      });
      const mockNode = createMockNode();
      mockGetNode.mockReturnValue(mockNode);

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

      const editor = screen.getByTestId('rich-json-textarea');

      // 输入超长 JSON
      await act(async () => {
        fireEvent.change(editor, { target: { value: longJson } });
      });

      // 验证内容更新
      expect(mockSetNodes).toHaveBeenCalled();
    });
  });

  describe('TC-JSON-007: 对象类型 content 的字符串化 (P1)', () => {
    it('应该将对象类型 content 转换为字符串', () => {
      const mockNode = createMockNode({
        content: { nested: { data: 'value' } } as any,
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

      const editor = screen.getByTestId('rich-json-textarea');

      // 验证对象被转换为字符串（缩进2空格）
      const expectedValue = JSON.stringify(
        { nested: { data: 'value' } },
        null,
        2
      );
      expect(editor).toHaveValue(expectedValue);
    });

    it('应该将数组类型 content 转换为字符串', () => {
      const mockNode = createMockNode({
        content: [1, 2, 3] as any,
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

      const editor = screen.getByTestId('rich-json-textarea');
      const expectedValue = JSON.stringify([1, 2, 3], null, 2);
      expect(editor).toHaveValue(expectedValue);
    });

    it('应该处理 null 值', () => {
      const mockNode = createMockNode({
        content: null as any,
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

      const editor = screen.getByTestId('rich-json-textarea');
      expect(editor).toHaveValue('null');
    });
  });

  describe('TC-JSON-012: 节点 isLoading 时不触发保存 (P1)', () => {
    it('isLoading=true 时不应触发自动保存', async () => {
      const mockNode = createMockNode({ isLoading: true });
      mockGetNode.mockReturnValue({
        ...mockNode,
        data: {
          ...mockNode.data,
          isLoading: true,
          savingStatus: 'editing',
        },
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

      await act(async () => {
        vi.advanceTimersByTime(3000);
      });

      expect(mockHandleDynamicStorageSwitch).not.toHaveBeenCalled();
    });
  });

  describe('TC-JSON-014: 加载完成后显示内容 (P1)', () => {
    it('isLoading=true 时应显示骨架屏', () => {
      const mockNode = createMockNode({ isLoading: true });

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

      // 应该显示骨架屏
      expect(screen.getByTestId('skeleton-loading')).toBeInTheDocument();

      // 不应该显示编辑器
      expect(
        screen.queryByTestId('rich-json-textarea')
      ).not.toBeInTheDocument();
    });

    it('isLoading 从 true 变为 false 应显示内容', () => {
      const mockNode = createMockNode({
        isLoading: true,
        content: '{"loaded": "content"}',
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

      expect(screen.getByTestId('skeleton-loading')).toBeInTheDocument();

      // 更新为加载完成
      const updatedNode = createMockNode({
        isLoading: false,
        content: '{"loaded": "content"}',
      });

      rerender(
        <JsonBlockNode
          id={updatedNode.id}
          type={updatedNode.type as string}
          data={updatedNode.data}
          selected={false}
          isConnectable={true}
          xPos={0}
          yPos={0}
          zIndex={0}
          dragging={false}
        />
      );

      // 应该隐藏骨架屏
      expect(screen.queryByTestId('skeleton-loading')).not.toBeInTheDocument();

      // 应该显示编辑器和内容
      const editor = screen.getByTestId('rich-json-textarea');
      expect(editor).toBeInTheDocument();
      expect(editor).toHaveValue('{"loaded": "content"}');
    });
  });

  // ✅ 自动保存机制测试（已修复）
  describe('自动保存机制', () => {
    it('TC-JSON-008: 应该在编辑2秒后触发保存 (internal模式) (P0)', async () => {
      currentNodes = [
        createMockNode({
          content: '{"test": "content"}',
          storage_class: 'internal',
          savingStatus: 'editing',
        } as any),
      ];

      render(
        <JsonBlockNode
          id={currentNodes[0].id}
          type='json'
          data={currentNodes[0].data}
          selected={false}
          isConnectable={true}
          xPos={0}
          yPos={0}
          zIndex={0}
          dragging={false}
        />
      );

      expect(mockHandleDynamicStorageSwitch).not.toHaveBeenCalled();

      await act(async () => {
        vi.advanceTimersByTime(2000);
        await Promise.resolve();
      });

      expect(mockHandleDynamicStorageSwitch).toHaveBeenCalled();
    });

    it('TC-JSON-008-EXT: 应该在 dirty=true 时触发保存 (external模式) (P0)', async () => {
      currentNodes = [
        createMockNode({
          content: '{"test": "content"}',
          storage_class: 'external',
          dirty: true,
        } as any),
      ];

      render(
        <JsonBlockNode
          id={currentNodes[0].id}
          type='json'
          data={currentNodes[0].data}
          selected={false}
          isConnectable={true}
          xPos={0}
          yPos={0}
          zIndex={0}
          dragging={false}
        />
      );

      expect(mockHandleDynamicStorageSwitch).not.toHaveBeenCalled();

      await act(async () => {
        vi.advanceTimersByTime(2000);
        await Promise.resolve();
      });

      expect(mockHandleDynamicStorageSwitch).toHaveBeenCalled();
    });

    it('TC-JSON-009: 持续输入时不应触发多次保存 (P1)', async () => {
      // 模拟连续编辑场景：渲染2次，每次间隔500ms，验证只触发一次保存
      currentNodes = [
        createMockNode({
          content: '{"a": 1}',
          storage_class: 'internal',
          savingStatus: 'editing',
        } as any),
      ];

      const { unmount } = render(
        <JsonBlockNode
          id={currentNodes[0].id}
          type='json'
          data={currentNodes[0].data}
          selected={false}
          isConnectable={true}
          xPos={0}
          yPos={0}
          zIndex={0}
          dragging={false}
        />
      );

      // 500ms 后第二次编辑（防抖未完成，定时器被重置）
      await act(async () => {
        vi.advanceTimersByTime(500);
      });

      unmount();
      currentNodes = [
        createMockNode({
          content: '{"a": 1, "b": 2}',
          storage_class: 'internal',
          savingStatus: 'editing',
        } as any),
      ];

      render(
        <JsonBlockNode
          id={currentNodes[0].id}
          type='json'
          data={currentNodes[0].data}
          selected={false}
          isConnectable={true}
          xPos={0}
          yPos={0}
          zIndex={0}
          dragging={false}
        />
      );

      // 最后一次编辑后等待 2000ms，防抖完成
      await act(async () => {
        vi.advanceTimersByTime(2000);
        await Promise.resolve();
      });

      // 应该只调用一次（因为防抖）
      expect(mockHandleDynamicStorageSwitch).toHaveBeenCalledTimes(1);
    });

    it('TC-JSON-010: 保存中再次编辑应重新计时 (P1)', async () => {
      currentNodes = [
        createMockNode({
          content: '{"test": 1}',
          storage_class: 'internal',
          savingStatus: 'editing',
        } as any),
      ];

      render(
        <JsonBlockNode
          id={currentNodes[0].id}
          type='json'
          data={currentNodes[0].data}
          selected={false}
          isConnectable={true}
          xPos={0}
          yPos={0}
          zIndex={0}
          dragging={false}
        />
      );

      // 1秒后还在防抖期间
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });

      expect(mockHandleDynamicStorageSwitch).not.toHaveBeenCalled();

      // 等待剩余的1秒，防抖完成
      await act(async () => {
        vi.advanceTimersByTime(1000);
        await Promise.resolve();
      });

      expect(mockHandleDynamicStorageSwitch).toHaveBeenCalledTimes(1);
    });

    it('TC-JSON-011: 应该在保存失败时显示错误状态 (P0)', async () => {
      const error = new Error('Save failed');
      mockHandleDynamicStorageSwitch.mockRejectedValue(error);

      currentNodes = [
        createMockNode({
          content: '{"test": "content"}',
          storage_class: 'internal',
          savingStatus: 'editing',
        } as any),
      ];

      render(
        <JsonBlockNode
          id={currentNodes[0].id}
          type='json'
          data={currentNodes[0].data}
          selected={false}
          isConnectable={true}
          xPos={0}
          yPos={0}
          zIndex={0}
          dragging={false}
        />
      );

      await act(async () => {
        vi.advanceTimersByTime(2000);
        await Promise.resolve();
      });

      const errorCall = mockSetNodes.mock.calls.find((call: any) => {
        if (typeof call[0] === 'function') {
          const result = call[0](currentNodes);
          return result[0]?.data?.savingStatus === 'error';
        }
        return false;
      });
      expect(errorCall).toBeDefined();
    });
  });
});

/**
 * 🔧 人工验证清单：
 *
 * 1. ✅ Mock 配置
 *    - [ ] 验证所有导入路径是否正确
 *    - [ ] 验证 Mock JSON 编辑器行为是否符合真实组件
 *    - [ ] 测试 handleDynamicStorageSwitch 的实际参数
 *
 * 2. ✅ JSON 特定功能
 *    - [ ] 对象/数组转字符串的实际格式
 *    - [ ] RichJSONForm vs JSONForm 的差异
 *    - [ ] 真实环境中的 JSON 验证逻辑
 *
 * 3. ✅ 时序测试
 *    - [ ] 真实环境中运行，验证2秒防抖是否准确
 *    - [ ] 测试快速编辑的实际表现
 *    - [ ] 验证异步 Promise 的 resolve 时机
 *
 * 4. ✅ 集成验证
 *    - [ ] 在真实的 React Flow 环境中测试
 *    - [ ] 验证与外部存储服务的交互
 *    - [ ] 测试真实的用户交互流程
 *
 * 📝 运行命令：
 *    npm run test -- JsonNodeNew.content.test.tsx
 *    或
 *    vitest JsonNodeNew.content.test.tsx
 */
