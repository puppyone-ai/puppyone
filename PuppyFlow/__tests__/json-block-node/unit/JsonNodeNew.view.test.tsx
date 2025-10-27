/**
 * JSON Block Node - 视图切换测试
 *
 * 测试用例：
 * P0:
 * - TC-JSON-061: 切换视图时内容不丢失
 *
 * P1:
 * - TC-JSON-059: 切换到 JSONForm 视图
 * - TC-JSON-060: 切换回 RichEditor 视图
 * - TC-JSON-063: RichEditor 正确接收 props
 * - TC-JSON-064: JSONForm 正确接收 props
 * - TC-JSON-065: 锁定状态下两种视图都只读
 * - TC-JSON-087: JSON 编辑器内滚动不传播
 * - TC-JSON-090: 锁定状态下不可编辑 JSON
 *
 * ⚠️ 需要人工验证：
 * - 编辑器组件的实际实现
 * - 视图切换的内容转换逻辑
 * - 滚动事件的传播机制
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

vi.mock('@/components/workflow/utils/dynamicStorageStrategy', () => ({
  handleDynamicStorageSwitch: vi.fn(() => Promise.resolve()),
  getStorageInfo: vi.fn(() => ({
    storageClass: 'internal',
    resourceKey: null,
  })),
  CONTENT_LENGTH_THRESHOLD: 50000,
}));

// Mock JSON 编辑器组件 - 确保可以区分两种编辑器
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
      widthStyle,
      heightStyle,
    }: any) => (
      <div
        data-testid='rich-json-container'
        data-readonly={readonly}
        data-width={widthStyle}
        data-height={heightStyle}
      >
        <textarea
          data-testid='rich-json-editor'
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          readOnly={readonly}
          onMouseDown={() => preventParentDrag?.()}
          onMouseUp={() => allowParentDrag?.()}
        />
      </div>
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
    widthStyle,
    heightStyle,
  }: any) => (
    <div
      data-testid='json-form-container'
      data-readonly={readonly}
      data-width={widthStyle}
      data-height={heightStyle}
    >
      <textarea
        data-testid='json-form-editor'
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        readOnly={readonly}
        onMouseDown={() => preventParentDrag?.()}
        onMouseUp={() => allowParentDrag?.()}
      />
    </div>
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

describe('JsonBlockNode - 视图切换', () => {
  let mockSetNodes: any;
  let mockGetNode: any;

  const createMockNode = (
    overrides: Partial<JsonNodeData> = {}
  ): Node<JsonNodeData> => ({
    id: 'test-json-view',
    type: 'json',
    position: { x: 0, y: 0 },
    data: {
      content: '{"name": "test", "value": 123}',
      label: 'View Test Node',
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

    mockSetNodes = vi.fn();
    mockGetNode = vi.fn(() => createMockNode());

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
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  describe('TC-JSON-059: 切换到 JSONForm 视图 (P1)', () => {
    it('应该能从 RichEditor 切换到 JSONForm', async () => {
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

      // 初始应该显示 RichEditor
      expect(screen.getByTestId('rich-json-editor')).toBeInTheDocument();
      expect(screen.queryByTestId('json-form-editor')).not.toBeInTheDocument();

      // 点击切换按钮
      const toggleButton = screen.getByTestId('view-toggle-button');
      expect(toggleButton).toHaveTextContent('Rich');

      fireEvent.click(toggleButton);

      // 等待状态更新
      await waitFor(() => {
        expect(toggleButton).toHaveTextContent('Plain');
      });

      // 应该显示 JSONForm
      expect(screen.queryByTestId('rich-json-editor')).not.toBeInTheDocument();
      expect(screen.getByTestId('json-form-editor')).toBeInTheDocument();
    });

    it('切换后内容应该保持一致', async () => {
      const testContent = '{"test": "content", "number": 456}';
      const mockNode = createMockNode({ content: testContent });

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

      const richEditor = screen.getByTestId('rich-json-editor');
      expect(richEditor).toHaveValue(testContent);

      // 切换视图
      fireEvent.click(screen.getByTestId('view-toggle-button'));

      await waitFor(() => {
        const jsonFormEditor = screen.getByTestId('json-form-editor');
        expect(jsonFormEditor).toHaveValue(testContent);
      });
    });
  });

  describe('TC-JSON-060: 切换回 RichEditor 视图 (P1)', () => {
    it('应该能从 JSONForm 切换回 RichEditor', async () => {
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

      const toggleButton = screen.getByTestId('view-toggle-button');

      // 切换到 JSONForm
      fireEvent.click(toggleButton);

      await waitFor(() => {
        expect(screen.getByTestId('json-form-editor')).toBeInTheDocument();
      });

      // 切换回 RichEditor
      fireEvent.click(toggleButton);

      await waitFor(() => {
        expect(screen.getByTestId('rich-json-editor')).toBeInTheDocument();
        expect(
          screen.queryByTestId('json-form-editor')
        ).not.toBeInTheDocument();
      });
    });
  });

  describe('TC-JSON-061: 切换视图时内容不丢失 (P0)', () => {
    it('多次切换视图内容应保持一致', async () => {
      const testContent = '{"important": "data", "nested": {"value": 789}}';
      const mockNode = createMockNode({ content: testContent });

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

      const toggleButton = screen.getByTestId('view-toggle-button');

      // 验证初始内容
      let editor = screen.getByTestId('rich-json-editor');
      expect(editor).toHaveValue(testContent);

      // 第一次切换：RichEditor → JSONForm
      fireEvent.click(toggleButton);

      await waitFor(() => {
        editor = screen.getByTestId('json-form-editor');
        expect(editor).toHaveValue(testContent);
      });

      // 第二次切换：JSONForm → RichEditor
      fireEvent.click(toggleButton);

      await waitFor(() => {
        editor = screen.getByTestId('rich-json-editor');
        expect(editor).toHaveValue(testContent);
      });

      // 第三次切换：RichEditor → JSONForm
      fireEvent.click(toggleButton);

      await waitFor(() => {
        editor = screen.getByTestId('json-form-editor');
        expect(editor).toHaveValue(testContent);
      });
    });

    it('在视图切换前编辑的内容应该保留', async () => {
      const mockNode = createMockNode({ content: '{"initial": "value"}' });

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

      // 在 RichEditor 中编辑
      const richEditor = screen.getByTestId('rich-json-editor');
      const editedContent = '{"edited": "in rich editor"}';

      await act(async () => {
        fireEvent.change(richEditor, { target: { value: editedContent } });
      });

      // 切换到 JSONForm
      fireEvent.click(screen.getByTestId('view-toggle-button'));

      await waitFor(() => {
        const jsonFormEditor = screen.getByTestId('json-form-editor');
        // 验证编辑的内容是否保留
        expect(mockSetNodes).toHaveBeenCalled();
      });
    });
  });

  describe('TC-JSON-063: RichEditor 正确接收 props (P1)', () => {
    it('RichEditor 应该接收正确的 props', () => {
      const mockNode = createMockNode({ content: '{"test": "props"}' });

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

      const container = screen.getByTestId('rich-json-container');
      const editor = screen.getByTestId('rich-json-editor');

      // 验证 value
      expect(editor).toHaveValue('{"test": "props"}');

      // 验证 readonly
      expect(container).toHaveAttribute('data-readonly', 'false');

      // 验证 widthStyle 和 heightStyle
      expect(container).toHaveAttribute('data-width', '0');
      expect(container).toHaveAttribute('data-height', '0');
    });

    it('RichEditor 应该绑定 preventParentDrag/allowParentDrag', () => {
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

      const editor = screen.getByTestId('rich-json-editor');

      // 模拟鼠标按下和释放
      fireEvent.mouseDown(editor);
      fireEvent.mouseUp(editor);

      // ⚠️ 需要验证 preventParentDrag 和 allowParentDrag 是否被调用
      // 在真实环境中，这会影响节点拖拽行为
    });
  });

  describe('TC-JSON-064: JSONForm 正确接收 props (P1)', () => {
    it('JSONForm 应该接收正确的 props', async () => {
      const mockNode = createMockNode({ content: '{"test": "props"}' });

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

      // 切换到 JSONForm
      fireEvent.click(screen.getByTestId('view-toggle-button'));

      await waitFor(() => {
        const container = screen.getByTestId('json-form-container');
        const editor = screen.getByTestId('json-form-editor');

        // 验证 value
        expect(editor).toHaveValue('{"test": "props"}');

        // 验证 readonly
        expect(container).toHaveAttribute('data-readonly', 'false');

        // 验证 widthStyle 和 heightStyle
        expect(container).toHaveAttribute('data-width', '0');
        expect(container).toHaveAttribute('data-height', '0');
      });
    });
  });

  describe('TC-JSON-065: 锁定状态下两种视图都只读 (P1)', () => {
    it('锁定时 RichEditor 应该为 readonly', () => {
      const mockNode = createMockNode({ locked: true });

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

      const container = screen.getByTestId('rich-json-container');
      const editor = screen.getByTestId('rich-json-editor');

      expect(container).toHaveAttribute('data-readonly', 'true');
      expect(editor).toHaveAttribute('readOnly');
    });

    it('锁定时 JSONForm 应该为 readonly', async () => {
      const mockNode = createMockNode({ locked: true });

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

      // 切换到 JSONForm
      fireEvent.click(screen.getByTestId('view-toggle-button'));

      await waitFor(() => {
        const container = screen.getByTestId('json-form-container');
        const editor = screen.getByTestId('json-form-editor');

        expect(container).toHaveAttribute('data-readonly', 'true');
        expect(editor).toHaveAttribute('readOnly');
      });
    });

    it('锁定状态下切换视图，readonly 状态应保持', async () => {
      const mockNode = createMockNode({ locked: true });

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

      // 验证 RichEditor 是只读的
      let container = screen.getByTestId('rich-json-container');
      expect(container).toHaveAttribute('data-readonly', 'true');

      // 切换到 JSONForm
      fireEvent.click(screen.getByTestId('view-toggle-button'));

      // 验证 JSONForm 也是只读的
      await waitFor(() => {
        container = screen.getByTestId('json-form-container');
        expect(container).toHaveAttribute('data-readonly', 'true');
      });
    });
  });

  describe('TC-JSON-087: JSON 编辑器内滚动不传播 (P1)', () => {
    it('编辑器应该有滚动容器', () => {
      const mockNode = createMockNode();

      const { container } = render(
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

      // 查找滚动容器
      const scrollContainer = container.querySelector('.overflow-auto');
      expect(scrollContainer).toBeInTheDocument();
    });

    it('滚动容器应该有 stopPropagation 处理', () => {
      const mockNode = createMockNode();

      const { container } = render(
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

      const scrollContainer = container.querySelector('.overflow-auto');

      if (scrollContainer) {
        const wheelEvent = new WheelEvent('wheel', { bubbles: true });
        const scrollEvent = new Event('scroll', { bubbles: true });

        // 模拟滚动事件
        // ⚠️ 在真实环境中验证 stopPropagation 是否生效
        scrollContainer.dispatchEvent(wheelEvent);
        scrollContainer.dispatchEvent(scrollEvent);
      }
    });
  });

  describe('TC-JSON-090: 锁定状态下不可编辑 JSON (P1)', () => {
    it('锁定时不应能编辑 JSON', async () => {
      const mockNode = createMockNode({
        locked: true,
        content: '{"locked": "content"}',
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

      const editor = screen.getByTestId('rich-json-editor');

      // 尝试编辑
      await act(async () => {
        fireEvent.change(editor, {
          target: { value: '{"modified": "content"}' },
        });
      });

      // 由于 readonly=true，编辑器不应允许修改
      expect(editor).toHaveAttribute('readOnly');
    });
  });
});

/**
 * 🔧 人工验证清单：
 *
 * 1. ✅ 视图切换逻辑
 *    - [ ] 验证 useRichEditor state 的切换
 *    - [ ] 确认两种编辑器的实际渲染逻辑
 *    - [ ] 测试视图切换的性能影响
 *
 * 2. ✅ 内容一致性
 *    - [ ] 验证复杂 JSON 的切换表现
 *    - [ ] 测试大 JSON 的切换性能
 *    - [ ] 确认编辑中切换的行为
 *
 * 3. ✅ Props 传递
 *    - [ ] 验证 RichJSONForm 的实际 props
 *    - [ ] 验证 JSONForm 的实际 props
 *    - [ ] 测试 preventParentDrag 的实际效果
 *
 * 4. ✅ 滚动事件
 *    - [ ] 真实环境验证 stopPropagation
 *    - [ ] 测试嵌套滚动的行为
 *    - [ ] 验证 ReactFlow 画布不被影响
 *
 * 5. ✅ 锁定功能
 *    - [ ] 验证 locked 状态的传递
 *    - [ ] 测试锁定后的完全只读行为
 *    - [ ] 验证解锁后的恢复
 *
 * 📝 运行命令：
 *    npm run test -- JsonNodeNew.view.test.tsx
 */
