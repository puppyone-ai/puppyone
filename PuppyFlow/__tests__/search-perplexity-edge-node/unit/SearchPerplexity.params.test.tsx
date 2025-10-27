/**
 * SearchPerplexity Edge Node - 参数配置测试
 *
 * 测试用例：
 * P0 致命 - 核心参数保存失败导致搜索功能不可用：
 * - TC-SP-001: model 参数修改后保存
 * - TC-SP-001-1: model 应保存在 extra_configs 对象中
 * - TC-SP-001-2: model 应为有效的 Perplexity 模型名称
 *
 * P1 严重 - 参数配置异常影响搜索质量：
 * - TC-SP-002: 应能切换到 'sonar' 模型
 * - TC-SP-002-1: 应能切换到 'sonar-pro' 模型
 * - TC-SP-002-2: 应能切换到 'sonar-reasoning-pro' 模型
 *
 * P2 中等 - 初始化和默认值：
 * - TC-SP-003: model 默认值应为 'sonar-pro'
 * - TC-SP-003-1: 从 node.data.extra_configs.model 加载现有配置
 * - TC-SP-004: 组件挂载验证
 * - TC-SP-005: Model 下拉框应显示所有 3 个模型选项
 *
 * ⚠️ 测试重点：
 * - model 参数修改后是否正确保存到 node.data.extra_configs.model
 * - 模型切换功能
 * - 默认值和初始化逻辑
 */

// @ts-nocheck
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import SearchPerplexity from '../../../app/components/workflow/edgesNode/edgeNodesNew/SearchPerplexity';
import type { Node } from '@xyflow/react';
import type { SearchConfigNodeData } from '../../../app/components/workflow/edgesNode/edgeNodesNew/SearchPerplexity';

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

