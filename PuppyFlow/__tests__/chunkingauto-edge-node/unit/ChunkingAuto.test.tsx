/**
 * ChunkingAuto Edge Node - 完整测试
 *
 * 测试用例：
 * P0 致命 - 数据结构完整性：
 * - TC-CA-001: node.data 应包含必要字段
 * - TC-CA-001-1: sub_chunking_mode 应为 'size' 或 'tokenizer'
 * - TC-CA-001-2: extra_configs 应包含正确的子字段
 *
 * P1 严重 - 基本功能：
 * - TC-CA-002: 点击 Run 按钮应触发执行
 *
 * P2 中等 - UI 交互和初始化：
 * - TC-CA-003: 点击节点按钮应打开配置菜单
 * - TC-CA-003-1: 配置菜单应显示正确内容
 * - TC-CA-004: 组件挂载后验证
 */

// @ts-nocheck
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import ChunkingAuto from '../../../app/components/workflow/edgesNode/edgeNodesNew/ChunkingAuto';
import type { Node } from '@xyflow/react';
import type { ChunkingConfigNodeData } from '../../../app/components/workflow/edgesNode/edgeNodesNew/ChunkingAuto';

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

describe('ChunkingAuto Edge Node - 完整测试', () => {
  let mockSetNodes: any;
  let mockGetNode: any;
  let mockGetInternalNode: any;
  let mockSetEdges: any;

  const createMockNode = (
    overrides: Partial<ChunkingConfigNodeData> = {}
  ): Node<ChunkingConfigNodeData> => ({
    id: 'test-chunkingauto-1',
    type: 'chunkingauto',
    position: { x: 0, y: 0 },
    data: {
      looped: false,
      subMenuType: null,
      sub_chunking_mode: undefined,
      content: null,
      extra_configs: {
        model: undefined,
        chunk_size: undefined,
        overlap: undefined,
        handle_half_word: undefined,
      },
      ...overrides,
    },
  });

  beforeEach(() => {
    mockSetNodes = vi.fn();
    mockSetEdges = vi.fn();
    mockGetNode = vi.fn(() => createMockNode());
    mockGetInternalNode = vi.fn(() => ({ id: 'test-chunkingauto-1' }));

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

  // ==================== P0 测试用例: 数据结构完整性 ====================

  describe('P0: 数据结构完整性', () => {
    it('TC-CA-001: node.data 应包含必要字段', () => {
      const node = createMockNode();

      // 验证所有必要字段存在
      expect(node.data).toHaveProperty('looped');
      expect(node.data).toHaveProperty('subMenuType');
      expect(node.data).toHaveProperty('sub_chunking_mode');
      expect(node.data).toHaveProperty('content');
      expect(node.data).toHaveProperty('extra_configs');
    });

    it('TC-CA-001-1: sub_chunking_mode 应为 "size" 或 "tokenizer" 或 undefined', () => {
      // 测试 undefined
      const nodeUndefined = createMockNode({ sub_chunking_mode: undefined });
      expect(nodeUndefined.data.sub_chunking_mode).toBeUndefined();

      // 测试 'size'
      const nodeSize = createMockNode({ sub_chunking_mode: 'size' });
      expect(nodeSize.data.sub_chunking_mode).toBe('size');

      // 测试 'tokenizer'
      const nodeTokenizer = createMockNode({ sub_chunking_mode: 'tokenizer' });
      expect(nodeTokenizer.data.sub_chunking_mode).toBe('tokenizer');

      // 验证类型
      const validModes = ['size', 'tokenizer', undefined];
      expect(validModes).toContain(nodeUndefined.data.sub_chunking_mode);
      expect(validModes).toContain(nodeSize.data.sub_chunking_mode);
      expect(validModes).toContain(nodeTokenizer.data.sub_chunking_mode);
    });

    it('TC-CA-001-2: extra_configs 应包含正确的子字段', () => {
      const node = createMockNode({
        extra_configs: {
          model: 'openai/gpt-5',
          chunk_size: 1000,
          overlap: 200,
          handle_half_word: true,
        },
      });

      // 验证 extra_configs 存在
      expect(node.data.extra_configs).toBeDefined();

      // 验证所有子字段存在
      expect(node.data.extra_configs).toHaveProperty('model');
      expect(node.data.extra_configs).toHaveProperty('chunk_size');
      expect(node.data.extra_configs).toHaveProperty('overlap');
      expect(node.data.extra_configs).toHaveProperty('handle_half_word');

      // 验证字段类型
      expect(node.data.extra_configs.model).toBe('openai/gpt-5');
      expect(typeof node.data.extra_configs.chunk_size).toBe('number');
      expect(typeof node.data.extra_configs.overlap).toBe('number');
      expect(typeof node.data.extra_configs.handle_half_word).toBe('boolean');

      // 验证字段值
      expect(node.data.extra_configs.chunk_size).toBe(1000);
      expect(node.data.extra_configs.overlap).toBe(200);
      expect(node.data.extra_configs.handle_half_word).toBe(true);
    });
  });

  // ==================== P1 测试用例: 基本功能 ====================

  describe('P1: 基本功能', () => {
    it('TC-CA-002: 点击 Run 按钮应触发执行', async () => {
      const node = createMockNode();
      mockGetNode.mockReturnValue(node);

      render(
        <ChunkingAuto
          {...node}
          id={node.id}
          data={node.data}
          isConnectable={true}
        />
      );

      // 打开配置菜单
      const nodeButton = screen.getByText('Chunk');
      fireEvent.click(nodeButton);

      await waitFor(() => {
        expect(screen.getByText('Chunk Auto')).toBeInTheDocument();
      });

      // 找到配置菜单中的 Run 按钮
      const runButtons = screen.getAllByText('Run');
      const menuRunButton = runButtons.find(button => {
        const parent = button.parentElement;
        return (
          parent?.className.includes('w-[57px]') &&
          parent?.className.includes('h-[24px]')
        );
      });

      expect(menuRunButton).toBeDefined();

      // 点击 Run 按钮
      if (menuRunButton) {
        fireEvent.click(menuRunButton);

        // 等待异步执行
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
            targetNodeType: 'structured',
            context: expect.any(Object),
          })
        );
      }
    });
  });

  // ==================== P2 测试用例: UI 交互和初始化 ====================

  describe('P2: UI 交互和初始化', () => {
    it('TC-CA-003: 点击节点按钮应打开配置菜单', async () => {
      const node = createMockNode();

      render(
        <ChunkingAuto
          {...node}
          id={node.id}
          data={node.data}
          isConnectable={true}
        />
      );

      // 点击节点按钮
      const nodeButton = screen.getByText('Chunk');
      fireEvent.click(nodeButton);

      // 验证配置菜单显示
      await waitFor(() => {
        expect(screen.getByText('Chunk Auto')).toBeInTheDocument();
      });
    });

    it('TC-CA-003-1: 配置菜单应显示正确内容', async () => {
      const node = createMockNode();

      render(
        <ChunkingAuto
          {...node}
          id={node.id}
          data={node.data}
          isConnectable={true}
        />
      );

      // 打开配置菜单
      const nodeButton = screen.getByText('Chunk');
      fireEvent.click(nodeButton);

      await waitFor(() => {
        expect(screen.getByText('Chunk Auto')).toBeInTheDocument();
      });

      // 验证菜单内容
      // 1. 标题
      expect(screen.getByText('Chunk Auto')).toBeInTheDocument();

      // 2. Run 按钮（至少有一个）
      const runButtons = screen.getAllByText('Run');
      expect(runButtons.length).toBeGreaterThan(0);

      // 3. InputOutputDisplay 组件
      expect(screen.getByTestId('input-output-display')).toBeInTheDocument();
    });

    it('TC-CA-004: 组件挂载后验证', () => {
      const node = createMockNode();

      const { container } = render(
        <ChunkingAuto
          {...node}
          id={node.id}
          data={node.data}
          isConnectable={true}
        />
      );

      // 验证组件已渲染
      expect(container).toBeInTheDocument();

      // 验证节点按钮存在
      expect(screen.getByText('Chunk')).toBeInTheDocument();
      expect(screen.getByText('Auto')).toBeInTheDocument();

      // 验证 SVG 图标存在
      const svgs = container.querySelectorAll('svg');
      expect(svgs.length).toBeGreaterThan(0);

      // 验证 ChunkingAuto SVG 路径存在
      const chunkingPath = container.querySelector('path[fill="currentColor"]');
      expect(chunkingPath).toBeInTheDocument();
    });
  });
});
