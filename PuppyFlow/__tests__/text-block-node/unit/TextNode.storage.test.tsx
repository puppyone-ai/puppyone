/**
 * Text Block Node - 动态存储策略测试
 *
 * 测试用例：
 * P0:
 * - TC-TEXT-015: 内容超阈值切换到外部存储
 * - TC-TEXT-016: 内容缩减切换回内部存储
 * - TC-TEXT-018: 存储切换时的数据一致性
 *
 * P1:
 * - TC-TEXT-022: External 存储的 dirty 标记
 * - TC-TEXT-023: Internal 存储不使用 dirty
 *
 * ⚠️ 测试重点：
 * - 动态存储策略切换（50KB 阈值）
 * - dirty 标记的正确使用
 * - 数据一致性保证
 */

// @ts-nocheck
import React from 'react';
import {
  render,
  waitFor,
  act,
  screen,
  fireEvent,
} from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import TextBlockNode from '../../../app/components/workflow/blockNode/TextBlockNode';
import type { Node } from '@xyflow/react';
import type { TextBlockNodeData } from '../../../app/components/workflow/blockNode/TextBlockNode';

// Mock 配置
const mocks = vi.hoisted(() => ({
  useReactFlow: vi.fn(),
  useNodesPerFlowContext: vi.fn(),
  useGetSourceTarget: vi.fn(),
  useWorkspaceManagement: vi.fn(),
  useAppSettings: vi.fn(),
  handleDynamicStorageSwitch: vi.fn(),
  getStorageInfo: vi.fn(),
}));

vi.mock('@xyflow/react', () => ({
  useReactFlow: mocks.useReactFlow,
  NodeResizeControl: ({ children }: any) => <div>{children}</div>,
  Handle: ({ children, type, position }: any) => (
    <div data-testid={`handle-${type}-${position}`}>{children}</div>
  ),
  Position: { Top: 'top', Right: 'right', Bottom: 'bottom', Left: 'left' },
}));

vi.mock('../../../app/components/states/NodesPerFlowContext', () => ({
  useNodesPerFlowContext: mocks.useNodesPerFlowContext,
}));

vi.mock('../../../app/components/hooks/useGetSourceTarget', () => ({
  default: mocks.useGetSourceTarget,
}));

vi.mock('../../../app/components/states/AppSettingsContext', () => ({
  useAppSettings: mocks.useAppSettings,
}));

vi.mock('../../../app/components/hooks/useWorkspaceManagement', () => ({
  useWorkspaceManagement: mocks.useWorkspaceManagement,
}));

vi.mock(
  '../../../app/components/workflow/utils/dynamicStorageStrategy',
  () => ({
    handleDynamicStorageSwitch: mocks.handleDynamicStorageSwitch,
    getStorageInfo: mocks.getStorageInfo,
    CONTENT_LENGTH_THRESHOLD: 50000,
  })
);

vi.mock('../../../app/components/workflow/utils/externalStorage', () => ({
  forceSyncDirtyNodes: vi.fn(),
  syncBlockContent: vi.fn(),
}));

vi.mock('../../../app/components/tableComponent/TextEditor', () => ({
  default: ({ value, onChange }: any) => (
    <textarea
      data-testid='text-editor'
      value={value}
      onChange={e => onChange(e.target.value)}
    />
  ),
}));

vi.mock(
  '../../../app/components/workflow/blockNode/TextNodeTopSettingBar/NodeSettingsButton',
  () => ({
    default: () => <button data-testid='settings-button'>Settings</button>,
  })
);

vi.mock('../../../app/components/loadingIcon/SkeletonLoadingIcon', () => ({
  default: () => <div data-testid='skeleton-loading'>Loading...</div>,
}));

vi.mock('../../../app/components/workflow/handles/WhiteBallHandle', () => ({
  default: ({ id, type, position }: any) => (
    <div data-testid={`white-ball-${type}-${position}`} />
  ),
}));

