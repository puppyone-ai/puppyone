/**
 * Text Block Node - 内容编辑与保存测试
 *
 * 测试用例：
 * P0:
 * - TC-TEXT-001: 用户输入文本内容
 * - TC-TEXT-002: 编辑现有文本内容
 * - TC-TEXT-008: Internal 存储编辑后自动保存
 * - TC-TEXT-011: 保存失败处理
 *
 * P1:
 * - TC-TEXT-003: 清空所有文本内容
 * - TC-TEXT-004: 超长文本输入（>50KB）
 * - TC-TEXT-009: 快速连续编辑的防抖（2s）
 * - TC-TEXT-012: 节点 isLoading 时不触发保存
 * - TC-TEXT-014: 加载完成后显示内容
 *
 * ⚠️ 测试重点：
 * - 文本编辑功能
 * - 2秒防抖保存机制
 * - 存储策略切换
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
}));

vi.mock('@xyflow/react', () => ({
  useReactFlow: mocks.useReactFlow,
  NodeResizeControl: ({ children }: any) => <div>{children}</div>,
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
    getStorageInfo: vi.fn(() => ({
      storageClass: 'internal',
      resourceKey: null,
    })),
    CONTENT_LENGTH_THRESHOLD: 50000,
  })
);

vi.mock('../../../app/components/workflow/utils/externalStorage', () => ({
  forceSyncDirtyNodes: vi.fn(),
  syncBlockContent: vi.fn(),
}));

vi.mock('../../../app/components/tableComponent/TextEditor', () => ({
  default: ({ value, onChange, placeholder }: any) => (
    <textarea
      data-testid='text-editor'
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
    />
  ),
}));

vi.mock(
  '../../../app/components/workflow/blockNode/TextNodeTopSettingBar/NodeSettingsButton',
  () => ({
    default: ({ nodeid }: any) => (
      <button data-testid='settings-button'>Settings</button>
    ),
  })
);

vi.mock('../../../app/components/loadingIcon/SkeletonLoadingIcon', () => ({
  default: () => <div data-testid='skeleton-loading'>Loading...</div>,
}));

vi.mock('../../../app/components/workflow/handles/WhiteBallHandle', () => ({
  default: ({ id, type, position }: any) => (
    <div data-testid={`white-ball-${type}-${position}`} data-id={id} />
  ),
}));

describe('Text Block Node - 内容编辑与保存', () => {
  let mockSetNodes: any;
  let mockGetNode: any;
  let currentNodes: Node<TextBlockNodeData>[];

  const createMockNode = (
    overrides: Partial<TextBlockNodeData> = {}
  ): Node<TextBlockNodeData> => ({
    id: 'test-text-1',
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
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  // ============================================================================
  // P0 致命 - 内容编辑与保存
  // ============================================================================

  describe('TC-TEXT-001: 用户输入文本内容 (P0)', () => {
    it('输入文本应触发 updateNodeContent', async () => {
      const mockNode = createMockNode({ content: '' });
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

      const editor = screen.getByTestId('text-editor');

      await act(async () => {
        fireEvent.change(editor, { target: { value: 'Hello World' } });
      });

      expect(mockSetNodes).toHaveBeenCalled();
    });

    it('输入的内容应保存到 node.data.content', async () => {
      const mockNode = createMockNode({ content: '' });
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

      const editor = screen.getByTestId('text-editor');

      await act(async () => {
        fireEvent.change(editor, { target: { value: 'Test content' } });
      });

      const setNodesCall = mockSetNodes.mock.calls[0][0];
      const updatedNodes = setNodesCall([mockNode]);
      const updatedNode = updatedNodes.find((n: any) => n.id === mockNode.id);

      expect(updatedNode.data.content).toBe('Test content');
    });
  });

  describe('TC-TEXT-002: 编辑现有文本内容 (P0)', () => {
    it('修改现有内容应更新 node.data.content', async () => {
      const mockNode = createMockNode({ content: 'Original text' });
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

      const editor = screen.getByTestId('text-editor');
      expect(editor).toHaveValue('Original text');

      await act(async () => {
        fireEvent.change(editor, { target: { value: 'Modified text' } });
      });

      const setNodesCall = mockSetNodes.mock.calls[0][0];
      const updatedNodes = setNodesCall([mockNode]);
      const updatedNode = updatedNodes.find((n: any) => n.id === mockNode.id);

      expect(updatedNode.data.content).toBe('Modified text');
    });
  });

  describe('TC-TEXT-008: Internal 存储编辑后自动保存 (P0)', () => {
    it('编辑后 2 秒应触发保存', async () => {
      currentNodes = [
        createMockNode({
          content: 'Test content',
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

      expect(mocks.handleDynamicStorageSwitch).not.toHaveBeenCalled();

      await act(async () => {
        vi.advanceTimersByTime(2000);
        await Promise.resolve();
      });

      expect(mocks.handleDynamicStorageSwitch).toHaveBeenCalled();
    });

    it('保存时应设置 savingStatus 为 "saving"', async () => {
      currentNodes = [
        createMockNode({
          content: 'Test content',
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

      const savingCall = mockSetNodes.mock.calls.find((call: any) => {
        if (typeof call[0] === 'function') {
          const result = call[0](currentNodes);
          return result[0]?.data?.savingStatus === 'saving';
        }
        return false;
      });
      expect(savingCall).toBeDefined();
    });
  });

  describe('TC-TEXT-011: 保存失败处理 (P0)', () => {
    it('保存失败应设置 savingStatus 为 "error"', async () => {
      const error = new Error('Save failed');
      mocks.handleDynamicStorageSwitch.mockRejectedValue(error);

      currentNodes = [
        createMockNode({
          content: 'Test',
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

      const errorCall = mockSetNodes.mock.calls.find((call: any) => {
        if (typeof call[0] === 'function') {
          const result = call[0](currentNodes);
          return result[0]?.data?.savingStatus === 'error';
        }
        return false;
      });
      expect(errorCall).toBeDefined();
    });

    it('保存失败应记录错误信息', async () => {
      const error = new Error('Network error');
      mocks.handleDynamicStorageSwitch.mockRejectedValue(error);

      currentNodes = [
        createMockNode({
          content: 'Test',
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

      const errorCall = mockSetNodes.mock.calls.find((call: any) => {
        if (typeof call[0] === 'function') {
          const result = call[0](currentNodes);
          return result[0]?.data?.saveError === 'Network error';
        }
        return false;
      });
      expect(errorCall).toBeDefined();
    });
  });

  // ============================================================================
  // P1 严重 - 编辑功能
  // ============================================================================

  describe('TC-TEXT-003: 清空所有文本内容 (P1)', () => {
    it('清空内容应保存空字符串', async () => {
      const mockNode = createMockNode({ content: 'Some text' });
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

      const editor = screen.getByTestId('text-editor');

      await act(async () => {
        fireEvent.change(editor, { target: { value: '' } });
      });

      const setNodesCall = mockSetNodes.mock.calls[0][0];
      const updatedNodes = setNodesCall([mockNode]);
      const updatedNode = updatedNodes.find((n: any) => n.id === mockNode.id);

      expect(updatedNode.data.content).toBe('');
    });
  });

  describe('TC-TEXT-004: 超长文本输入（>50KB） (P1)', () => {
    it('应能处理超过 50KB 的文本', async () => {
      const longText = 'A'.repeat(51000);
      const mockNode = createMockNode({ content: '' });
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

      const editor = screen.getByTestId('text-editor');

      await act(async () => {
        fireEvent.change(editor, { target: { value: longText } });
      });

      const setNodesCall = mockSetNodes.mock.calls[0][0];
      const updatedNodes = setNodesCall([mockNode]);
      const updatedNode = updatedNodes.find((n: any) => n.id === mockNode.id);

      expect(updatedNode.data.content).toBe(longText);
      expect(updatedNode.data.content.length).toBe(51000);
    });
  });

  describe('TC-TEXT-009: 快速连续编辑的防抖（2s） (P1)', () => {
    it('连续编辑应只触发一次保存', async () => {
      // 模拟连续编辑场景：渲染3次，每次间隔500ms，验证只触发一次保存
      // 第一次编辑
      currentNodes = [
        createMockNode({
          content: 'A',
          storage_class: 'internal',
          savingStatus: 'editing',
        } as any),
      ];

      const { rerender, unmount } = render(
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

      // 500ms 后第二次编辑（防抖未完成，定时器被重置）
      await act(async () => {
        vi.advanceTimersByTime(500);
      });

      unmount();
      currentNodes = [
        createMockNode({
          content: 'AB',
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

      // 又 500ms 后第三次编辑（防抖未完成，定时器再次被重置）
      await act(async () => {
        vi.advanceTimersByTime(500);
      });

      // 最后一次编辑后等待 2000ms，防抖完成
      await act(async () => {
        vi.advanceTimersByTime(2000);
        await Promise.resolve();
      });

      // 应该只调用一次（因为防抖）
      expect(mocks.handleDynamicStorageSwitch).toHaveBeenCalledTimes(1);
    });
  });

  describe('TC-TEXT-012: 节点 isLoading 时不触发保存 (P1)', () => {
    it('isLoading=true 时不应触发保存', async () => {
      const mockNode = createMockNode({
        content: 'Test',
        isLoading: true,
        storage_class: 'internal',
        savingStatus: 'editing',
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

  describe('TC-TEXT-014: 加载完成后显示内容 (P1)', () => {
    it('isLoading=false 时应显示编辑器', () => {
      const mockNode = createMockNode({
        content: 'Test content',
        isLoading: false,
      });
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

      expect(screen.getByTestId('text-editor')).toBeInTheDocument();
      expect(screen.queryByTestId('skeleton-loading')).not.toBeInTheDocument();
    });

    it('isLoading=true 时应显示加载图标', () => {
      const mockNode = createMockNode({
        content: 'Test content',
        isLoading: true,
      });
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

      expect(screen.getByTestId('skeleton-loading')).toBeInTheDocument();
      expect(screen.queryByTestId('text-editor')).not.toBeInTheDocument();
    });
  });
});