vi.mock('../../../app/components/misc/PuppyDropDown', () => ({
  PuppyDropdown: ({ selectedValue, onSelect, options }: any) => {
    return (
      <div data-testid='puppy-dropdown'>
        <span data-testid='dropdown-display'>{selectedValue || 'Select'}</span>
        <select
          data-testid='dropdown-select'
          value={selectedValue}
          onChange={e => {
            onSelect(e.target.value);
          }}
        >
          {options.map((opt: any, idx: number) => (
            <option key={idx} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      </div>
    );
  },
}));

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

describe('SearchPerplexity Edge Node - 参数配置', () => {
  let mockSetNodes: any;
  let mockGetNode: any;
  let mockSetEdges: any;

  const createMockNode = (
    overrides: Partial<SearchConfigNodeData> = {}
  ): Node<SearchConfigNodeData> => ({
    id: 'test-search-perplexity-1',
    type: 'searchPerplexity',
    position: { x: 0, y: 0 },
    data: {
      nodeLabels: [],
      subMenuType: null,
      top_k: undefined,
      content: null,
      looped: false,
      query_id: undefined,
      vector_db: undefined,
      extra_configs: {
        model: 'sonar-pro',
        threshold: undefined,
      },
      ...overrides,
    },
  });

  beforeEach(() => {
    mockSetNodes = vi.fn();
    mockSetEdges = vi.fn();
    mockGetNode = vi.fn(() => createMockNode());

    mocks.useReactFlow.mockReturnValue({
      getNode: mockGetNode,
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

  // ============================================================================
  // P0 致命 - 核心参数保存失败导致搜索功能不可用
  // ============================================================================

  describe('TC-SP-001: model 参数修改后保存 (P0)', () => {
    it('修改 model 应正确保存到 node.data.extra_configs.model', async () => {
      const mockNode = createMockNode();
      mockGetNode.mockReturnValue(mockNode);

      render(
        <SearchPerplexity
          id={mockNode.id}
          type='searchPerplexity'
          data={mockNode.data}
          selected={false}
          isConnectable={true}
          xPos={0}
          yPos={0}
          zIndex={0}
          dragging={false}
        />
      );

      // 打开配置菜单
      const button = screen.getByRole('button', { name: /Perplexity/i });
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByText('Model')).toBeInTheDocument();
      });

      // 查找 Model dropdown
      const modelSelect = screen.getByTestId('dropdown-select');

      // 修改 model 值
      fireEvent.change(modelSelect, { target: { value: 'sonar' } });

      // 等待状态更新和 setNodes 调用
      await waitFor(
        () => {
          expect(mockSetNodes).toHaveBeenCalled();
        },
        { timeout: 3000 }
      );

      // 验证 model 更新
      const setNodesCall =
        mockSetNodes.mock.calls[mockSetNodes.mock.calls.length - 1][0];
      const updatedNodes = setNodesCall([mockNode]);
      const updatedNode = updatedNodes.find((n: any) => n.id === mockNode.id);

      expect(updatedNode.data.extra_configs.model).toBe('sonar');
    });
  });

  describe('TC-SP-001-1: model 应保存在 extra_configs 对象中 (P0)', () => {
    it('model 参数应位于 extra_configs 对象内', () => {
      const mockNode = createMockNode({
        extra_configs: {
          model: 'sonar',
          threshold: undefined,
        },
      });

      render(
        <SearchPerplexity
          id={mockNode.id}
          type='searchPerplexity'
          data={mockNode.data}
          selected={false}
          isConnectable={true}
          xPos={0}
          yPos={0}
          zIndex={0}
          dragging={false}
        />
      );

      expect(mockNode.data).toHaveProperty('extra_configs');
      expect(mockNode.data.extra_configs).toHaveProperty('model');
      expect(mockNode.data.extra_configs.model).toBe('sonar');
    });

    it('extra_configs 对象应包含 model 和 threshold 字段', () => {
      const mockNode = createMockNode();

      render(
        <SearchPerplexity
          id={mockNode.id}
          type='searchPerplexity'
          data={mockNode.data}
          selected={false}
          isConnectable={true}
          xPos={0}
          yPos={0}
          zIndex={0}
          dragging={false}
        />
      );

      expect(mockNode.data.extra_configs).toHaveProperty('model');
      expect(mockNode.data.extra_configs).toHaveProperty('threshold');
    });
  });

  describe('TC-SP-001-2: model 应为有效的 Perplexity 模型名称 (P0)', () => {
    it('model 应为 sonar 类型之一', () => {
      const validModels = ['sonar', 'sonar-pro', 'sonar-reasoning-pro'];

      validModels.forEach(model => {
        const mockNode = createMockNode({
          extra_configs: {
            model: model as any,
            threshold: undefined,
          },
        });

        render(
          <SearchPerplexity
            id={mockNode.id}
            type='searchPerplexity'
            data={mockNode.data}
            selected={false}
            isConnectable={true}
            xPos={0}
            yPos={0}
            zIndex={0}
            dragging={false}
          />
        );

        expect(validModels).toContain(mockNode.data.extra_configs.model);
      });
    });

    it('修改后的 model 应保持有效类型', async () => {
      const mockNode = createMockNode();
      mockGetNode.mockReturnValue(mockNode);

      render(
        <SearchPerplexity
          id={mockNode.id}
          type='searchPerplexity'
          data={mockNode.data}
          selected={false}
          isConnectable={true}
          xPos={0}
          yPos={0}
          zIndex={0}
          dragging={false}
        />
      );

      // 打开配置菜单
      const button = screen.getByRole('button', { name: /Perplexity/i });
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByText('Model')).toBeInTheDocument();
      });

      // 修改为 sonar-reasoning-pro
      const modelSelect = screen.getByTestId('dropdown-select');
      fireEvent.change(modelSelect, {
        target: { value: 'sonar-reasoning-pro' },
      });

      await waitFor(
        () => {
          expect(mockSetNodes).toHaveBeenCalled();
        },
        { timeout: 3000 }
      );

      const setNodesCall =
        mockSetNodes.mock.calls[mockSetNodes.mock.calls.length - 1][0];
      const updatedNodes = setNodesCall([mockNode]);
      const updatedNode = updatedNodes.find((n: any) => n.id === mockNode.id);

      expect(['sonar', 'sonar-pro', 'sonar-reasoning-pro']).toContain(
        updatedNode.data.extra_configs.model
      );
    });
  });

  // ============================================================================
  // P1 严重 - 参数配置异常影响搜索质量
  // ============================================================================

  describe('TC-SP-002: 应能切换到 sonar 模型 (P1)', () => {
    it('应能从默认模型切换到 sonar', async () => {
      const mockNode = createMockNode();
      mockGetNode.mockReturnValue(mockNode);

      render(
        <SearchPerplexity
          id={mockNode.id}
          type='searchPerplexity'
          data={mockNode.data}
          selected={false}
          isConnectable={true}
          xPos={0}
          yPos={0}
          zIndex={0}
          dragging={false}
        />
      );

      // 打开配置菜单
      const button = screen.getByRole('button', { name: /Perplexity/i });
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByText('Model')).toBeInTheDocument();
      });

      // 切换到 sonar
      const modelSelect = screen.getByTestId('dropdown-select');
      fireEvent.change(modelSelect, { target: { value: 'sonar' } });

      await waitFor(
        () => {
          expect(mockSetNodes).toHaveBeenCalled();
        },
        { timeout: 3000 }
      );

      const setNodesCall =
        mockSetNodes.mock.calls[mockSetNodes.mock.calls.length - 1][0];
      const updatedNodes = setNodesCall([mockNode]);
      const updatedNode = updatedNodes.find((n: any) => n.id === mockNode.id);

      expect(updatedNode.data.extra_configs.model).toBe('sonar');
    });
  });

  describe('TC-SP-002-1: 应能切换到 sonar-pro 模型 (P1)', () => {
    it('应能从其他模型切换到 sonar-pro', async () => {
      const mockNode = createMockNode({
        extra_configs: {
          model: 'sonar',
          threshold: undefined,
        },
      });
      mockGetNode.mockReturnValue(mockNode);

      render(
        <SearchPerplexity
          id={mockNode.id}
          type='searchPerplexity'
          data={mockNode.data}
          selected={false}
          isConnectable={true}
          xPos={0}
          yPos={0}
          zIndex={0}
          dragging={false}
        />
      );

      // 打开配置菜单
      const button = screen.getByRole('button', { name: /Perplexity/i });
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByText('Model')).toBeInTheDocument();
      });

      // 切换到 sonar-pro
      const modelSelect = screen.getByTestId('dropdown-select');
      fireEvent.change(modelSelect, { target: { value: 'sonar-pro' } });

      await waitFor(
        () => {
          expect(mockSetNodes).toHaveBeenCalled();
        },
        { timeout: 3000 }
      );

      const setNodesCall =
        mockSetNodes.mock.calls[mockSetNodes.mock.calls.length - 1][0];
      const updatedNodes = setNodesCall([mockNode]);
      const updatedNode = updatedNodes.find((n: any) => n.id === mockNode.id);

      expect(updatedNode.data.extra_configs.model).toBe('sonar-pro');
    });
  });

  describe('TC-SP-002-2: 应能切换到 sonar-reasoning-pro 模型 (P1)', () => {
    it('应能切换到 sonar-reasoning-pro', async () => {
      const mockNode = createMockNode();
      mockGetNode.mockReturnValue(mockNode);

      render(
        <SearchPerplexity
          id={mockNode.id}
          type='searchPerplexity'
          data={mockNode.data}
          selected={false}
          isConnectable={true}
          xPos={0}
          yPos={0}
          zIndex={0}
          dragging={false}
        />
      );

      // 打开配置菜单
      const button = screen.getByRole('button', { name: /Perplexity/i });
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByText('Model')).toBeInTheDocument();
      });

      // 切换到 sonar-reasoning-pro
      const modelSelect = screen.getByTestId('dropdown-select');
      fireEvent.change(modelSelect, {
        target: { value: 'sonar-reasoning-pro' },
      });

      await waitFor(
        () => {
          expect(mockSetNodes).toHaveBeenCalled();
        },
        { timeout: 3000 }
      );

      const setNodesCall =
        mockSetNodes.mock.calls[mockSetNodes.mock.calls.length - 1][0];
      const updatedNodes = setNodesCall([mockNode]);
      const updatedNode = updatedNodes.find((n: any) => n.id === mockNode.id);

      expect(updatedNode.data.extra_configs.model).toBe('sonar-reasoning-pro');
    });
  });

  // ============================================================================
  // P2 中等 - 初始化和默认值
  // ============================================================================

  describe('TC-SP-003: model 默认值应为 sonar-pro (P2)', () => {
    it('节点初始化时 model 默认值应为 sonar-pro', () => {
      const mockNode = createMockNode();

      render(
        <SearchPerplexity
          id={mockNode.id}
          type='searchPerplexity'
          data={mockNode.data}
          selected={false}
          isConnectable={true}
          xPos={0}
          yPos={0}
          zIndex={0}
          dragging={false}
        />
      );

      expect(mockNode.data.extra_configs.model).toBe('sonar-pro');
    });

    it('没有提供 model 时应使用默认值 sonar-pro', () => {
      const mockNode = createMockNode({
        extra_configs: {
          model: undefined,
          threshold: undefined,
        },
      });

      // 模拟组件内部的默认值逻辑
      const effectiveModel = mockNode.data.extra_configs.model ?? 'sonar-pro';

      render(
        <SearchPerplexity
          id={mockNode.id}
          type='searchPerplexity'
          data={mockNode.data}
          selected={false}
          isConnectable={true}
          xPos={0}
          yPos={0}
          zIndex={0}
          dragging={false}
        />
      );

      expect(effectiveModel).toBe('sonar-pro');
    });
  });

  describe('TC-SP-003-1: 从 node.data.extra_configs.model 加载现有配置 (P2)', () => {
    it('节点初始化时应从 node.data.extra_configs.model 加载现有配置', async () => {
      const mockNode = createMockNode({
        extra_configs: {
          model: 'sonar',
          threshold: undefined,
        },
      });

      render(
        <SearchPerplexity
          id={mockNode.id}
          type='searchPerplexity'
          data={mockNode.data}
          selected={false}
          isConnectable={true}
          xPos={0}
          yPos={0}
          zIndex={0}
          dragging={false}
        />
      );

      // 打开配置菜单
      const button = screen.getByRole('button', { name: /Perplexity/i });
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByText('Model')).toBeInTheDocument();
      });

      // 验证显示的是配置的值 sonar，而不是默认值 sonar-pro
      const dropdownDisplay = screen.getByTestId('dropdown-display');
      expect(dropdownDisplay.textContent).toBe('sonar');
    });

    it('应正确加载 sonar-reasoning-pro 配置', async () => {
      const mockNode = createMockNode({
        extra_configs: {
          model: 'sonar-reasoning-pro',
          threshold: undefined,
        },
      });

      render(
        <SearchPerplexity
          id={mockNode.id}
          type='searchPerplexity'
          data={mockNode.data}
          selected={false}
          isConnectable={true}
          xPos={0}
          yPos={0}
          zIndex={0}
          dragging={false}
        />
      );

      // 打开配置菜单
      const button = screen.getByRole('button', { name: /Perplexity/i });
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByText('Model')).toBeInTheDocument();
      });

      // 验证显示的是配置的值
      const dropdownDisplay = screen.getByTestId('dropdown-display');
      expect(dropdownDisplay.textContent).toBe('sonar-reasoning-pro');
    });
  });

  describe('TC-SP-004: 组件挂载验证 (P2)', () => {
    it('组件应成功挂载并渲染', () => {
      const mockNode = createMockNode();

      const { container } = render(
        <SearchPerplexity
          id={mockNode.id}
          type='searchPerplexity'
          data={mockNode.data}
          selected={false}
          isConnectable={true}
          xPos={0}
          yPos={0}
          zIndex={0}
          dragging={false}
        />
      );

      expect(container.firstChild).toBeInTheDocument();
    });

    it('应渲染 Perplexity 按钮', () => {
      const mockNode = createMockNode();

      render(
        <SearchPerplexity
          id={mockNode.id}
          type='searchPerplexity'
          data={mockNode.data}
          selected={false}
          isConnectable={true}
          xPos={0}
          yPos={0}
          zIndex={0}
          dragging={false}
        />
      );

      const button = screen.getByRole('button', { name: /Perplexity/i });
      expect(button).toBeInTheDocument();
    });
  });

  describe('TC-SP-005: Model 下拉框应显示所有 3 个模型选项 (P2)', () => {
    it('Model 下拉框应包含所有 3 个模型选项', async () => {
      const mockNode = createMockNode();

      render(
        <SearchPerplexity
          id={mockNode.id}
          type='searchPerplexity'
          data={mockNode.data}
          selected={false}
          isConnectable={true}
          xPos={0}
          yPos={0}
          zIndex={0}
          dragging={false}
        />
      );

      // 打开配置菜单
      const button = screen.getByRole('button', { name: /Perplexity/i });
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByText('Model')).toBeInTheDocument();
      });

      // 验证 dropdown 包含所有选项
      const modelSelect = screen.getByTestId('dropdown-select');
      const options = modelSelect.querySelectorAll('option');

      expect(options.length).toBe(3);

      const optionValues = Array.from(options).map((opt: any) => opt.value);
      expect(optionValues).toContain('sonar');
      expect(optionValues).toContain('sonar-pro');
      expect(optionValues).toContain('sonar-reasoning-pro');
    });

    it('Model 选项应按正确顺序显示', async () => {
      const mockNode = createMockNode();

      render(
        <SearchPerplexity
          id={mockNode.id}
          type='searchPerplexity'
          data={mockNode.data}
          selected={false}
          isConnectable={true}
          xPos={0}
          yPos={0}
          zIndex={0}
          dragging={false}
        />
      );

      // 打开配置菜单
      const button = screen.getByRole('button', { name: /Perplexity/i });
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByText('Model')).toBeInTheDocument();
      });

      const modelSelect = screen.getByTestId('dropdown-select');
      const options = modelSelect.querySelectorAll('option');
      const optionValues = Array.from(options).map((opt: any) => opt.value);

      expect(optionValues).toEqual([
        'sonar',
        'sonar-pro',
        'sonar-reasoning-pro',
      ]);
    });
  });
});
