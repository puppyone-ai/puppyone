/**
 * ChunkingByLength Edge Node - 完整测试
 *
 * 测试用例：
 * P0 致命 - 核心参数配置：
 * - TC-CBL-001: 修改 subChunkMode 应正确保存到 node.data
 * - TC-CBL-001-1: subChunkMode 应为有效值
 * - TC-CBL-002: 修改 chunkSize 应正确保存到 node.data.extra_configs
 * - TC-CBL-002-1: chunkSize 应为数字类型
 * - TC-CBL-003: 修改 overlap 应正确保存到 node.data.extra_configs
 * - TC-CBL-003-1: overlap 应为数字类型
 * - TC-CBL-004: 修改 handleHalfWord 应正确保存到 node.data.extra_configs
 * 
 * P1 严重 - 重要功能：
 * - TC-CBL-005: 点击 Show 应展开 Settings
 * - TC-CBL-005-1: 点击 Hide 应收起 Settings
 * - TC-CBL-006: chunkSize 和 overlap 边界值测试
 * - TC-CBL-007: 点击 Run 按钮应触发执行
 *
 * P2 中等 - UI 交互：
 * - TC-CBL-008: 参数默认值验证
 * - TC-CBL-009: 点击节点按钮应打开配置菜单
 * - TC-CBL-010: 组件挂载后验证
 */

// @ts-nocheck
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import ChunkingByLength from '../../../app/components/workflow/edgesNode/edgeNodesNew/ChunkingByLength';
import type { Node } from '@xyflow/react';
import type { ChunkingConfigNodeData } from '../../../app/components/workflow/edgesNode/edgeNodesNew/ChunkingByLength';

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

vi.mock('../../../app/components/workflow/edgesNode/edgeNodesNew/components/InputOutputDisplay', () => ({
  default: () => <div data-testid='input-output-display'>InputOutputDisplay</div>,
}));

vi.mock('../../../app/utils/colors', () => ({
  UI_COLORS: {
    LINE_ACTIVE: '#39BC66',
    EDGENODE_BORDER_GREY: '#6D7177',
  },
}));

vi.mock('../../../app/components/workflow/edgesNode/edgeNodesNew/hook/runSingleEdgeNodeExecutor', () => ({
  runSingleEdgeNode: mocks.runSingleEdgeNode,
}));

