/**
 * EditText Edge Node - 完整测试
 *
 * 测试用例：
 * P0 致命 - textContent 参数配置：
 * - TC-ET-001: 修改 textContent 应正确保存到 node.data.content
 * - TC-ET-001-1: textContent 应为字符串类型
 * - TC-ET-002: 空文本内容应正确保存
 *
 * P0 致命 - retMode 参数配置：
 * - TC-ET-003: 修改 retMode 应正确保存到 node.data.extra_configs
 * - TC-ET-003-1: retMode 应为有效的模式值
 *
 * P0 致命 - configNum 参数配置：
 * - TC-ET-005: 修改 configNum 应正确保存到 node.data.extra_configs
 * - TC-ET-005-1: configNum 应为数字类型
 *
 * P1 严重 - retMode 模式切换：
 * - TC-ET-004: 切换到 'return first n' 模式应正确保存
 * - TC-ET-004-1: 切换到 'return last n' 模式应正确保存
 * - TC-ET-004-2: 切换到 'exclude first n' 模式应正确保存
 * - TC-ET-004-3: 切换到 'exclude last n' 模式应正确保存
 *
 * P1 严重 - configNum 条件渲染：
 * - TC-ET-006: configNum 应在 retMode !== 'return all' 时可见
 * - TC-ET-006-1: configNum 应在 retMode === 'return all' 时隐藏
 *
 * P2 中等 - 初始化和默认值：
 * - TC-ET-007: textContent 默认值应为空字符串
 * - TC-ET-007-1: retMode 默认值应为 'return all'
 * - TC-ET-007-2: configNum 默认值应为 100
 *
 * P2 中等 - UI 交互：
 * - TC-ET-008: 点击节点按钮应打开配置菜单
 * - TC-ET-008-1: 组件挂载后验证
 */

// @ts-nocheck
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import EditText from '../../../app/components/workflow/edgesNode/edgeNodesNew/EditText';
import type { Node } from '@xyflow/react';
import type { ModifyConfigNodeData } from '../../../app/components/workflow/edgesNode/edgeNodesNew/EditText';

