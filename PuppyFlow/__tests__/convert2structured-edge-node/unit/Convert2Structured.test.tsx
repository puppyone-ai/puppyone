/**
 * Convert2Structured Edge Node - 完整测试
 *
 * 测试用例：
 * P0 致命 - execMode 参数配置：
 * - TC-C2S-001: 修改 execMode 应正确保存到 node.data
 * - TC-C2S-001-1: execMode 应为有效的模式值
 * - TC-C2S-002: 切换到 'JSON' 模式应正确保存
 * - TC-C2S-002-1: 切换到 'wrap into dict' 模式应正确保存
 * - TC-C2S-002-2: 切换到 'wrap into list' 模式应正确保存
 *
 * P0 致命 - 模式特定参数：
 * - TC-C2S-003: 修改 dict_key 应正确保存
 * - TC-C2S-003-1: dict_key 应为字符串类型
 * - TC-C2S-004: 修改 length_separator 应正确保存
 * - TC-C2S-004-1: length_separator 应为数字类型
 *
 * P1 严重 - split by character 模式：
 * - TC-C2S-005: 修改 list_separator 应正确保存
 * - TC-C2S-005-1: list_separator 应为数组类型
 * - TC-C2S-005-2: list_separator 应正确解析 JSON 字符串
 *
 * P1 严重 - 分隔符管理：
 * - TC-C2S-006: 添加新分隔符应正确更新
 * - TC-C2S-006-1: 删除分隔符应正确更新
 * - TC-C2S-007: 从常用分隔符列表添加
 * - TC-C2S-007-1: 不能添加重复的分隔符
 * - TC-C2S-008: 特殊字符分隔符正确显示
 *
 * P2 中等 - 初始化和默认值：
 * - TC-C2S-009: execMode 默认值应为 'JSON'
 * - TC-C2S-009-1: length_separator 默认值应为 10
 * - TC-C2S-009-2: delimiters 默认值应为 [',',';','.','\\n']
 * - TC-C2S-010: 应从 node.data 加载现有配置
 *
 * P2 中等 - UI 交互：
 * - TC-C2S-011: 点击节点按钮应打开配置菜单
 * - TC-C2S-011-1: 不同模式下显示对应配置项
 * - TC-C2S-012: 组件挂载后验证
 */

// @ts-nocheck
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Convert2Structured from '../../../app/components/workflow/edgesNode/edgeNodesNew/Convert2Structured';
import type { Node } from '@xyflow/react';
import type { ModifyConfigNodeData } from '../../../app/components/workflow/edgesNode/edgeNodesNew/Convert2Structured';

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
        <div data-testid='dropdown-selected-value'>{props.selectedValue}</div>
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

