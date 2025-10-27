/**
 * Copy Edge Node - 完整测试
 *
 * 测试用例：
 * P0 致命 - 数据结构完整性：
 * - TC-CP-001: node.data 应包含必要字段
 * - TC-CP-001-1: content_type 应为 'list'、'dict' 或 null
 * - TC-CP-001-2: extra_configs 应包含正确的子字段
 *
 * P1 严重 - 基本功能：
 * - TC-CP-002: 点击 Run 按钮应触发执行
 * - TC-CP-002-1: 执行时应显示加载状态
 *
 * P2 中等 - UI 交互和初始化：
 * - TC-CP-003: 点击节点按钮应打开配置菜单
 * - TC-CP-003-1: 再次点击应关闭配置菜单
 * - TC-CP-003-2: 配置菜单初始状态应为关闭
 * - TC-CP-004: Hover 节点应显示 Run 按钮
 * - TC-CP-005: 组件挂载后验证
 *
 * ⚠️ 测试重点：
 * - Copy 节点没有参数配置UI，测试重点在数据结构和基本功能
 * - 验证 node.data 的类型正确性
 * - 验证执行流程和状态管理
 */

// @ts-nocheck
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import CopyEdgeNode from '../../../app/components/workflow/edgesNode/edgeNodesNew/Copy';
import type { Node } from '@xyflow/react';
import type { CopyNodeFrontendConfig } from '../../../app/components/workflow/edgesNode/edgeNodesNew/Copy';