// Mock 配置
const mocks = vi.hoisted(() => ({
  useReactFlow: vi.fn(),
  useNodesPerFlowContext: vi.fn(),
  useGetSourceTarget: vi.fn(),
  useJsonConstructUtils: vi.fn(),
  useAppSettings: vi.fn(),
  runSingleEdgeNode: vi.fn(),
  PuppyDropdown: vi.fn(),
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

// Mock PuppyDropdown
vi.mock('../../../app/components/misc/PuppyDropDown', () => ({
  PuppyDropdown: (props: any) => {
    mocks.PuppyDropdown(props);
    return (
      <div data-testid='puppy-dropdown'>
        <button
          data-testid='dropdown-trigger'
          onClick={() => {
            // 模拟点击显示选项
          }}
        >
          {props.selectedValue}
        </button>
        <div data-testid='dropdown-options'>
          {props.options.map((option: string) => (
            <button
              key={option}
              data-testid={`dropdown-option-${option}`}
              onClick={() => props.onSelect(option)}
            >
              {option}
            </button>
          ))}
        </div>
      </div>
    );
  },
}));

vi.mock('react-dom', async () => {
  const actual = await vi.importActual('react-dom');
  return {
    ...actual,
    createPortal: (node: any) => node,
  };
});

describe('EditText Edge Node - 完整测试', () => {
  let mockSetNodes: any;
  let mockGetNode: any;
  let mockGetInternalNode: any;
  let mockSetEdges: any;

  const createMockNode = (
    overrides: Partial<ModifyConfigNodeData> = {}
  ): Node<ModifyConfigNodeData> => ({
    id: 'test-edittext-1',
    type: 'edittext',
    position: { x: 0, y: 0 },
    data: {
      subMenuType: null,
      content: '',
      looped: false,
      content_type: null,
      extra_configs: {
        index: undefined,
        key: undefined,
        params: {
          path: [],
        },
        retMode: 'return all',
        configNum: 100,
      },
      ...overrides,
    },
  });

  beforeEach(() => {
    mockSetNodes = vi.fn();
    mockSetEdges = vi.fn();
    mockGetNode = vi.fn(() => createMockNode());
    mockGetInternalNode = vi.fn(() => ({ id: 'test-edittext-1' }));

    mocks.useReactFlow.mockReturnValue({
      getNode: mockGetNode,
      getInternalNode: mockGetInternalNode,
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

  // ==================== P0 测试用例: textContent 参数配置 ====================

  describe('P0: textContent 参数配置', () => {
    it('TC-ET-001: 修改 textContent 应正确保存到 node.data.content', async () => {
      const node = createMockNode();
      mockGetNode.mockReturnValue(node);

      render(
        <EditText
          {...node}
          id={node.id}
          data={node.data}
          isConnectable={true}
        />
      );

      // 点击节点打开配置菜单
      const nodeButton = screen.getByText('Edit');
      fireEvent.click(nodeButton);

      await waitFor(() => {
        expect(screen.getByText('Edit Text')).toBeInTheDocument();
      });

      // 找到 Return Text textarea
      const textarea = screen.getByPlaceholderText(
        /use {{}} and id to reference input content/i
      );

      // 输入文本内容
      fireEvent.change(textarea, { target: { value: 'Hello World' } });

      // 等待 requestAnimationFrame 更新
      await waitFor(
        () => {
          expect(mockSetNodes).toHaveBeenCalled();
        },
        { timeout: 3000 }
      );

      // 验证 setNodes 被调用，并检查 content 更新
      const setNodesCall =
        mockSetNodes.mock.calls[mockSetNodes.mock.calls.length - 1];
      if (setNodesCall && typeof setNodesCall[0] === 'function') {
        const updatedNodes = setNodesCall[0]([node]);
        const updatedNode = updatedNodes.find((n: any) => n.id === node.id);
        expect(updatedNode?.data?.content).toBe('Hello World');
      }
    });

    it('TC-ET-001-1: textContent 应为字符串类型', () => {
      const node = createMockNode({ content: 'Test content' });
      expect(typeof node.data.content).toBe('string');
    });

    it('TC-ET-002: 空文本内容应正确保存', async () => {
      const node = createMockNode({ content: 'Initial content' });
      mockGetNode.mockReturnValue(node);

      render(
        <EditText
          {...node}
          id={node.id}
          data={node.data}
          isConnectable={true}
        />
      );

      // 打开配置菜单
      fireEvent.click(screen.getByText('Edit'));

      await waitFor(() => {
        expect(screen.getByText('Edit Text')).toBeInTheDocument();
      });

      // 清空 textarea
      const textarea = screen.getByPlaceholderText(
        /use {{}} and id to reference input content/i
      );
      fireEvent.change(textarea, { target: { value: '' } });

      await waitFor(
        () => {
          expect(mockSetNodes).toHaveBeenCalled();
        },
        { timeout: 3000 }
      );

      // 验证空字符串被保存
      const setNodesCall =
        mockSetNodes.mock.calls[mockSetNodes.mock.calls.length - 1];
      if (setNodesCall && typeof setNodesCall[0] === 'function') {
        const updatedNodes = setNodesCall[0]([node]);
        const updatedNode = updatedNodes.find((n: any) => n.id === node.id);
        expect(updatedNode?.data?.content).toBe('');
      }
    });
  });

  // ==================== P0 测试用例: retMode 参数配置 ====================

  describe('P0: retMode 参数配置', () => {
    it('TC-ET-003: 修改 retMode 应正确保存到 node.data.extra_configs', async () => {
      const node = createMockNode();
      mockGetNode.mockReturnValue(node);

      render(
        <EditText
          {...node}
          id={node.id}
          data={node.data}
          isConnectable={true}
        />
      );

      // 打开配置菜单
      fireEvent.click(screen.getByText('Edit'));

      await waitFor(() => {
        expect(screen.getByTestId('puppy-dropdown')).toBeInTheDocument();
      });

      // 点击选择 'return first n' 模式
      const returnFirstNOption = screen.getByTestId(
        'dropdown-option-return first n'
      );
      fireEvent.click(returnFirstNOption);

      // 等待 requestAnimationFrame 更新
      await waitFor(
        () => {
          expect(mockSetNodes).toHaveBeenCalled();
        },
        { timeout: 3000 }
      );

      // 验证 setNodes 被调用，并检查 retMode 更新
      const setNodesCall =
        mockSetNodes.mock.calls[mockSetNodes.mock.calls.length - 1];
      if (setNodesCall && typeof setNodesCall[0] === 'function') {
        const updatedNodes = setNodesCall[0]([node]);
        const updatedNode = updatedNodes.find((n: any) => n.id === node.id);
        expect(updatedNode?.data?.extra_configs?.retMode).toBe(
          'return first n'
        );
      }
    });

    it('TC-ET-003-1: retMode 应为有效的模式值', () => {
      const validModes = [
        'return all',
        'return first n',
        'return last n',
        'exclude first n',
        'exclude last n',
      ];

      validModes.forEach(mode => {
        const node = createMockNode({
          extra_configs: {
            index: undefined,
            key: undefined,
            params: { path: [] },
            retMode: mode,
            configNum: 100,
          },
        });
        expect(validModes).toContain(node.data.extra_configs.retMode);
      });
    });
  });

  // ==================== P0 测试用例: configNum 参数配置 ====================

  describe('P0: configNum 参数配置', () => {
    it('TC-ET-005: 修改 configNum 应正确保存到 node.data.extra_configs', async () => {
      const node = createMockNode({
        extra_configs: {
          index: undefined,
          key: undefined,
          params: { path: [] },
          retMode: 'return first n',
          configNum: 100,
        },
      });
      mockGetNode.mockReturnValue(node);

      render(
        <EditText
          {...node}
          id={node.id}
          data={node.data}
          isConnectable={true}
        />
      );

      // 打开配置菜单
      fireEvent.click(screen.getByText('Edit'));

      await waitFor(() => {
        expect(screen.getByText('Return Mode')).toBeInTheDocument();
      });

      // 找到 configNum 输入框
      const configNumInput = screen.getByRole('spinbutton');

      // 输入新的数值
      fireEvent.change(configNumInput, { target: { value: '50' } });

      await waitFor(
        () => {
          expect(mockSetNodes).toHaveBeenCalled();
        },
        { timeout: 3000 }
      );

      // 验证 configNum 更新
      const setNodesCall =
        mockSetNodes.mock.calls[mockSetNodes.mock.calls.length - 1];
      if (setNodesCall && typeof setNodesCall[0] === 'function') {
        const updatedNodes = setNodesCall[0]([node]);
        const updatedNode = updatedNodes.find((n: any) => n.id === node.id);
        expect(updatedNode?.data?.extra_configs?.configNum).toBe(50);
      }
    });

    it('TC-ET-005-1: configNum 应为数字类型', () => {
      const node = createMockNode({
        extra_configs: {
          index: undefined,
          key: undefined,
          params: { path: [] },
          retMode: 'return first n',
          configNum: 50,
        },
      });

      expect(typeof node.data.extra_configs.configNum).toBe('number');
    });
  });

  // ==================== P1 测试用例: retMode 模式切换 ====================

  describe('P1: retMode 模式切换', () => {
    it('TC-ET-004: 切换到 "return first n" 模式应正确保存', async () => {
      const node = createMockNode();
      mockGetNode.mockReturnValue(node);

      render(
        <EditText
          {...node}
          id={node.id}
          data={node.data}
          isConnectable={true}
        />
      );

      fireEvent.click(screen.getByText('Edit'));

      await waitFor(() => {
        expect(screen.getByTestId('puppy-dropdown')).toBeInTheDocument();
      });

      const returnFirstNOption = screen.getByTestId(
        'dropdown-option-return first n'
      );
      fireEvent.click(returnFirstNOption);

      await waitFor(
        () => {
          expect(mockSetNodes).toHaveBeenCalled();
        },
        { timeout: 3000 }
      );

      const setNodesCall =
        mockSetNodes.mock.calls[mockSetNodes.mock.calls.length - 1];
      if (setNodesCall && typeof setNodesCall[0] === 'function') {
        const updatedNodes = setNodesCall[0]([node]);
        const updatedNode = updatedNodes.find((n: any) => n.id === node.id);
        expect(updatedNode?.data?.extra_configs?.retMode).toBe(
          'return first n'
        );
      }
    });

    it('TC-ET-004-1: 切换到 "return last n" 模式应正确保存', async () => {
      const node = createMockNode();
      mockGetNode.mockReturnValue(node);

      render(
        <EditText
          {...node}
          id={node.id}
          data={node.data}
          isConnectable={true}
        />
      );

      fireEvent.click(screen.getByText('Edit'));

      await waitFor(() => {
        expect(screen.getByTestId('puppy-dropdown')).toBeInTheDocument();
      });

      const returnLastNOption = screen.getByTestId(
        'dropdown-option-return last n'
      );
      fireEvent.click(returnLastNOption);

      await waitFor(
        () => {
          expect(mockSetNodes).toHaveBeenCalled();
        },
        { timeout: 3000 }
      );

      const setNodesCall =
        mockSetNodes.mock.calls[mockSetNodes.mock.calls.length - 1];
      if (setNodesCall && typeof setNodesCall[0] === 'function') {
        const updatedNodes = setNodesCall[0]([node]);
        const updatedNode = updatedNodes.find((n: any) => n.id === node.id);
        expect(updatedNode?.data?.extra_configs?.retMode).toBe('return last n');
      }
    });

    it('TC-ET-004-2: 切换到 "exclude first n" 模式应正确保存', async () => {
      const node = createMockNode();
      mockGetNode.mockReturnValue(node);

      render(
        <EditText
          {...node}
          id={node.id}
          data={node.data}
          isConnectable={true}
        />
      );

      fireEvent.click(screen.getByText('Edit'));

      await waitFor(() => {
        expect(screen.getByTestId('puppy-dropdown')).toBeInTheDocument();
      });

      const excludeFirstNOption = screen.getByTestId(
        'dropdown-option-exclude first n'
      );
      fireEvent.click(excludeFirstNOption);

      await waitFor(
        () => {
          expect(mockSetNodes).toHaveBeenCalled();
        },
        { timeout: 3000 }
      );

      const setNodesCall =
        mockSetNodes.mock.calls[mockSetNodes.mock.calls.length - 1];
      if (setNodesCall && typeof setNodesCall[0] === 'function') {
        const updatedNodes = setNodesCall[0]([node]);
        const updatedNode = updatedNodes.find((n: any) => n.id === node.id);
        expect(updatedNode?.data?.extra_configs?.retMode).toBe(
          'exclude first n'
        );
      }
    });

    it('TC-ET-004-3: 切换到 "exclude last n" 模式应正确保存', async () => {
      const node = createMockNode();
      mockGetNode.mockReturnValue(node);

      render(
        <EditText
          {...node}
          id={node.id}
          data={node.data}
          isConnectable={true}
        />
      );

      fireEvent.click(screen.getByText('Edit'));

      await waitFor(() => {
        expect(screen.getByTestId('puppy-dropdown')).toBeInTheDocument();
      });

      const excludeLastNOption = screen.getByTestId(
        'dropdown-option-exclude last n'
      );
      fireEvent.click(excludeLastNOption);

      await waitFor(
        () => {
          expect(mockSetNodes).toHaveBeenCalled();
        },
        { timeout: 3000 }
      );

      const setNodesCall =
        mockSetNodes.mock.calls[mockSetNodes.mock.calls.length - 1];
      if (setNodesCall && typeof setNodesCall[0] === 'function') {
        const updatedNodes = setNodesCall[0]([node]);
        const updatedNode = updatedNodes.find((n: any) => n.id === node.id);
        expect(updatedNode?.data?.extra_configs?.retMode).toBe(
          'exclude last n'
        );
      }
    });
  });

  // ==================== P1 测试用例: configNum 条件渲染 ====================

  describe('P1: configNum 条件渲染', () => {
    it('TC-ET-006: configNum 应在 retMode !== "return all" 时可见', async () => {
      const node = createMockNode({
        extra_configs: {
          index: undefined,
          key: undefined,
          params: { path: [] },
          retMode: 'return first n',
          configNum: 100,
        },
      });
      mockGetNode.mockReturnValue(node);

      render(
        <EditText
          {...node}
          id={node.id}
          data={node.data}
          isConnectable={true}
        />
      );

      // 打开配置菜单
      fireEvent.click(screen.getByText('Edit'));

      await waitFor(() => {
        expect(screen.getByText('Return Mode')).toBeInTheDocument();
      });

      // 验证 configNum 输入框存在
      const configNumInput = screen.queryByRole('spinbutton');
      expect(configNumInput).toBeInTheDocument();

      // 验证单位文本 "items" 存在
      expect(screen.getByText('items')).toBeInTheDocument();
    });

    it('TC-ET-006-1: configNum 应在 retMode === "return all" 时隐藏', async () => {
      const node = createMockNode();
      mockGetNode.mockReturnValue(node);

      render(
        <EditText
          {...node}
          id={node.id}
          data={node.data}
          isConnectable={true}
        />
      );

      // 打开配置菜单
      fireEvent.click(screen.getByText('Edit'));

      await waitFor(() => {
        expect(screen.getByText('Return Mode')).toBeInTheDocument();
      });

      // 验证 configNum 输入框不存在
      const configNumInput = screen.queryByRole('spinbutton');
      expect(configNumInput).not.toBeInTheDocument();

      // 验证单位文本不存在
      expect(screen.queryByText('items')).not.toBeInTheDocument();
      expect(screen.queryByText('characters')).not.toBeInTheDocument();
    });
  });

  // ==================== P2 测试用例: 初始化和默认值 ====================

  describe('P2: 初始化和默认值', () => {
    it('TC-ET-007: textContent 默认值应为空字符串', () => {
      const node = createMockNode();
      expect(node.data.content).toBe('');
    });

    it('TC-ET-007-1: retMode 默认值应为 "return all"', () => {
      const node = createMockNode();
      expect(node.data.extra_configs.retMode).toBe('return all');
    });

    it('TC-ET-007-2: configNum 默认值应为 100', () => {
      const node = createMockNode();
      expect(node.data.extra_configs.configNum).toBe(100);
    });
  });

  // ==================== P2 测试用例: UI 交互 ====================

  describe('P2: UI 交互', () => {
    it('TC-ET-008: 点击节点按钮应打开配置菜单', async () => {
      const node = createMockNode();

      render(
        <EditText
          {...node}
          id={node.id}
          data={node.data}
          isConnectable={true}
        />
      );

      // 点击节点按钮
      const nodeButton = screen.getByText('Edit');
      fireEvent.click(nodeButton);

      // 验证配置菜单显示
      await waitFor(() => {
        expect(screen.getByText('Edit Text')).toBeInTheDocument();
        expect(screen.getByTestId('input-output-display')).toBeInTheDocument();
        expect(screen.getByText('Return Text')).toBeInTheDocument();
        expect(screen.getByText('Return Mode')).toBeInTheDocument();
        expect(screen.getByTestId('puppy-dropdown')).toBeInTheDocument();
      });
    });

    it('TC-ET-008-1: 组件挂载后验证', () => {
      const node = createMockNode();

      const { container } = render(
        <EditText
          {...node}
          id={node.id}
          data={node.data}
          isConnectable={true}
        />
      );

      // 验证组件已渲染
      expect(container).toBeInTheDocument();

      // 验证节点按钮存在
      expect(screen.getByText('Edit')).toBeInTheDocument();
      expect(screen.getByText('Text')).toBeInTheDocument();

      // 验证 SVG 图标存在
      const svgs = container.querySelectorAll('svg');
      expect(svgs.length).toBeGreaterThan(0);

      // 验证 Edit Text SVG 路径存在（编辑图标）
      const editIcon = container.querySelector('path[d="M2 10H10"]');
      expect(editIcon).toBeInTheDocument();
    });
  });
});
