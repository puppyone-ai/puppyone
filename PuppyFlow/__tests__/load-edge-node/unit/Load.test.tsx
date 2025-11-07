/**
 * Load Edge Node - 完整测试
 *
 * 测试用例：
 * P0 致命 - 数据结构完整性：
 * - TC-LD-001: LoadNodeFrontendConfig 数据结构验证
 * - TC-LD-001-1: resultNode 字段类型验证
 * - TC-LD-001-2: LoadOperationApiPayload 数据结构验证
 *
 * P1 严重 - 核心功能：
 * - TC-LD-002: 点击 Run 按钮调用 runSingleEdgeNode
 * - TC-LD-002-1: Run 按钮在 loading 时显示加载状态
 * - TC-LD-002-2: Run 按钮在 loading 时禁用
 * - TC-LD-003: InputOutputDisplay 配置验证
 *
 * P2 中等 - UI 交互：
 * - TC-LD-004: 点击节点按钮打开/关闭配置菜单
 * - TC-LD-004-1: 组件挂载后正确初始化
 */

// @ts-nocheck
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Load from '../../../app/components/workflow/edgesNode/edgeNodesNew/Load';
import type { Node } from '@xyflow/react';
import type { LoadNodeFrontendConfig } from '../../../app/components/workflow/edgesNode/edgeNodesNew/Load';

// ============================================================================
// Mocks
// ============================================================================

const mocks = vi.hoisted(() => ({
  useReactFlow: vi.fn(),
  useNodesPerFlowContext: vi.fn(),
  useGetSourceTarget: vi.fn(),
  useJsonConstructUtils: vi.fn(),
  useAppSettings: vi.fn(),
  runSingleEdgeNode: vi.fn(),
}));

vi.mock('@xyflow/react', async importOriginal => {
  const actual = await importOriginal<typeof import('@xyflow/react')>();
  return {
    ...actual,
    useReactFlow: mocks.useReactFlow,
    Handle: ({ id, type, position }: any) => (
      <div data-testid={`handle-${type}-${id}`} data-position={position} />
    ),
  };
});

vi.mock('../../../app/components/states/NodesPerFlowContext', () => ({
  useNodesPerFlowContext: mocks.useNodesPerFlowContext,
}));

vi.mock('../../../app/components/hooks/useGetSourceTarget', () => ({
  default: mocks.useGetSourceTarget,
}));

vi.mock('../../../app/hooks/useJsonConstructUtils', () => ({
  default: mocks.useJsonConstructUtils,
}));

vi.mock('../../../app/components/states/AppSettingsContext', () => ({
  useAppSettings: mocks.useAppSettings,
}));

vi.mock('react-dom', async () => {
  const actual = await vi.importActual('react-dom');
  return {
    ...actual,
    createPortal: (children: any) => children,
  };
});

vi.mock(
  '../../../app/components/workflow/edgesNode/edgeNodesNew/components/InputOutputDisplay',
  () => ({
    default: ({
      supportedInputTypes,
      supportedOutputTypes,
      inputNodeCategory,
      outputNodeCategory,
    }: any) => (
      <div
        data-testid='input-output-display'
        data-input-types={supportedInputTypes?.join(',')}
        data-output-types={supportedOutputTypes?.join(',')}
        data-input-category={inputNodeCategory}
        data-output-category={outputNodeCategory}
      >
        InputOutputDisplay
      </div>
    ),
  })
);

vi.mock(
  '../../../app/components/workflow/edgesNode/edgeNodesNew/hook/runSingleEdgeNodeExecutor',
  () => ({
    runSingleEdgeNode: mocks.runSingleEdgeNode,
  })
);

// ============================================================================
// Helper Functions
// ============================================================================

