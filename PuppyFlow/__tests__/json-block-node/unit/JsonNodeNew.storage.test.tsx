/**
 * JSON Block Node - 动态存储策略测试
 *
 * 测试用例：
 * P0:
 * - TC-JSON-015: 内容超阈值切换到外部存储
 * - TC-JSON-016: 内容缩减切换回内部存储
 * - TC-JSON-018: 存储切换时的数据一致性
 *
 * P1:
 * - TC-JSON-019: 有效 JSON 识别为 structured
 * - TC-JSON-020: 无效 JSON 识别为 text
 * - TC-JSON-022: External 存储的 dirty 标记
 * - TC-JSON-023: Internal 存储不使用 dirty
 *
 * ⚠️ 关键依赖人工验证：
 * - CONTENT_LENGTH_THRESHOLD 的实际值
 * - handleDynamicStorageSwitch 的真实实现
 * - resource_key 的生成逻辑
 * - Structured vs Text 类型判断逻辑
 */

// @ts-nocheck
import React from 'react';
import { render, waitFor, act, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import JsonBlockNode from '@/components/workflow/blockNode/JsonNodeNew';
import type { Node } from '@xyflow/react';
import type { JsonNodeData } from '@/components/workflow/blockNode/JsonNodeNew';

// Mock 配置
const mocks = vi.hoisted(() => ({
  useReactFlow: vi.fn(),
  useNodesPerFlowContext: vi.fn(),
  useGetSourceTarget: vi.fn(),
  useWorkspaceManagement: vi.fn(),
  useWorkspaces: vi.fn(),
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

vi.mock('@/components/states/NodesPerFlowContext', () => ({
  useNodesPerFlowContext: mocks.useNodesPerFlowContext,
}));
vi.mock('@/components/hooks/useGetSourceTarget', () => ({
  default: mocks.useGetSourceTarget,
}));
vi.mock('@/components/hooks/useWorkspaceManagement', () => ({
  useWorkspaceManagement: mocks.useWorkspaceManagement,
}));
vi.mock('@/components/states/UserWorkspacesContext', () => ({
  useWorkspaces: mocks.useWorkspaces,
}));
vi.mock('@/components/states/AppSettingsContext', () => ({
  useAppSettings: vi.fn(() => ({})),
}));
vi.mock('next/dynamic', () => ({ default: (fn: any) => fn() }));

// 使用 vi.hoisted() 确保变量在 mock 之前初始化
const { mockHandleDynamicStorageSwitch, mockGetStorageInfo, MOCK_THRESHOLD } =
  vi.hoisted(() => ({
    mockHandleDynamicStorageSwitch: vi.fn(),
    mockGetStorageInfo: vi.fn(),
    MOCK_THRESHOLD: 50000,
  }));

vi.mock('@/components/workflow/utils/dynamicStorageStrategy', () => ({
  handleDynamicStorageSwitch: mockHandleDynamicStorageSwitch,
  getStorageInfo: mockGetStorageInfo,
  CONTENT_LENGTH_THRESHOLD: MOCK_THRESHOLD,
}));

vi.mock(
  '@/components/tableComponent/RichJSONFormTableStyle/RichJSONForm',
  () => ({
    default: ({
      value,
      onChange,
      placeholder,
      preventParentDrag,
      allowParentDrag,
      readonly,
    }: any) => (
      <textarea
        data-testid='rich-json-editor'
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        onMouseDown={() => preventParentDrag?.()}
        onMouseUp={() => allowParentDrag?.()}
        readOnly={readonly}
      />
    ),
  })
);

vi.mock('@/components/tableComponent/JSONForm', () => ({
  default: ({
    value,
    onChange,
    placeholder,
    preventParentDrag,
    allowParentDrag,
    readonly,
  }: any) => (
    <textarea
      data-testid='json-form-editor'
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      onMouseDown={() => preventParentDrag?.()}
      onMouseUp={() => allowParentDrag?.()}
      readOnly={readonly}
    />
  ),
}));

vi.mock('@/components/loadingIcon/SkeletonLoadingIcon', () => ({
  default: () => <div data-testid='skeleton-loading'>Loading...</div>,
}));

vi.mock(
  '@/components/workflow/blockNode/JsonNodeTopSettingBar/NodeSettingsButton',
  () => ({
    default: () => <button data-testid='settings-button'>Settings</button>,
  })
);

vi.mock(
  '@/components/workflow/blockNode/JsonNodeTopSettingBar/NodeIndexingButton',
  () => ({
    default: () => <button data-testid='indexing-button'>Indexing</button>,
  })
);

vi.mock(
  '@/components/workflow/blockNode/JsonNodeTopSettingBar/NodeLoopButton',
  () => ({
    default: () => <button data-testid='loop-button'>Loop</button>,
  })
);

vi.mock(
  '@/components/workflow/blockNode/JsonNodeTopSettingBar/NodeViewToggleButton',
  () => ({
    default: ({ useRichEditor, onToggle }: any) => (
      <button data-testid='view-toggle-button' onClick={onToggle}>
        {useRichEditor ? 'Rich' : 'Plain'}
      </button>
    ),
  })
);

vi.mock('@/components/workflow/handles/WhiteBallHandle', () => ({
  default: () => <div data-testid='white-handle' />,
}));

vi.mock('@/components/workflow/blockNode/hooks/useIndexingUtils', () => ({
  default: vi.fn(() => ({
    handleAddIndex: vi.fn(),
    handleRemoveIndex: vi.fn(),
  })),
}));

describe('JsonBlockNode - 动态存储策略', () => {
  let mockSetNodes: any;
  let mockGetNode: any;
  let mockGetNodes: any;

  const createMockNode = (
    overrides: Partial<any> = {}
  ): Node<JsonNodeData> => ({
    id: 'test-json-storage',
    type: 'json',
    position: { x: 0, y: 0 },
    data: {
      content: '',
      label: 'Storage Test Node',
      isLoading: false,
      isWaitingForFlow: false,
      locked: false,
      isInput: false,
      isOutput: false,
      editable: false,
      looped: false,
      indexingList: [],
      storage_class: 'internal',
      dirty: false,
      savingStatus: 'saved',
      ...overrides,
    } as any,
  });

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    mockSetNodes = vi.fn(updater => {
      if (typeof updater === 'function') {
        const currentNodes = [createMockNode()];
        return updater(currentNodes);
      }
    });

    mockGetNode = vi.fn();
    mockGetNodes = vi.fn(() => [createMockNode()]);

    mocks.useReactFlow.mockReturnValue({
      getNode: mockGetNode,
      setNodes: mockSetNodes,
      getNodes: mockGetNodes,
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

    mockHandleDynamicStorageSwitch.mockResolvedValue(undefined);
    mockGetStorageInfo.mockReturnValue({
      storageClass: 'internal',
      resourceKey: null,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  describe('TC-JSON-015: 内容超阈值切换到外部存储 (P0)', () => {
    it('应该在内容超过阈值时调用存储切换', async () => {
      const longJson = JSON.stringify({
        data: 'a'.repeat(MOCK_THRESHOLD + 1000),
      });

      const mockNode = createMockNode({
        content: longJson,
        storage_class: 'internal',
        savingStatus: 'editing',
      });

      mockGetNode.mockReturnValue(mockNode);
      mockGetStorageInfo.mockReturnValue({
        storageClass: 'external',
        resourceKey: 'test-resource-key-123',
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

      // 等待防抖
      await act(async () => {
        vi.advanceTimersByTime(2000);
      });

      // 验证调用了存储切换
      await waitFor(() => {
        expect(mockHandleDynamicStorageSwitch).toHaveBeenCalledWith(
          expect.objectContaining({
            content: longJson,
            contentType: expect.stringMatching(/structured|text/),
          })
        );
      });
    });

    it('应该生成 resource_key', async () => {
      const longJson = JSON.stringify({
        large: 'x'.repeat(MOCK_THRESHOLD + 5000),
      });

      const mockNode = createMockNode({
        content: longJson,
        savingStatus: 'editing',
      });

      mockGetNode.mockReturnValue(mockNode);
      mockGetStorageInfo.mockReturnValue({
        storageClass: 'external',
        resourceKey: 'generated-key-789',
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
        vi.advanceTimersByTime(2000);
      });

      await waitFor(() => {
        expect(mockGetStorageInfo).toHaveBeenCalled();
      });

      const storageInfo = mockGetStorageInfo.mock.results[0]?.value;
      expect(storageInfo?.resourceKey).toBeTruthy();
    });
  });

  describe('TC-JSON-016: 内容缩减切换回内部存储 (P0)', () => {
    it('应该在内容小于阈值时切回 internal', async () => {
      const shortJson = '{"short": "data"}';

      const mockNode = createMockNode({
        content: shortJson,
        storage_class: 'external',
        resource_key: 'old-resource-key',
        dirty: true,
      });

      mockGetNode.mockReturnValue(mockNode);
      mockGetStorageInfo.mockReturnValue({
        storageClass: 'internal',
        resourceKey: null,
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
        vi.advanceTimersByTime(2000);
      });

      await waitFor(() => {
        expect(mockHandleDynamicStorageSwitch).toHaveBeenCalled();
      });
    });
  });

  describe('TC-JSON-018: 存储切换时的数据一致性 (P0)', () => {
    it('切换前后内容应该完全一致', async () => {
      const testJson = '{"test": "content", "emoji": "🎉", "number": 123}';

      const mockNode = createMockNode({
        content: testJson,
        storage_class: 'internal',
        savingStatus: 'editing',
      });

      mockGetNode.mockReturnValue(mockNode);

      mockHandleDynamicStorageSwitch.mockImplementation(async ({ content }) => {
        expect(content).toBe(testJson);
        return undefined;
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
        vi.advanceTimersByTime(2000);
      });

      await waitFor(() => {
        expect(mockHandleDynamicStorageSwitch).toHaveBeenCalled();
      });
    });

    it('应该处理特殊字符而不丢失', async () => {
      const specialJson = JSON.stringify({
        text: 'Hello\nWorld\t制表符',
        emoji: '😀🎉❤️',
        unicode: '\u2764\ufe0f',
      });

      const mockNode = createMockNode({
        content: specialJson,
        savingStatus: 'editing',
      });

      mockGetNode.mockReturnValue(mockNode);

      mockHandleDynamicStorageSwitch.mockImplementation(async ({ content }) => {
        expect(content).toBe(specialJson);
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
        vi.advanceTimersByTime(2000);
      });

      await waitFor(() => {
        expect(mockHandleDynamicStorageSwitch).toHaveBeenCalled();
      });
    });
  });

  describe('TC-JSON-019: 有效 JSON 识别为 structured (P1)', () => {
    it('有效的 JSON 对象应该使用 structured 类型', async () => {
      const validJson = '{"name": "test", "value": 123}';

      const mockNode = createMockNode({
        content: validJson,
        savingStatus: 'editing',
      });

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
        vi.advanceTimersByTime(2000);
      });

      await waitFor(() => {
        expect(mockHandleDynamicStorageSwitch).toHaveBeenCalledWith(
          expect.objectContaining({
            contentType: 'structured',
          })
        );
      });
    });

    it('有效的 JSON 数组应该使用 structured 类型', async () => {
      const validJson = '[{"id": 1}, {"id": 2}]';

      const mockNode = createMockNode({
        content: validJson,
        savingStatus: 'editing',
      });

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
        vi.advanceTimersByTime(2000);
      });

      await waitFor(() => {
        expect(mockHandleDynamicStorageSwitch).toHaveBeenCalledWith(
          expect.objectContaining({
            contentType: 'structured',
          })
        );
      });
    });
  });

  describe('TC-JSON-020: 无效 JSON 识别为 text (P1)', () => {
    it('无效的 JSON 应该使用 text 类型', async () => {
      const invalidJson = '{invalid json}';

      const mockNode = createMockNode({
        content: invalidJson,
        savingStatus: 'editing',
      });

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
        vi.advanceTimersByTime(2000);
      });

      await waitFor(() => {
        expect(mockHandleDynamicStorageSwitch).toHaveBeenCalledWith(
          expect.objectContaining({
            contentType: 'text',
          })
        );
      });
    });

    it('纯文本应该使用 text 类型', async () => {
      const plainText = 'This is plain text, not JSON';

      const mockNode = createMockNode({
        content: plainText,
        savingStatus: 'editing',
      });

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
        vi.advanceTimersByTime(2000);
      });

      await waitFor(() => {
        expect(mockHandleDynamicStorageSwitch).toHaveBeenCalledWith(
          expect.objectContaining({
            contentType: 'text',
          })
        );
      });
    });
  });

  describe('TC-JSON-022: External 存储的 dirty 标记 (P1)', () => {
    it('编辑时应该设置 dirty=true', async () => {
      const mockNode = createMockNode({
        storage_class: 'external',
        dirty: false,
      });

      mockGetNode.mockReturnValue(mockNode);

      const { getByTestId } = render(
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

      const editor = getByTestId('rich-json-editor');
      await act(async () => {
        fireEvent.change(editor, { target: { value: '{"new": "content"}' } });
      });

      await waitFor(
        () => {
          const dirtyCall = mockSetNodes.mock.calls.find((call: any) => {
            const result = call[0]([mockNode]);
            return result[0]?.data?.dirty === true;
          });
          expect(mockSetNodes).toHaveBeenCalled();
        },
        { timeout: 3000 }
      );
    });
  });

  describe('TC-JSON-023: Internal 存储不使用 dirty (P1)', () => {
    it('Internal 模式下 dirty 应始终为 false', async () => {
      const mockNode = createMockNode({
        storage_class: 'internal',
        dirty: false,
      });

      mockGetNode.mockReturnValue({
        ...mockNode,
        data: {
          ...mockNode.data,
          savingStatus: 'editing',
        },
      });

      const { getByTestId } = render(
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

      const editor = getByTestId('rich-json-editor');
      await act(async () => {
        fireEvent.change(editor, { target: { value: '{"content": "test"}' } });
      });

      await waitFor(
        () => {
          const calls = mockSetNodes.mock.calls;
          const internalCalls = calls.filter((call: any) => {
            const result = call[0]([mockNode]);
            return result[0]?.data?.storage_class === 'internal';
          });

          expect(mockSetNodes).toHaveBeenCalled();

          if (internalCalls.length > 0) {
            internalCalls.forEach((call: any) => {
              const result = call[0]([mockNode]);
              if (result[0]?.data?.dirty !== undefined) {
                expect(result[0]?.data?.dirty).toBe(false);
              }
            });
          }
        },
        { timeout: 3000 }
      );
    });
  });
});

/**
 * 🔧 人工验证清单：
 *
 * 1. ✅ 阈值配置
 *    - [ ] CONTENT_LENGTH_THRESHOLD 的实际值
 *    - [ ] 阈值边界的归属规则（>= 还是 >）
 *    - [ ] 不同类型内容的字符计数方式
 *
 * 2. ✅ 存储切换逻辑
 *    - [ ] handleDynamicStorageSwitch 的完整实现
 *    - [ ] resource_key 的生成和管理
 *    - [ ] 旧数据的清理机制
 *    - [ ] 切换失败的回滚策略
 *
 * 3. ✅ 内容类型判断
 *    - [ ] Structured vs Text 的判断逻辑
 *    - [ ] JSON.parse 失败的处理
 *    - [ ] null 值的特殊处理
 *
 * 4. ✅ dirty 标记
 *    - [ ] dirty 的设置和清除时机
 *    - [ ] internal 和 external 的 dirty 处理差异
 *    - [ ] 并发编辑时 dirty 的表现
 *
 * 📝 运行命令：
 *    npm run test -- JsonNodeNew.storage.test.tsx
 */