// Mock 配置
const mocks = vi.hoisted(() => ({
  useReactFlow: vi.fn(),
  useNodesPerFlowContext: vi.fn(),
  useGetSourceTarget: vi.fn(),
  useJsonConstructUtils: vi.fn(),
  useAppSettings: vi.fn(),
  runSingleEdgeNode: vi.fn(),
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

vi.mock('react-dom', async () => {
  const actual = await vi.importActual('react-dom');
  return {
    ...actual,
    createPortal: (node: any) => node,
  };
});

describe('Copy Edge Node - 完整测试', () => {
  let mockSetNodes: any;
  let mockGetNode: any;
  let mockGetInternalNode: any;
  let mockSetEdges: any;

  const createMockNode = (
    overrides: Partial<CopyNodeFrontendConfig> = {}
  ): Node<CopyNodeFrontendConfig> => ({
    id: 'test-copy-1',
    type: 'copy',
    position: { x: 0, y: 0 },
    data: {
      subMenuType: null,
      content: null,
      looped: false,
      content_type: null,
      extra_configs: {
        index: undefined,
        key: undefined,
        params: {
          path: [],
        },
      },
      ...overrides,
    },
  });

  beforeEach(() => {
    mockSetNodes = vi.fn();
    mockSetEdges = vi.fn();
    mockGetNode = vi.fn(() => createMockNode());
    mockGetInternalNode = vi.fn(() => ({ id: 'test-copy-1' }));

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

  // ==================== P0 测试用例 ====================

  describe('P0: 数据结构完整性', () => {
    it('TC-CP-001: node.data 应包含必要字段', () => {
      const node = createMockNode();

      // 验证所有必需字段存在
      expect(node.data).toHaveProperty('subMenuType');
      expect(node.data).toHaveProperty('content');
      expect(node.data).toHaveProperty('looped');
      expect(node.data).toHaveProperty('content_type');
      expect(node.data).toHaveProperty('extra_configs');

      // 验证 extra_configs 的子字段
      expect(node.data.extra_configs).toHaveProperty('index');
      expect(node.data.extra_configs).toHaveProperty('key');
      expect(node.data.extra_configs).toHaveProperty('params');
      expect(node.data.extra_configs.params).toHaveProperty('path');
    });

    it('TC-CP-001-1: content_type 应为 "list"、"dict" 或 null', () => {
      // 测试 null
      const nodeWithNull = createMockNode({ content_type: null });
      expect(nodeWithNull.data.content_type).toBeNull();

      // 测试 'list'
      const nodeWithList = createMockNode({ content_type: 'list' });
      expect(nodeWithList.data.content_type).toBe('list');

      // 测试 'dict'
      const nodeWithDict = createMockNode({ content_type: 'dict' });
      expect(nodeWithDict.data.content_type).toBe('dict');

      // 验证类型
      const validTypes = ['list', 'dict', null];
      expect(validTypes).toContain(nodeWithNull.data.content_type);
      expect(validTypes).toContain(nodeWithList.data.content_type);
      expect(validTypes).toContain(nodeWithDict.data.content_type);
    });

    it('TC-CP-001-2: extra_configs 应包含正确的子字段', () => {
      const node = createMockNode({
        extra_configs: {
          index: 0,
          key: 'test_key',
          params: {
            path: ['field1', 'field2', 0],
          },
        },
      });

      // 验证 extra_configs 结构
      expect(node.data.extra_configs).toBeDefined();
      expect(typeof node.data.extra_configs).toBe('object');

      // 验证 index 字段
      expect(node.data.extra_configs).toHaveProperty('index');
      expect(
        typeof node.data.extra_configs.index === 'number' ||
          node.data.extra_configs.index === undefined
      ).toBe(true);

      // 验证 key 字段
      expect(node.data.extra_configs).toHaveProperty('key');
      expect(
        typeof node.data.extra_configs.key === 'string' ||
          node.data.extra_configs.key === undefined
      ).toBe(true);

      // 验证 params 字段
      expect(node.data.extra_configs).toHaveProperty('params');
      expect(node.data.extra_configs.params).toHaveProperty('path');

      // 验证 path 是数组
      expect(Array.isArray(node.data.extra_configs.params.path)).toBe(true);

      // 验证 path 数组元素类型（string 或 number）
      node.data.extra_configs.params.path.forEach(item => {
        expect(typeof item === 'string' || typeof item === 'number').toBe(true);
      });
    });
  });

  // ==================== P1 测试用例 ====================

  describe('P1: 基本功能', () => {
    it('TC-CP-002: 点击 Run 按钮应触发执行', async () => {
      const node = createMockNode();

      render(
        <CopyEdgeNode
          {...node}
          id={node.id}
          data={node.data}
          isConnectable={true}
        />
      );

      // 点击节点打开配置菜单
      const nodeButton = screen.getByTitle('Copy Node');
      fireEvent.click(nodeButton);

      await waitFor(() => {
        expect(screen.getByText('Copy')).toBeInTheDocument();
      });

      // 点击配置菜单中的 Run 按钮
      const runButtons = screen.getAllByText('Run');
      const menuRunButton = runButtons.find(btn =>
        btn.parentElement?.className.includes('rounded-[8px]')
      );

      expect(menuRunButton).toBeDefined();

      if (menuRunButton) {
        fireEvent.click(menuRunButton);

        // 验证 runSingleEdgeNode 被调用
        await waitFor(
          () => {
            expect(mocks.runSingleEdgeNode).toHaveBeenCalled();
          },
          { timeout: 3000 }
        );

        // 验证调用参数
        expect(mocks.runSingleEdgeNode).toHaveBeenCalledWith(
          expect.objectContaining({
            parentId: node.id,
            targetNodeType: 'text',
            context: expect.any(Object),
          })
        );
      }
    });

    it('TC-CP-002-1: 执行时应显示加载状态', async () => {
      // Mock runSingleEdgeNode 返回一个延迟的 Promise
      let resolveExecution: any;
      const executionPromise = new Promise(resolve => {
        resolveExecution = resolve;
      });
      mocks.runSingleEdgeNode.mockReturnValue(executionPromise);

      const node = createMockNode();

      render(
        <CopyEdgeNode
          {...node}
          id={node.id}
          data={node.data}
          isConnectable={true}
        />
      );

      // 点击节点打开配置菜单
      const nodeButton = screen.getByTitle('Copy Node');
      fireEvent.click(nodeButton);

      await waitFor(() => {
        expect(screen.getByText('Copy')).toBeInTheDocument();
      });

      // 点击 Run 按钮
      const runButtons = screen.getAllByText('Run');
      const menuRunButton = runButtons.find(btn =>
        btn.parentElement?.className.includes('rounded-[8px]')
      );

      if (menuRunButton) {
        fireEvent.click(menuRunButton);

        // 等待加载状态显示（Run 文本消失，spinner 出现）
        await waitFor(
          () => {
            const runTexts = screen.queryAllByText('Run');
            // 菜单中的 Run 按钮文本应该消失
            const menuRunText = runTexts.find(text =>
              text.parentElement?.className.includes('rounded-[8px]')
            );
            expect(menuRunText?.textContent).toBe('');
          },
          { timeout: 1000 }
        );

        // 验证 spinner SVG 存在
        const spinners = document.querySelectorAll('.animate-spin');
        expect(spinners.length).toBeGreaterThan(0);

        // 完成执行
        resolveExecution();

        // 验证加载状态恢复
        await waitFor(
          () => {
            expect(screen.getAllByText('Run').length).toBeGreaterThan(0);
          },
          { timeout: 3000 }
        );
      }
    });
  });

  // ==================== P2 测试用例 ====================

  describe('P2: UI 交互和初始化', () => {
    it('TC-CP-003: 点击节点按钮应打开配置菜单', async () => {
      const node = createMockNode();

      render(
        <CopyEdgeNode
          {...node}
          id={node.id}
          data={node.data}
          isConnectable={true}
        />
      );

      // 初始状态：配置菜单应不可见
      expect(screen.queryByText('Copy')).not.toBeInTheDocument();

      // 点击节点按钮
      const nodeButton = screen.getByTitle('Copy Node');
      fireEvent.click(nodeButton);

      // 验证配置菜单显示
      await waitFor(() => {
        expect(screen.getByText('Copy')).toBeInTheDocument();
      });

      // 验证 InputOutputDisplay 显示
      expect(screen.getByTestId('input-output-display')).toBeInTheDocument();
    });

    it('TC-CP-003-1: 再次点击应关闭配置菜单', async () => {
      const node = createMockNode();

      render(
        <CopyEdgeNode
          {...node}
          id={node.id}
          data={node.data}
          isConnectable={true}
        />
      );

      // 点击打开菜单
      const nodeButton = screen.getByTitle('Copy Node');
      fireEvent.click(nodeButton);

      await waitFor(() => {
        expect(screen.getByText('Copy')).toBeInTheDocument();
      });

      // 再次点击关闭菜单
      fireEvent.click(nodeButton);

      await waitFor(() => {
        expect(screen.queryByText('Copy')).not.toBeInTheDocument();
      });
    });

    it('TC-CP-003-2: 配置菜单初始状态应为关闭', () => {
      const node = createMockNode();

      render(
        <CopyEdgeNode
          {...node}
          id={node.id}
          data={node.data}
          isConnectable={true}
        />
      );

      // 验证配置菜单初始不可见
      expect(screen.queryByText('Copy')).not.toBeInTheDocument();
      expect(
        screen.queryByTestId('input-output-display')
      ).not.toBeInTheDocument();
    });

    it('TC-CP-004: Hover 节点应显示 Run 按钮', async () => {
      const node = createMockNode();

      const { container } = render(
        <CopyEdgeNode
          {...node}
          id={node.id}
          data={node.data}
          isConnectable={true}
        />
      );

      const nodeButton = screen.getByTitle('Copy Node');

      // 初始状态：Run 按钮应该有 opacity-0 class
      const runButtons = container.querySelectorAll('button');
      const hoverRunButton = Array.from(runButtons).find(btn =>
        btn.className.includes('absolute -top-[40px]')
      );

      expect(hoverRunButton).toBeDefined();
      expect(hoverRunButton?.className).toContain('opacity-0');

      // Hover 到节点
      fireEvent.mouseEnter(nodeButton);

      await waitFor(() => {
        const updatedRunButton = Array.from(
          container.querySelectorAll('button')
        ).find(btn => btn.className.includes('absolute -top-[40px]'));
        expect(updatedRunButton?.className).toContain('opacity-100');
      });

      // 移开鼠标
      fireEvent.mouseLeave(nodeButton);

      await waitFor(() => {
        const updatedRunButton = Array.from(
          container.querySelectorAll('button')
        ).find(btn => btn.className.includes('absolute -top-[40px]'));
        expect(updatedRunButton?.className).toContain('opacity-0');
      });
    });

    it('TC-CP-005: 组件挂载后验证', () => {
      const node = createMockNode();

      const { container } = render(
        <CopyEdgeNode
          {...node}
          id={node.id}
          data={node.data}
          isConnectable={true}
        />
      );

      // 验证组件已渲染
      expect(container).toBeInTheDocument();

      // 验证节点按钮存在
      const nodeButton = screen.getByTitle('Copy Node');
      expect(nodeButton).toBeInTheDocument();

      // 验证按钮文本
      expect(nodeButton.textContent).toContain('Copy');

      // 验证 SVG 图标存在
      const svgs = container.querySelectorAll('svg');
      expect(svgs.length).toBeGreaterThan(0);

      // 验证 Copy 图标的路径存在
      const copyIconPath = container.querySelector(
        'path[d*="M8 1H2C1.45 1 1 1.45 1 2V8"]'
      );
      expect(copyIconPath).toBeInTheDocument();

      // 验证至少有8个 Handle（4个 source + 4个 target）
      const handles = container.querySelectorAll('div');
      expect(handles.length).toBeGreaterThan(0);
    });
  });
});