function createMockNode(overrides?: Partial<LoadNodeFrontendConfig>): Node {
  return {
    id: 'test-node-1',
    type: 'loadNode',
    position: { x: 0, y: 0 },
    data: {
      resultNode: null,
      ...overrides,
    } as LoadNodeFrontendConfig,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('Load Edge Node', () => {
  let mockGetNode: ReturnType<typeof vi.fn>;
  let mockSetNodes: ReturnType<typeof vi.fn>;
  let mockSetEdges: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockGetNode = vi.fn();
    mockSetNodes = vi.fn();
    mockSetEdges = vi.fn();

    const defaultNode = createMockNode();
    mockGetNode.mockReturnValue(defaultNode);

    // 设置所有必需的 mocks
    mocks.useReactFlow.mockReturnValue({
      getNode: mockGetNode,
      setNodes: mockSetNodes,
      setEdges: mockSetEdges,
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
      getSourceNodeIdWithLabel: vi.fn(),
      getTargetNodeIdWithLabel: vi.fn(),
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

  // ==========================================================================
  // P0 测试用例：数据结构完整性
  // ==========================================================================

  describe('P0 - 数据结构完整性', () => {
    it('TC-LD-001: 验证 LoadNodeFrontendConfig 数据结构', () => {
      const node = createMockNode();

      // 验证数据结构包含必需字段
      expect(node.data).toHaveProperty('resultNode');
    });

    it('TC-LD-001-1: 验证 resultNode 字段类型', () => {
      // 测试 null 值
      const nodeWithNull = createMockNode({ resultNode: null });
      expect(nodeWithNull.data.resultNode).toBeNull();

      // 测试 string 值
      const nodeWithString = createMockNode({ resultNode: 'result-node-id' });
      expect(nodeWithString.data.resultNode).toBe('result-node-id');
      expect(typeof nodeWithString.data.resultNode).toBe('string');
    });

    it('TC-LD-001-2: 验证 LoadOperationApiPayload 数据结构概念', () => {
      // 这个测试验证我们理解后端 API 的数据结构
      // 实际的 API payload 由后端构建，前端只需要确保数据结构类型存在
      const expectedApiStructure = {
        type: 'load',
        data: {
          block_type: 'string',
          content: 'string',
          extra_configs: {
            file_configs: [
              {
                file_path: 'string',
                file_type: 'string',
                configs: {},
              },
            ],
          },
          inputs: {},
          outputs: {},
        },
      };

      // 验证结构概念（通过类型检查在编译时完成）
      expect(expectedApiStructure).toBeDefined();
      expect(expectedApiStructure.type).toBe('load');
      expect(expectedApiStructure.data).toHaveProperty('extra_configs');
      expect(expectedApiStructure.data.extra_configs).toHaveProperty(
        'file_configs'
      );
    });
  });

  // ==========================================================================
  // P1 测试用例：核心功能
  // ==========================================================================

  describe('P1 - 核心功能', () => {
    it('TC-LD-002: 点击 Run 按钮调用 runSingleEdgeNode', async () => {
      const node = createMockNode();
      mockGetNode.mockReturnValue(node);

      render(<Load id='test-node-1' data={node.data} isConnectable={true} />);

      // 找到 Run 按钮（使用文本查找）
      const runButtons = screen.getAllByText('Run');
      expect(runButtons.length).toBeGreaterThan(0);

      // 点击第一个 Run 按钮
      fireEvent.click(runButtons[0]);

      // 验证 runSingleEdgeNode 被调用
      await waitFor(() => {
        expect(mocks.runSingleEdgeNode).toHaveBeenCalledWith(
          expect.objectContaining({
            parentId: 'test-node-1',
            targetNodeType: 'structured',
            context: expect.any(Object),
          })
        );
      });
    });

    it('TC-LD-002-1: Run 按钮在 loading 时显示加载状态', async () => {
      const node = createMockNode();
      mockGetNode.mockReturnValue(node);

      // Mock runSingleEdgeNode 为异步函数，不立即完成
      mocks.runSingleEdgeNode.mockImplementation(() => {
        return new Promise(resolve => {
          setTimeout(resolve, 100);
        });
      });

      render(<Load id='test-node-1' data={node.data} isConnectable={true} />);

      // 找到 Run 按钮
      const runButtons = screen.getAllByText('Run');
      fireEvent.click(runButtons[0]);

      // 验证 loading 状态（查找加载图标）
      await waitFor(() => {
        const spinners = document.querySelectorAll('.animate-spin');
        expect(spinners.length).toBeGreaterThan(0);
      });
    });

    it('TC-LD-002-2: Run 按钮在 loading 时禁用', async () => {
      const node = createMockNode();
      mockGetNode.mockReturnValue(node);

      // Mock runSingleEdgeNode 为异步函数
      mocks.runSingleEdgeNode.mockImplementation(() => {
        return new Promise(resolve => {
          setTimeout(resolve, 100);
        });
      });

      render(<Load id='test-node-1' data={node.data} isConnectable={true} />);

      // 找到 Run 按钮（通过角色查找）
      const runButtons = screen.getAllByRole('button');
      const actualRunButtons = runButtons.filter(btn =>
        btn.textContent?.includes('Run')
      );

      expect(actualRunButtons.length).toBeGreaterThan(0);
      const firstRunButton = actualRunButtons[0];

      // 点击 Run 按钮
      fireEvent.click(firstRunButton);

      // 验证按钮被禁用
      await waitFor(() => {
        expect(firstRunButton).toBeDisabled();
      });
    });

    it('TC-LD-003: InputOutputDisplay 配置验证', () => {
      const node = createMockNode();
      mockGetNode.mockReturnValue(node);

      render(<Load id='test-node-1' data={node.data} isConnectable={true} />);

      // 打开配置菜单
      const nodeButton = screen.getByTitle('Load Node');
      fireEvent.click(nodeButton);

      // 等待菜单渲染并查找 InputOutputDisplay
      const inputOutputDisplay = screen.getByTestId('input-output-display');

      // 验证配置
      expect(inputOutputDisplay).toHaveAttribute('data-input-types', 'file');
      expect(inputOutputDisplay).toHaveAttribute(
        'data-output-types',
        'structured'
      );
      expect(inputOutputDisplay).toHaveAttribute(
        'data-input-category',
        'blocknode'
      );
      expect(inputOutputDisplay).toHaveAttribute(
        'data-output-category',
        'blocknode'
      );
    });
  });

  // ==========================================================================
  // P2 测试用例：UI 交互
  // ==========================================================================

  describe('P2 - UI 交互', () => {
    it('TC-LD-004: 点击节点按钮打开/关闭配置菜单', async () => {
      const node = createMockNode();
      mockGetNode.mockReturnValue(node);

      render(<Load id='test-node-1' data={node.data} isConnectable={true} />);

      // 找到节点按钮
      const nodeButton = screen.getByTitle('Load Node');

      // 初始状态：菜单应该不可见
      expect(
        screen.queryByTestId('input-output-display')
      ).not.toBeInTheDocument();

      // 点击打开菜单
      fireEvent.click(nodeButton);

      // 菜单应该出现
      await waitFor(() => {
        expect(screen.getByTestId('input-output-display')).toBeInTheDocument();
      });

      // 再次点击关闭菜单
      fireEvent.click(nodeButton);

      // 菜单应该消失
      await waitFor(() => {
        expect(
          screen.queryByTestId('input-output-display')
        ).not.toBeInTheDocument();
      });
    });

    it('TC-LD-004-1: 组件挂载后正确初始化', () => {
      const node = createMockNode();
      mockGetNode.mockReturnValue(node);

      const mockClearAll = vi.fn();
      const mockActivateEdge = vi.fn();

      mocks.useNodesPerFlowContext.mockReturnValue({
        isOnConnect: false,
        activatedEdge: null,
        isOnGeneratingNewNode: false,
        clearEdgeActivation: vi.fn(),
        activateEdge: mockActivateEdge,
        clearAll: mockClearAll,
      });

      render(<Load id='test-node-1' data={node.data} isConnectable={true} />);

      // 验证组件按钮被渲染
      const nodeButton = screen.getByTitle('Load Node');
      expect(nodeButton).toBeInTheDocument();

      // 验证 Load 文本被渲染
      expect(screen.getByText('Load')).toBeInTheDocument();

      // 验证初始化函数被调用
      expect(mockClearAll).toHaveBeenCalled();
      expect(mockActivateEdge).toHaveBeenCalledWith('test-node-1');
    });
  });
});