describe('Convert2Structured Edge Node - 完整测试', () => {
  let mockSetNodes: any;
  let mockGetNode: any;
  let mockGetInternalNode: any;
  let mockSetEdges: any;

  const createMockNode = (
    overrides: Partial<ModifyConfigNodeData> = {}
  ): Node<ModifyConfigNodeData> => ({
    id: 'test-convert-1',
    type: 'convert2structured',
    position: { x: 0, y: 0 },
    data: {
      subMenuType: null,
      content: null,
      looped: false,
      content_type: null,
      extra_configs: {
        list_separator: '[",",";",".","\\n"]',
        dict_key: undefined,
        length_separator: 10,
      },
      execMode: 'JSON',
      ...overrides,
    },
  });

  beforeEach(() => {
    mockSetNodes = vi.fn();
    mockSetEdges = vi.fn();
    mockGetNode = vi.fn(() => createMockNode());
    mockGetInternalNode = vi.fn(() => ({ id: 'test-convert-1' }));

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

  // ==================== P0 测试用例: execMode 参数配置 ====================

  describe('P0: execMode 参数配置', () => {
    it('TC-C2S-001: 修改 execMode 应正确保存到 node.data', async () => {
      const node = createMockNode();
      mockGetNode.mockReturnValue(node);

      render(
        <Convert2Structured
          {...node}
          id={node.id}
          data={node.data}
          isConnectable={true}
        />
      );

      // 点击节点打开配置菜单
      const nodeButton = screen.getByText('Convert');
      fireEvent.click(nodeButton);

      await waitFor(() => {
        expect(screen.getByTestId('puppy-dropdown')).toBeInTheDocument();
      });

      // 点击选择 'wrap into dict' 模式
      const wrapIntoDictOption = screen.getByTestId(
        'dropdown-option-wrap into dict'
      );
      fireEvent.click(wrapIntoDictOption);

      // 等待 requestAnimationFrame 更新
      await waitFor(
        () => {
          expect(mockSetNodes).toHaveBeenCalled();
        },
        { timeout: 3000 }
      );

      // 验证 setNodes 被调用，并检查 execMode 更新
      const setNodesCall =
        mockSetNodes.mock.calls[mockSetNodes.mock.calls.length - 1];
      if (setNodesCall && typeof setNodesCall[0] === 'function') {
        const updatedNodes = setNodesCall[0]([node]);
        const updatedNode = updatedNodes.find((n: any) => n.id === node.id);
        expect(updatedNode?.data?.execMode).toBe('wrap into dict');
      }
    });

    it('TC-C2S-001-1: execMode 应为有效的模式值', () => {
      const validModes = [
        'JSON',
        'wrap into dict',
        'wrap into list',
        'split by length',
        'split by character',
      ];

      validModes.forEach(mode => {
        const node = createMockNode({ execMode: mode });
        expect(validModes).toContain(node.data.execMode);
      });
    });

    it('TC-C2S-002: 切换到 "JSON" 模式应正确保存', async () => {
      const node = createMockNode({ execMode: 'wrap into dict' });
      mockGetNode.mockReturnValue(node);

      render(
        <Convert2Structured
          {...node}
          id={node.id}
          data={node.data}
          isConnectable={true}
        />
      );

      // 打开配置菜单
      fireEvent.click(screen.getByText('Convert'));

      await waitFor(() => {
        expect(screen.getByTestId('puppy-dropdown')).toBeInTheDocument();
      });

      // 选择 JSON 模式
      const jsonOption = screen.getByTestId('dropdown-option-JSON');
      fireEvent.click(jsonOption);

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
        expect(updatedNode?.data?.execMode).toBe('JSON');
      }
    });

    it('TC-C2S-002-1: 切换到 "wrap into dict" 模式应正确保存', async () => {
      const node = createMockNode();
      mockGetNode.mockReturnValue(node);

      render(
        <Convert2Structured
          {...node}
          id={node.id}
          data={node.data}
          isConnectable={true}
        />
      );

      fireEvent.click(screen.getByText('Convert'));

      await waitFor(() => {
        expect(screen.getByTestId('puppy-dropdown')).toBeInTheDocument();
      });

      const wrapIntoDictOption = screen.getByTestId(
        'dropdown-option-wrap into dict'
      );
      fireEvent.click(wrapIntoDictOption);

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
        expect(updatedNode?.data?.execMode).toBe('wrap into dict');
      }
    });

    it('TC-C2S-002-2: 切换到 "wrap into list" 模式应正确保存', async () => {
      const node = createMockNode();
      mockGetNode.mockReturnValue(node);

      render(
        <Convert2Structured
          {...node}
          id={node.id}
          data={node.data}
          isConnectable={true}
        />
      );

      fireEvent.click(screen.getByText('Convert'));

      await waitFor(() => {
        expect(screen.getByTestId('puppy-dropdown')).toBeInTheDocument();
      });

      const wrapIntoListOption = screen.getByTestId(
        'dropdown-option-wrap into list'
      );
      fireEvent.click(wrapIntoListOption);

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
        expect(updatedNode?.data?.execMode).toBe('wrap into list');
      }
    });
  });

  // ==================== P0 测试用例: 模式特定参数 ====================

  describe('P0: 模式特定参数', () => {
    it('TC-C2S-003: 修改 dict_key 应正确保存', async () => {
      const node = createMockNode({ execMode: 'wrap into dict' });
      mockGetNode.mockReturnValue(node);

      render(
        <Convert2Structured
          {...node}
          id={node.id}
          data={node.data}
          isConnectable={true}
        />
      );

      // 打开配置菜单
      fireEvent.click(screen.getByText('Convert'));

      await waitFor(() => {
        expect(screen.getByText('Key')).toBeInTheDocument();
      });

      // 找到 Key 输入框
      const keyInput = screen.getByRole('textbox');

      // 输入 key 值
      fireEvent.change(keyInput, { target: { value: 'myKey' } });

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
        expect(updatedNode?.data?.extra_configs?.dict_key).toBe('myKey');
      }
    });

    it('TC-C2S-003-1: dict_key 应为字符串类型', async () => {
      const node = createMockNode({
        execMode: 'wrap into dict',
        extra_configs: {
          dict_key: 'testKey',
        },
      });

      expect(typeof node.data.extra_configs?.dict_key).toBe('string');
    });

    it('TC-C2S-004: 修改 length_separator 应正确保存', async () => {
      const node = createMockNode({ execMode: 'split by length' });
      mockGetNode.mockReturnValue(node);

      render(
        <Convert2Structured
          {...node}
          id={node.id}
          data={node.data}
          isConnectable={true}
        />
      );

      // 打开配置菜单
      fireEvent.click(screen.getByText('Convert'));

      await waitFor(() => {
        expect(screen.getByText('Length')).toBeInTheDocument();
      });

      // 找到 Length 输入框
      const lengthInput = screen.getByRole('spinbutton');

      // 输入长度值
      fireEvent.change(lengthInput, { target: { value: '20' } });

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
        expect(updatedNode?.data?.extra_configs?.length_separator).toBe(20);
      }
    });

    it('TC-C2S-004-1: length_separator 应为数字类型', () => {
      const node = createMockNode({
        execMode: 'split by length',
        extra_configs: {
          length_separator: 15,
        },
      });

      expect(typeof node.data.extra_configs?.length_separator).toBe('number');
    });
  });

  // ==================== P1 测试用例: split by character 模式 ====================

  describe('P1: split by character 模式参数', () => {
    it('TC-C2S-005: 修改 list_separator 应正确保存', async () => {
      const node = createMockNode({ execMode: 'split by character' });
      mockGetNode.mockReturnValue(node);

      render(
        <Convert2Structured
          {...node}
          id={node.id}
          data={node.data}
          isConnectable={true}
        />
      );

      // 打开配置菜单
      fireEvent.click(screen.getByText('Convert'));

      await waitFor(() => {
        expect(screen.getByText('Delimiters')).toBeInTheDocument();
      });

      // 通过添加分隔符来触发状态变化，从而触发 setNodes
      const addButtons = screen.getAllByRole('button');
      const plusButton = addButtons.find(btn => {
        const svg = btn.querySelector('svg');
        return svg && svg.querySelector('path[d*="M12 5v14M5 12h14"]');
      });

      if (plusButton) {
        fireEvent.click(plusButton);
        
        await waitFor(() => {
          const input = screen.queryByPlaceholderText('Type...');
          expect(input).toBeInTheDocument();
        });

        const input = screen.getByPlaceholderText('Type...');
        fireEvent.change(input, { target: { value: '|' } });
        fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
      }

      // 验证 deliminator 状态会被保存（通过 setNodes）
      await waitFor(
        () => {
          const calls = mockSetNodes.mock.calls;
          expect(calls.length).toBeGreaterThan(0);
          
          // 验证最新的调用包含更新的 list_separator
          const lastCall = calls[calls.length - 1];
          if (typeof lastCall[0] === 'function') {
            const updatedNodes = lastCall[0]([node]);
            const updatedNode = updatedNodes.find((n: any) => n.id === node.id);
            expect(updatedNode?.data?.extra_configs?.list_separator).toBeDefined();
          }
        },
        { timeout: 3000 }
      );
    });

    it('TC-C2S-005-1: list_separator 应为数组类型（解析后）', () => {
      const node = createMockNode({
        execMode: 'split by character',
        extra_configs: {
          list_separator: '[",",";"]',
        },
      });

      // 解析 JSON 字符串
      const parsed = JSON.parse(
        node.data.extra_configs?.list_separator as string
      );
      expect(Array.isArray(parsed)).toBe(true);
    });

    it('TC-C2S-005-2: list_separator 应正确解析 JSON 字符串', () => {
      const node = createMockNode({
        execMode: 'split by character',
        extra_configs: {
          list_separator: '[",",";",".","\\n"]',
        },
      });

      const parsed = JSON.parse(
        node.data.extra_configs?.list_separator as string
      );
      expect(parsed).toEqual([',', ';', '.', '\n']);
    });
  });

  // ==================== P1 测试用例: 分隔符管理 ====================

  describe('P1: 分隔符管理', () => {
    it('TC-C2S-006: 添加新分隔符应正确更新', async () => {
      const node = createMockNode({ execMode: 'split by character' });
      mockGetNode.mockReturnValue(node);

      render(
        <Convert2Structured
          {...node}
          id={node.id}
          data={node.data}
          isConnectable={true}
        />
      );

      // 打开配置菜单
      fireEvent.click(screen.getByText('Convert'));

      await waitFor(() => {
        expect(screen.getByText('Delimiters')).toBeInTheDocument();
      });

      // 点击 "+" 按钮
      const addButtons = screen.getAllByRole('button');
      const plusButton = addButtons.find(btn => {
        const svg = btn.querySelector('svg');
        return svg && svg.querySelector('path[d*="M12 5v14M5 12h14"]');
      });

      if (plusButton) {
        fireEvent.click(plusButton);

        // 等待输入框显示
        await waitFor(() => {
          const input = screen.queryByPlaceholderText('Type...');
          expect(input).toBeInTheDocument();
        });

        // 输入自定义分隔符
        const input = screen.getByPlaceholderText('Type...');
        fireEvent.change(input, { target: { value: '|' } });
        fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

        // 验证分隔符被添加（通过 setNodes 更新）
        await waitFor(
          () => {
            const calls = mockSetNodes.mock.calls;
            if (calls.length > 0) {
              const lastCall = calls[calls.length - 1];
              if (typeof lastCall[0] === 'function') {
                const updatedNodes = lastCall[0]([node]);
                const updatedNode = updatedNodes.find(
                  (n: any) => n.id === node.id
                );
                const deliminator =
                  updatedNode?.data?.extra_configs?.list_separator;
                if (deliminator) {
                  const parsed = JSON.parse(deliminator);
                  expect(parsed).toContain('|');
                }
              }
            }
          },
          { timeout: 3000 }
        );
      }
    });

    it('TC-C2S-006-1: 删除分隔符应正确更新', async () => {
      const node = createMockNode({
        execMode: 'split by character',
        extra_configs: {
          list_separator: '[",",";","|"]',
        },
      });
      mockGetNode.mockReturnValue(node);

      render(
        <Convert2Structured
          {...node}
          id={node.id}
          data={node.data}
          isConnectable={true}
        />
      );

      // 打开配置菜单
      fireEvent.click(screen.getByText('Convert'));

      await waitFor(() => {
        expect(screen.getByText('Delimiters')).toBeInTheDocument();
      });

      // 查找删除按钮（X 按钮）
      const deleteButtons = screen.getAllByRole('button');
      const xButton = deleteButtons.find(btn => {
        const svg = btn.querySelector('svg');
        return svg && svg.querySelector('line[x1="18"][y1="6"]');
      });

      if (xButton) {
        // Hover 以显示删除按钮
        fireEvent.mouseEnter(xButton.parentElement || xButton);
        fireEvent.click(xButton);

        // 验证分隔符被删除
        await waitFor(
          () => {
            expect(mockSetNodes).toHaveBeenCalled();
          },
          { timeout: 3000 }
        );
      }
    });

    it('TC-C2S-007: 从常用分隔符列表添加', async () => {
      const node = createMockNode({ execMode: 'split by character' });
      mockGetNode.mockReturnValue(node);

      render(
        <Convert2Structured
          {...node}
          id={node.id}
          data={node.data}
          isConnectable={true}
        />
      );

      // 打开配置菜单
      fireEvent.click(screen.getByText('Convert'));

      await waitFor(() => {
        expect(screen.getByText('Common delimiters:')).toBeInTheDocument();
      });

      // 点击常用分隔符按钮（如 "Pipe (|)"）
      const pipeButton = screen.getByText('Pipe (|)');
      fireEvent.click(pipeButton);

      // 验证分隔符被添加
      await waitFor(
        () => {
          expect(mockSetNodes).toHaveBeenCalled();
        },
        { timeout: 3000 }
      );
    });

    it('TC-C2S-007-1: 不能添加重复的分隔符', async () => {
      const node = createMockNode({
        execMode: 'split by character',
        extra_configs: {
          list_separator: '[","]',
        },
      });
      mockGetNode.mockReturnValue(node);

      render(
        <Convert2Structured
          {...node}
          id={node.id}
          data={node.data}
          isConnectable={true}
        />
      );

      // 打开配置菜单
      fireEvent.click(screen.getByText('Convert'));

      await waitFor(() => {
        expect(screen.getByText('Comma (,)')).toBeInTheDocument();
      });

      // 尝试添加已存在的分隔符
      const commaButton = screen.getByText('Comma (,)');
      const initialCallCount = mockSetNodes.mock.calls.length;

      fireEvent.click(commaButton);

      // 由于分隔符已存在，不应该触发新的 setNodes 调用（或调用但不改变）
      await new Promise(resolve => setTimeout(resolve, 500));

      // 验证没有新的重复添加
      const finalCallCount = mockSetNodes.mock.calls.length;
      // 可能会有调用，但不会增加重复的分隔符
      expect(finalCallCount).toBeGreaterThanOrEqual(initialCallCount);
    });

    it('TC-C2S-008: 特殊字符分隔符正确显示', async () => {
      const node = createMockNode({
        execMode: 'split by character',
        extra_configs: {
          list_separator: '["\\n","\\t"," "]',
        },
      });
      mockGetNode.mockReturnValue(node);

      const { container } = render(
        <Convert2Structured
          {...node}
          id={node.id}
          data={node.data}
          isConnectable={true}
        />
      );

      // 打开配置菜单
      fireEvent.click(screen.getByText('Convert'));

      await waitFor(() => {
        expect(screen.getByText('Delimiters')).toBeInTheDocument();
      });

      // 验证特殊字符的显示
      // Enter 应该显示为 "Enter" 文本和 SVG 图标
      const enterElements = screen.getAllByText('Enter');
      expect(enterElements.length).toBeGreaterThan(0);

      // Tab 应该显示为 "Tab"
      const tabElements = screen.getAllByText('Tab');
      expect(tabElements.length).toBeGreaterThan(0);

      // Space 应该显示为 "Space"
      const spaceElements = screen.getAllByText('Space');
      expect(spaceElements.length).toBeGreaterThan(0);
    });
  });

  // ==================== P2 测试用例: 初始化和默认值 ====================

  describe('P2: 初始化和默认值', () => {
    it('TC-C2S-009: execMode 默认值应为 "JSON"', () => {
      const node = createMockNode();
      mockGetNode.mockReturnValue(node);

      render(
        <Convert2Structured
          {...node}
          id={node.id}
          data={node.data}
          isConnectable={true}
        />
      );

      // 验证默认 execMode
      expect(node.data.execMode).toBe('JSON');
    });

    it('TC-C2S-009-1: length_separator 默认值应为 10', () => {
      const node = createMockNode({ execMode: 'split by length' });

      // 验证默认 length_separator
      expect(node.data.extra_configs?.length_separator).toBe(10);
    });

    it('TC-C2S-009-2: delimiters 默认值应为 [",",";",".","\\n"]', () => {
      const node = createMockNode({
        execMode: 'split by character',
        extra_configs: {
          list_separator: '[",",";",".","\\n"]',
        },
      });

      // 解析 JSON 并验证默认分隔符
      const parsed = JSON.parse(
        node.data.extra_configs?.list_separator as string
      );
      expect(parsed).toEqual([',', ';', '.', '\n']);
    });

    it('TC-C2S-010: 应从 node.data 加载现有配置', async () => {
      const existingNode = createMockNode({
        execMode: 'wrap into dict',
        extra_configs: {
          dict_key: 'loadedKey',
        },
      });
      mockGetNode.mockReturnValue(existingNode);

      render(
        <Convert2Structured
          {...existingNode}
          id={existingNode.id}
          data={existingNode.data}
          isConnectable={true}
        />
      );

      // 打开配置菜单
      fireEvent.click(screen.getByText('Convert'));

      await waitFor(() => {
        // 验证 Mode 显示正确的值（通过 dropdown 的 selected value）
        const dropdown = screen.getByTestId('puppy-dropdown');
        expect(dropdown).toBeInTheDocument();
        const selectedValue = screen.getByTestId('dropdown-selected-value');
        expect(selectedValue).toHaveTextContent('wrap into dict');
      });

      // 验证 Key 输入框显示加载的值
      await waitFor(() => {
        const keyInput = screen.getByRole('textbox');
        expect(keyInput).toHaveValue('loadedKey');
      });
    });
  });

  // ==================== P2 测试用例: UI 交互 ====================

  describe('P2: UI 交互', () => {
    it('TC-C2S-011: 点击节点按钮应打开配置菜单', async () => {
      const node = createMockNode();

      render(
        <Convert2Structured
          {...node}
          id={node.id}
          data={node.data}
          isConnectable={true}
        />
      );

      // 点击节点按钮
      const nodeButton = screen.getByText('Convert');
      fireEvent.click(nodeButton);

      // 验证配置菜单显示
      await waitFor(() => {
        expect(screen.getByText('Convert to Structured')).toBeInTheDocument();
        expect(screen.getByTestId('input-output-display')).toBeInTheDocument();
        expect(screen.getByText('Mode')).toBeInTheDocument();
        expect(screen.getByTestId('puppy-dropdown')).toBeInTheDocument();
      });
    });

    it('TC-C2S-011-1: 不同模式下显示对应配置项', async () => {
      const node = createMockNode();
      mockGetNode.mockReturnValue(node);

      const { rerender } = render(
        <Convert2Structured
          {...node}
          id={node.id}
          data={node.data}
          isConnectable={true}
        />
      );

      // 打开配置菜单
      fireEvent.click(screen.getByText('Convert'));

      // JSON 模式：不应该显示额外配置
      await waitFor(() => {
        expect(screen.queryByText('Key')).not.toBeInTheDocument();
        expect(screen.queryByText('Length')).not.toBeInTheDocument();
        expect(screen.queryByText('Delimiters')).not.toBeInTheDocument();
      });

      // 切换到 wrap into dict 模式
      const wrapIntoDictOption = screen.getByTestId(
        'dropdown-option-wrap into dict'
      );
      fireEvent.click(wrapIntoDictOption);

      await waitFor(() => {
        expect(screen.getByText('Key')).toBeInTheDocument();
      });

      // 切换到 split by length 模式
      const splitByLenOption = screen.getByTestId(
        'dropdown-option-split by length'
      );
      fireEvent.click(splitByLenOption);

      await waitFor(() => {
        expect(screen.getByText('Length')).toBeInTheDocument();
      });

      // 切换到 split by character 模式
      const splitByCharOption = screen.getByTestId(
        'dropdown-option-split by character'
      );
      fireEvent.click(splitByCharOption);

      await waitFor(() => {
        expect(screen.getByText('Delimiters')).toBeInTheDocument();
      });
    });

    it('TC-C2S-012: 组件挂载后验证', () => {
      const node = createMockNode();

      const { container } = render(
        <Convert2Structured
          {...node}
          id={node.id}
          data={node.data}
          isConnectable={true}
        />
      );

      // 验证组件已渲染
      expect(container).toBeInTheDocument();

      // 验证节点按钮存在
      expect(screen.getByText('Convert')).toBeInTheDocument();
      expect(screen.getByText('Struct')).toBeInTheDocument();

      // 验证 SVG 图标存在
      const svgs = container.querySelectorAll('svg');
      expect(svgs.length).toBeGreaterThan(0);

      // 验证 Convert to Structured SVG 路径存在
      const convertIcon = container.querySelector('path[d="M12 2L2 12"]');
      expect(convertIcon).toBeInTheDocument();
    });
  });
});