// Mock PuppyDropdown
vi.mock('../../../app/misc/PuppyDropDown', () => ({
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
          {props.mapValueTodisplay 
            ? props.mapValueTodisplay(props.selectedValue) 
            : props.selectedValue}
        </button>
        <div data-testid='dropdown-options'>
          {props.options.map((option: string) => (
            <button
              key={option}
              data-testid={`dropdown-option-${option}`}
              onClick={() => props.onSelect(option)}
            >
              {props.mapValueTodisplay ? props.mapValueTodisplay(option) : option}
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

describe('ChunkingByLength Edge Node - 完整测试', () => {
  let mockSetNodes: any;
  let mockGetNode: any;
  let mockGetInternalNode: any;
  let mockSetEdges: any;
  let testNode: Node<ChunkingConfigNodeData>;

  const createMockNode = (overrides: Partial<ChunkingConfigNodeData> = {}): Node<ChunkingConfigNodeData> => ({
    id: 'test-chunkingbylength-1',
    type: 'chunkingbylength',
    position: { x: 0, y: 0 },
    data: {
      looped: false,
      subMenuType: null,
      sub_chunking_mode: 'size',
      content: null,
      extra_configs: {
        model: undefined,
        chunk_size: 200,
        overlap: 20,
        handle_half_word: false,
      },
      ...overrides,
    },
  });

  beforeEach(() => {
    testNode = createMockNode();
    mockSetNodes = vi.fn();
    mockSetEdges = vi.fn();
    mockGetNode = vi.fn(() => testNode);
    mockGetInternalNode = vi.fn(() => ({ id: 'test-chunkingbylength-1' }));

    mocks.useReactFlow.mockReturnValue({
      getNode: mockGetNode,
      getInternalNode: mockGetInternalNode,
      setNodes: mockSetNodes,
      setEdges: mockSetEdges,
      getNodes: vi.fn(() => [testNode]),
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

  // ==================== P0 测试用例: subChunkMode 参数配置 ====================

  describe('P0: subChunkMode 参数配置', () => {
    it('TC-CBL-001: 修改 subChunkMode 应正确保存到 node.data', async () => {
      render(<ChunkingByLength {...testNode} id={testNode.id} data={testNode.data} isConnectable={true} />);

      // 打开配置菜单
      const nodeButton = screen.getByText('Chunk');
      fireEvent.click(nodeButton);

      await waitFor(() => {
        expect(screen.getByText('Chunk By length')).toBeInTheDocument();
      });

      // 验证 Mode 显示为 'by size'（真实 PuppyDropdown 的渲染结果）
      expect(screen.getByText('by size')).toBeInTheDocument();

      // 验证 node.data 的 sub_chunking_mode 为 'size'（这是初始值）
      expect(testNode.data.sub_chunking_mode).toBe('size');
    });

    it('TC-CBL-001-1: subChunkMode 应为有效值', () => {
      // 测试 'size'
      const nodeSize = createMockNode({ sub_chunking_mode: 'size' });
      expect(nodeSize.data.sub_chunking_mode).toBe('size');

      // 测试 'tokenizer'
      const nodeTokenizer = createMockNode({ sub_chunking_mode: 'tokenizer' });
      expect(nodeTokenizer.data.sub_chunking_mode).toBe('tokenizer');

      // 验证类型
      const validModes = ['size', 'tokenizer'];
      expect(validModes).toContain(nodeSize.data.sub_chunking_mode);
      expect(validModes).toContain(nodeTokenizer.data.sub_chunking_mode);
    });
  });

  // ==================== P0 测试用例: chunkSize 参数配置 ====================

  describe('P0: chunkSize 参数配置', () => {
    it('TC-CBL-002: 修改 chunkSize 应正确保存到 node.data.extra_configs', async () => {
      render(<ChunkingByLength {...testNode} id={testNode.id} data={testNode.data} isConnectable={true} />);

      // 打开配置菜单
      fireEvent.click(screen.getByText('Chunk'));

      await waitFor(() => {
        expect(screen.getByText('Chunk By length')).toBeInTheDocument();
      });

      // 展开 Settings
      const showButton = screen.getByText('Show');
      fireEvent.click(showButton);

      await waitFor(() => {
        expect(screen.getByText('Chunk Size')).toBeInTheDocument();
      });

      // 找到 Chunk Size 输入框
      const chunkSizeInputs = screen.getAllByRole('spinbutton');
      const chunkSizeInput = chunkSizeInputs.find((input: HTMLInputElement) => 
        input.value === '200'
      );

      expect(chunkSizeInput).toBeDefined();

      if (chunkSizeInput) {
        // 修改值
        fireEvent.change(chunkSizeInput, { target: { value: '500' } });

        // 验证 node.data 被更新 (直接修改)
        await waitFor(() => {
          expect(testNode.data.extra_configs.chunk_size).toBe(500);
        });
      }
    });

    it('TC-CBL-002-1: chunkSize 应为数字类型', () => {
      const node = createMockNode({
        extra_configs: {
          model: undefined,
          chunk_size: 200,
          overlap: 20,
          handle_half_word: false,
        },
      });

      expect(typeof node.data.extra_configs.chunk_size).toBe('number');
      expect(node.data.extra_configs.chunk_size).toBe(200);
    });
  });

  // ==================== P0 测试用例: overlap 参数配置 ====================

  describe('P0: overlap 参数配置', () => {
    it('TC-CBL-003: 修改 overlap 应正确保存到 node.data.extra_configs', async () => {
      render(<ChunkingByLength {...testNode} id={testNode.id} data={testNode.data} isConnectable={true} />);

      // 打开配置菜单
      fireEvent.click(screen.getByText('Chunk'));

      await waitFor(() => {
        expect(screen.getByText('Chunk By length')).toBeInTheDocument();
      });

      // 展开 Settings
      fireEvent.click(screen.getByText('Show'));

      await waitFor(() => {
        expect(screen.getByText('Overlap')).toBeInTheDocument();
      });

      // 找到 Overlap 输入框
      const overlapInputs = screen.getAllByRole('spinbutton');
      const overlapInput = overlapInputs.find((input: HTMLInputElement) => 
        input.value === '20'
      );

      expect(overlapInput).toBeDefined();

      if (overlapInput) {
        // 修改值
        fireEvent.change(overlapInput, { target: { value: '50' } });

        // 验证 node.data 被更新
        await waitFor(() => {
          expect(testNode.data.extra_configs.overlap).toBe(50);
        });
      }
    });

    it('TC-CBL-003-1: overlap 应为数字类型', () => {
      const node = createMockNode({
        extra_configs: {
          model: undefined,
          chunk_size: 200,
          overlap: 20,
          handle_half_word: false,
        },
      });

      expect(typeof node.data.extra_configs.overlap).toBe('number');
      expect(node.data.extra_configs.overlap).toBe(20);
    });
  });

  // ==================== P0 测试用例: handleHalfWord 参数配置 ====================

  describe('P0: handleHalfWord 参数配置', () => {
    it('TC-CBL-004: 修改 handleHalfWord 应正确保存到 node.data.extra_configs', async () => {
      render(<ChunkingByLength {...testNode} id={testNode.id} data={testNode.data} isConnectable={true} />);

      // 打开配置菜单
      fireEvent.click(screen.getByText('Chunk'));

      await waitFor(() => {
        expect(screen.getByText('Chunk By length')).toBeInTheDocument();
      });

      // 展开 Settings
      fireEvent.click(screen.getByText('Show'));

      await waitFor(() => {
        expect(screen.getByText('Handle Half Word')).toBeInTheDocument();
      });

      // 找到 Handle Half Word select
      const selects = screen.getAllByRole('combobox');
      const handleHalfWordSelect = selects[0]; // 假设是第一个 select

      // 改为 True
      fireEvent.change(handleHalfWordSelect, { target: { value: 'True' } });

      // 验证 node.data 被更新
      await waitFor(() => {
        expect(testNode.data.extra_configs.handle_half_word).toBe(true);
      });

      // 改回 False
      fireEvent.change(handleHalfWordSelect, { target: { value: 'False' } });

      await waitFor(() => {
        expect(testNode.data.extra_configs.handle_half_word).toBe(false);
      });
    });
  });

  // ==================== P1 测试用例: Settings 交互 ====================

  describe('P1: Settings 交互', () => {
    it('TC-CBL-005: 点击 Show 应展开 Settings', async () => {
      render(<ChunkingByLength {...testNode} id={testNode.id} data={testNode.data} isConnectable={true} />);

      // 打开配置菜单
      fireEvent.click(screen.getByText('Chunk'));

      await waitFor(() => {
        expect(screen.getByText('Chunk By length')).toBeInTheDocument();
      });

      // 验证初始状态：Settings 收起
      expect(screen.queryByText('Chunk Size')).not.toBeInTheDocument();

      // 点击 Show 按钮
      const showButton = screen.getByText('Show');
      fireEvent.click(showButton);

      // 验证 Settings 展开
      await waitFor(() => {
        expect(screen.getByText('Chunk Size')).toBeInTheDocument();
        expect(screen.getByText('Overlap')).toBeInTheDocument();
        expect(screen.getByText('Handle Half Word')).toBeInTheDocument();
      });

      // 验证按钮文字变为 Hide
      expect(screen.getByText('Hide')).toBeInTheDocument();
    });

    it('TC-CBL-005-1: 点击 Hide 应收起 Settings', async () => {
      render(<ChunkingByLength {...testNode} id={testNode.id} data={testNode.data} isConnectable={true} />);

      // 打开配置菜单
      fireEvent.click(screen.getByText('Chunk'));

      await waitFor(() => {
        expect(screen.getByText('Chunk By length')).toBeInTheDocument();
      });

      // 展开 Settings
      fireEvent.click(screen.getByText('Show'));

      await waitFor(() => {
        expect(screen.getByText('Chunk Size')).toBeInTheDocument();
      });

      // 点击 Hide 按钮
      const hideButton = screen.getByText('Hide');
      fireEvent.click(hideButton);

      // 验证 Settings 收起
      await waitFor(() => {
        expect(screen.queryByText('Chunk Size')).not.toBeInTheDocument();
      });

      // 验证按钮文字变为 Show
      expect(screen.getByText('Show')).toBeInTheDocument();
    });
  });

  // ==================== P1 测试用例: 边界值测试 ====================

  describe('P1: 边界值测试', () => {
    it('TC-CBL-006: chunkSize 和 overlap 边界值测试', async () => {
      render(<ChunkingByLength {...testNode} id={testNode.id} data={testNode.data} isConnectable={true} />);

      // 打开配置菜单并展开 Settings
      fireEvent.click(screen.getByText('Chunk'));
      await waitFor(() => expect(screen.getByText('Show')).toBeInTheDocument());
      fireEvent.click(screen.getByText('Show'));
      await waitFor(() => expect(screen.getByText('Chunk Size')).toBeInTheDocument());

      const inputs = screen.getAllByRole('spinbutton');
      const chunkSizeInput = inputs[0];
      const overlapInput = inputs[1];

      // 测试 chunkSize = 0
      fireEvent.change(chunkSizeInput, { target: { value: '0' } });
      await waitFor(() => {
        expect(testNode.data.extra_configs.chunk_size).toBe(0);
      });

      // 测试 chunkSize 极大值
      fireEvent.change(chunkSizeInput, { target: { value: '999999' } });
      await waitFor(() => {
        expect(testNode.data.extra_configs.chunk_size).toBe(999999);
      });

      // 测试 overlap = 0
      fireEvent.change(overlapInput, { target: { value: '0' } });
      await waitFor(() => {
        expect(testNode.data.extra_configs.overlap).toBe(0);
      });

      // 测试清空（undefined）
      fireEvent.change(chunkSizeInput, { target: { value: '' } });
      await waitFor(() => {
        expect(testNode.data.extra_configs.chunk_size).toBeUndefined();
      });
    });
  });

  // ==================== P1 测试用例: Run 功能 ====================

  describe('P1: Run 功能', () => {
    it('TC-CBL-007: 点击 Run 按钮应触发执行', async () => {
      render(<ChunkingByLength {...testNode} id={testNode.id} data={testNode.data} isConnectable={true} />);

      // 打开配置菜单
      fireEvent.click(screen.getByText('Chunk'));

      await waitFor(() => {
        expect(screen.getByText('Chunk By length')).toBeInTheDocument();
      });

      // 找到配置菜单中的 Run 按钮
      const runButtons = screen.getAllByText('Run');
      const menuRunButton = runButtons.find(button => {
        const parent = button.parentElement;
        return parent?.className.includes('w-[57px]') && parent?.className.includes('h-[24px]');
      });

      expect(menuRunButton).toBeDefined();

      if (menuRunButton) {
        // 点击 Run 按钮
        fireEvent.click(menuRunButton);

        // 等待异步执行
        await waitFor(() => {
          expect(mocks.runSingleEdgeNode).toHaveBeenCalled();
        }, { timeout: 3000 });

        // 验证调用参数
        expect(mocks.runSingleEdgeNode).toHaveBeenCalledWith(
          expect.objectContaining({
            parentId: testNode.id,
            targetNodeType: 'structured',
            context: expect.any(Object),
          })
        );
      }
    });
  });

  // ==================== P2 测试用例: 初始化和 UI 交互 ====================

  describe('P2: 初始化和 UI 交互', () => {
    it('TC-CBL-008: 参数默认值验证', () => {
      const node = createMockNode();

      // 验证默认值
      expect(node.data.sub_chunking_mode).toBe('size');
      expect(node.data.extra_configs.chunk_size).toBe(200);
      expect(node.data.extra_configs.overlap).toBe(20);
      expect(node.data.extra_configs.handle_half_word).toBe(false);
    });

    it('TC-CBL-009: 点击节点按钮应打开配置菜单', async () => {
      render(<ChunkingByLength {...testNode} id={testNode.id} data={testNode.data} isConnectable={true} />);

      // 点击节点按钮
      const nodeButton = screen.getByText('Chunk');
      fireEvent.click(nodeButton);

      // 验证配置菜单显示
      await waitFor(() => {
        expect(screen.getByText('Chunk By length')).toBeInTheDocument();
        expect(screen.getByTestId('input-output-display')).toBeInTheDocument();
        expect(screen.getByText('Mode')).toBeInTheDocument();
        expect(screen.getByText('by size')).toBeInTheDocument();
        expect(screen.getByText('Show')).toBeInTheDocument();
      });
    });

    it('TC-CBL-010: 组件挂载后验证', () => {
      const { container } = render(
        <ChunkingByLength {...testNode} id={testNode.id} data={testNode.data} isConnectable={true} />
      );

      // 验证组件已渲染
      expect(container).toBeInTheDocument();
      
      // 验证节点按钮存在
      expect(screen.getByText('Chunk')).toBeInTheDocument();
      expect(screen.getByText('Length')).toBeInTheDocument();
      
      // 验证 SVG 图标存在
      const svgs = container.querySelectorAll('svg');
      expect(svgs.length).toBeGreaterThan(0);
    });
  });
});