describe('Text Block Node - 动态存储策略', () => {
  let mockSetNodes: any;
  let mockGetNode: any;
  let currentNodes: Node<TextBlockNodeData>[];

  const createMockNode = (
    overrides: Partial<TextBlockNodeData> = {}
  ): Node<TextBlockNodeData> => ({
    id: 'test-text-storage',
    type: 'text',
    position: { x: 0, y: 0 },
    data: {
      content: '',
      label: 'Test Text',
      isLoading: false,
      isWaitingForFlow: false,
      locked: false,
      isInput: false,
      isOutput: false,
      editable: false,
      inputEdgeNodeID: [],
      outputEdgeNodeID: [],
      ...overrides,
    },
  });

  beforeEach(() => {
    vi.useFakeTimers();
    currentNodes = [createMockNode()];

    mockSetNodes = vi.fn(callback => {
      if (typeof callback === 'function') {
        currentNodes = callback(currentNodes);
        return currentNodes;
      }
      return currentNodes;
    });

    mockGetNode = vi.fn(nodeId => {
      return currentNodes.find(n => n.id === nodeId) || currentNodes[0];
    });

    mocks.useReactFlow.mockReturnValue({
      getNode: mockGetNode,
      setNodes: mockSetNodes,
      getNodes: vi.fn(() => [createMockNode()]),
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
    });

    mocks.useGetSourceTarget.mockReturnValue({
      getSourceNodeIdWithLabel: vi.fn(() => []),
      getTargetNodeIdWithLabel: vi.fn(() => []),
    });

    mocks.useAppSettings.mockReturnValue({});

    mocks.useWorkspaceManagement.mockReturnValue({
      fetchUserId: vi.fn().mockResolvedValue('test-user-id'),
    });

    mocks.handleDynamicStorageSwitch.mockResolvedValue(undefined);
    mocks.getStorageInfo.mockReturnValue({
      storageClass: 'internal',
      resourceKey: null,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  // ============================================================================
  // P0 致命 - 动态存储策略
  // ============================================================================

  describe('TC-TEXT-015: 内容超阈值切换到外部存储 (P0)', () => {
    it('内容超过 50KB 应调用存储切换', async () => {
      const longContent = 'A'.repeat(51000);
      currentNodes = [
        createMockNode({
          content: longContent,
          storage_class: 'internal',
          savingStatus: 'editing',
        } as any),
      ];

      render(
        <TextBlockNode
          id={currentNodes[0].id}
          type='text'
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

      expect(mocks.handleDynamicStorageSwitch).toHaveBeenCalledWith(
        expect.objectContaining({
          content: longContent,
          contentType: 'text',
        })
      );
    });

    it('应生成 resource_key', async () => {
      const longContent = 'A'.repeat(51000);
      currentNodes = [
        createMockNode({
          content: longContent,
          storage_class: 'internal',
          savingStatus: 'editing',
        } as any),
      ];

      mocks.getStorageInfo.mockReturnValue({
        storageClass: 'external',
        resourceKey: 'generated-key-123',
      });

      render(
        <TextBlockNode
          id={currentNodes[0].id}
          type='text'
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

      expect(mocks.handleDynamicStorageSwitch).toHaveBeenCalled();
    });
  });

  describe('TC-TEXT-016: 内容缩减切换回内部存储 (P0)', () => {
    it('内容小于 50KB 应切换回 internal', async () => {
      const shortContent = 'Short text';
      currentNodes = [
        createMockNode({
          content: shortContent,
          storage_class: 'external',
          dirty: true,
          resource_key: 'old-key',
        } as any),
      ];

      mocks.getStorageInfo.mockReturnValue({
        storageClass: 'internal',
        resourceKey: null,
      });

      render(
        <TextBlockNode
          id={currentNodes[0].id}
          type='text'
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

      expect(mocks.handleDynamicStorageSwitch).toHaveBeenCalled();
    });
  });

  describe('TC-TEXT-018: 存储切换时的数据一致性 (P0)', () => {
    it('切换前后内容应该完全一致', async () => {
      const testContent = 'Test content with special chars: 你好 🎉 \n\t';
      currentNodes = [
        createMockNode({
          content: testContent,
          storage_class: 'internal',
          savingStatus: 'editing',
        } as any),
      ];

      render(
        <TextBlockNode
          id={currentNodes[0].id}
          type='text'
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

      const call = mocks.handleDynamicStorageSwitch.mock.calls[0];
      expect(call[0].content).toBe(testContent);
    });

    it('应该处理特殊字符而不丢失', async () => {
      const specialContent = '{"key": "value"}\n\t<html>test</html>';
      currentNodes = [
        createMockNode({
          content: specialContent,
          storage_class: 'internal',
          savingStatus: 'editing',
        } as any),
      ];

      render(
        <TextBlockNode
          id={currentNodes[0].id}
          type='text'
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

      const call = mocks.handleDynamicStorageSwitch.mock.calls[0];
      expect(call[0].content).toBe(specialContent);
    });
  });

  // ============================================================================
  // P1 严重 - dirty 标记管理
  // ============================================================================

  describe('TC-TEXT-022: External 存储的 dirty 标记 (P1)', () => {
    it('external 存储编辑后应设置 dirty=true', async () => {
      currentNodes = [
        createMockNode({
          content: 'Test',
          storage_class: 'external',
        } as any),
      ];

      render(
        <TextBlockNode
          id={currentNodes[0].id}
          type='text'
          data={currentNodes[0].data}
          selected={false}
          isConnectable={true}
          xPos={0}
          yPos={0}
          zIndex={0}
          dragging={false}
        />
      );

      const editor = screen.getByTestId('text-editor');

      await act(async () => {
        fireEvent.change(editor, { target: { value: 'New content' } });
      });

      expect(mockSetNodes).toHaveBeenCalled();
      const setNodesCall = mockSetNodes.mock.calls[0][0];
      const updatedNodes = setNodesCall(currentNodes);
      const updatedNode = updatedNodes.find(
        (n: any) => n.id === currentNodes[0].id
      );

      expect(updatedNode.data.dirty).toBe(true);
    });

    it('external 存储仅在 dirty=true 时保存', async () => {
      const mockNode = createMockNode({
        content: 'Test',
        storage_class: 'external',
        dirty: false,
      } as any);
      mockGetNode.mockReturnValue(mockNode);

      render(
        <TextBlockNode
          id={mockNode.id}
          type='text'
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

      expect(mocks.handleDynamicStorageSwitch).not.toHaveBeenCalled();
    });
  });

  describe('TC-TEXT-023: Internal 存储不使用 dirty (P1)', () => {
    it('internal 存储编辑后应设置 dirty=false', async () => {
      currentNodes = [
        createMockNode({
          content: 'Test',
          storage_class: 'internal',
        } as any),
      ];

      render(
        <TextBlockNode
          id={currentNodes[0].id}
          type='text'
          data={currentNodes[0].data}
          selected={false}
          isConnectable={true}
          xPos={0}
          yPos={0}
          zIndex={0}
          dragging={false}
        />
      );

      const editor = screen.getByTestId('text-editor');

      await act(async () => {
        fireEvent.change(editor, { target: { value: 'New content' } });
      });

      expect(mockSetNodes).toHaveBeenCalled();
      const setNodesCall = mockSetNodes.mock.calls[0][0];
      const updatedNodes = setNodesCall(currentNodes);
      const updatedNode = updatedNodes.find(
        (n: any) => n.id === currentNodes[0].id
      );

      expect(updatedNode.data.dirty).toBe(false);
    });

    it('internal 存储仅在 savingStatus=editing 时保存', async () => {
      const mockNode = createMockNode({
        content: 'Test',
        storage_class: 'internal',
        savingStatus: 'saved',
      } as any);
      mockGetNode.mockReturnValue(mockNode);

      render(
        <TextBlockNode
          id={mockNode.id}
          type='text'
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

      expect(mocks.handleDynamicStorageSwitch).not.toHaveBeenCalled();
    });
  });
});
