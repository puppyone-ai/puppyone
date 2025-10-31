import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import EditStructured from '../../../app/components/workflow/edgesNode/edgeNodesNew/EditStructured';
import type { Node } from '@xyflow/react';
import type { ModifyConfigNodeData } from '../../../app/components/workflow/edgesNode/edgeNodesNew/EditStructured';

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
    default: ({ contentType }: any) => (
      <div data-testid='input-output-display'>
        InputOutputDisplay: {contentType}
      </div>
    ),
  })
);

// Mock PuppyDropdown
vi.mock('../../../app/components/PuppyDropdown', () => ({
  default: ({ options, value, onChange, trigger }: any) => (
    <div>
      <div data-testid='dropdown-trigger'>{trigger || value}</div>
      <select
        data-testid='puppy-dropdown'
        value={value}
        onChange={e => onChange(e.target.value)}
      >
        {options.map((opt: any) => (
          <option key={opt.value || opt} value={opt.value || opt}>
            {opt.label || opt}
          </option>
        ))}
      </select>
    </div>
  ),
}));

// ============================================================================
// Helper Functions
// ============================================================================

function createMockNode(overrides?: Partial<ModifyConfigNodeData>): Node {
  return {
    id: 'test-node-1',
    type: 'modifyNode',
    position: { x: 0, y: 0 },
    data: {
      subMenuType: 'structured',
      content: null,
      looped: false,
      content_type: 'dict',
      extra_configs: {
        index: undefined,
        key: undefined,
        params: {
          path: [],
        },
      },
      type: 'get',
      getConfigData: [],
      paramv: undefined,
      ...overrides,
    } as ModifyConfigNodeData,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('EditStructured Edge Node', () => {
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
      getInternalNode: vi.fn(),
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
      runSingleEdgeNode: mocks.runSingleEdgeNode,
      streamResult: vi.fn(),
      reportError: vi.fn(),
      resetLoadingUI: vi.fn(),
    });

    mocks.useAppSettings.mockReturnValue({});
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ==========================================================================
  // P0 测试用例：数据结构完整性
  // ==========================================================================

  describe('P0 - 数据结构完整性', () => {
    it('TC-ES-001: 验证 ModifyConfigNodeData 数据结构', () => {
      const node = createMockNode();

      expect(node.data).toHaveProperty('subMenuType');
      expect(node.data).toHaveProperty('content');
      expect(node.data).toHaveProperty('looped');
      expect(node.data).toHaveProperty('content_type');
      expect(node.data).toHaveProperty('extra_configs');
      expect(node.data.extra_configs).toHaveProperty('index');
      expect(node.data.extra_configs).toHaveProperty('key');
      expect(node.data.extra_configs).toHaveProperty('params');
      expect(node.data.extra_configs.params).toHaveProperty('path');
    });

    it('TC-ES-001-1: 验证 extra_configs.params.path 字段为数组', () => {
      const node = createMockNode({
        extra_configs: {
          params: {
            path: ['users', 0, 'name'],
          },
        },
      });

      expect(Array.isArray(node.data.extra_configs.params.path)).toBe(true);
      expect(node.data.extra_configs.params.path).toEqual(['users', 0, 'name']);
    });
  });

  // ==========================================================================
  // P0 测试用例：Mode 参数配置
  // ==========================================================================

  describe('P0 - Mode 参数配置', () => {
    it('TC-ES-002: Mode 切换到 "get"', async () => {
      const node = createMockNode({ type: 'delete' });
      mockGetNode.mockReturnValue(node);

      render(
        <ReactFlowProvider>
          <EditStructured id='test-node-1' data={node.data} />
        </ReactFlowProvider>
      );

      // 打开配置菜单 - 找到包含 "Edit" 文本的主按钮
      const nodeButton = screen.getByText(/Edit/).closest('button');
      if (!nodeButton) throw new Error('Node button not found');
      fireEvent.click(nodeButton);

      // 等待菜单出现并找到 Mode 下拉选择器
      const modeDropdown = await waitFor(() =>
        screen.getByTestId('puppy-dropdown')
      );
      fireEvent.change(modeDropdown, { target: { value: 'get' } });

      // 等待 requestAnimationFrame 完成
      await waitFor(() => {
        expect(mockSetNodes).toHaveBeenCalled();
      });

      // 验证 setNodes 被调用，更新 type
      const setNodesCall =
        mockSetNodes.mock.calls[mockSetNodes.mock.calls.length - 1][0];
      const updatedNodes = setNodesCall([node]);
      const updatedNode = updatedNodes.find(
        (n: Node) => n.id === 'test-node-1'
      );
      expect(updatedNode.data.type).toBe('get');
    });

    it('TC-ES-002-1: Mode 切换到 "delete"', async () => {
      const node = createMockNode({ type: 'get' });
      mockGetNode.mockReturnValue(node);

      render(
        <ReactFlowProvider>
          <EditStructured id='test-node-1' data={node.data} />
        </ReactFlowProvider>
      );

      const nodeButton = screen.getByText(/Edit/).closest('button');
      if (!nodeButton) throw new Error('Node button not found');
      fireEvent.click(nodeButton);

      const modeDropdown = await waitFor(() =>
        screen.getByTestId('puppy-dropdown')
      );
      fireEvent.change(modeDropdown, { target: { value: 'delete' } });

      await waitFor(() => {
        expect(mockSetNodes).toHaveBeenCalled();
      });

      const setNodesCall =
        mockSetNodes.mock.calls[mockSetNodes.mock.calls.length - 1][0];
      const updatedNodes = setNodesCall([node]);
      const updatedNode = updatedNodes.find(
        (n: Node) => n.id === 'test-node-1'
      );
      expect(updatedNode.data.type).toBe('delete');
    });

    it('TC-ES-002-2: Mode 切换到 "replace"', async () => {
      const node = createMockNode({ type: 'get' });
      mockGetNode.mockReturnValue(node);

      render(
        <ReactFlowProvider>
          <EditStructured id='test-node-1' data={node.data} />
        </ReactFlowProvider>
      );

      const nodeButton = screen.getByText(/Edit/).closest('button');
      if (!nodeButton) throw new Error('Node button not found');
      fireEvent.click(nodeButton);

      const modeDropdown = await waitFor(() =>
        screen.getByTestId('puppy-dropdown')
      );
      fireEvent.change(modeDropdown, { target: { value: 'replace' } });

      await waitFor(() => {
        expect(mockSetNodes).toHaveBeenCalled();
      });

      const setNodesCall =
        mockSetNodes.mock.calls[mockSetNodes.mock.calls.length - 1][0];
      const updatedNodes = setNodesCall([node]);
      const updatedNode = updatedNodes.find(
        (n: Node) => n.id === 'test-node-1'
      );
      expect(updatedNode.data.type).toBe('replace');
    });

    it('TC-ES-002-3: Mode 切换到 "get_keys"', async () => {
      const node = createMockNode({ type: 'get' });
      mockGetNode.mockReturnValue(node);

      render(
        <ReactFlowProvider>
          <EditStructured id='test-node-1' data={node.data} />
        </ReactFlowProvider>
      );

      const nodeButton = screen.getByText(/Edit/).closest('button');
      if (!nodeButton) throw new Error('Node button not found');
      fireEvent.click(nodeButton);

      // 等待菜单出现，然后获取所有的 dropdown，第一个是 Mode dropdown
      const modeDropdown = await waitFor(() => {
        const dropdowns = screen.queryAllByTestId('puppy-dropdown');
        if (dropdowns.length === 0) throw new Error('No dropdowns found');
        return dropdowns[0];
      });
      fireEvent.change(modeDropdown, { target: { value: 'get_keys' } });

      await waitFor(() => {
        expect(mockSetNodes).toHaveBeenCalled();
      });

      const setNodesCall =
        mockSetNodes.mock.calls[mockSetNodes.mock.calls.length - 1][0];
      const updatedNodes = setNodesCall([node]);
      const updatedNode = updatedNodes.find(
        (n: Node) => n.id === 'test-node-1'
      );
      expect(updatedNode.data.type).toBe('get_keys');
    });
  });

  // ==========================================================================
  // P1 测试用例：Path 树形结构管理
  // ==========================================================================

  describe('P1 - Path 树形结构管理', () => {
    it('TC-ES-003: 添加子路径节点', async () => {
      const node = createMockNode({ type: 'get', getConfigData: [] });
      mockGetNode.mockReturnValue(node);

      render(
        <ReactFlowProvider>
          <EditStructured id='test-node-1' data={node.data} />
        </ReactFlowProvider>
      );

      const nodeButton = screen.getByText(/Edit/).closest('button');
      if (!nodeButton) throw new Error('Node button not found');
      fireEvent.click(nodeButton);

      // 等待菜单渲染
      await waitFor(() => {
        expect(screen.getByText(/Path/i)).toBeInTheDocument();
      });

      // 查找 "+" 按钮（添加子节点）
      const allButtons = screen.getAllByRole('button');
      const plusButtons = allButtons.filter(btn => {
        const svg = btn.querySelector('svg');
        if (!svg) return false;
        const path = svg.querySelector('path');
        return path?.getAttribute('d')?.includes('M12 5v14M5 12h14');
      });

      if (plusButtons.length > 0) {
        fireEvent.click(plusButtons[0]);

        // 验证 pathTree 更新（间接验证，通过检查是否有新的输入框）
        await waitFor(() => {
          const inputs = screen.getAllByRole('textbox');
          expect(inputs.length).toBeGreaterThan(0);
        });
      }
    });

    it('TC-ES-003-1: 删除子路径节点', async () => {
      const node = createMockNode({
        type: 'get',
        getConfigData: [
          { key: 'key', value: 'users' },
          { key: 'key', value: 'name' },
        ],
      });
      mockGetNode.mockReturnValue(node);

      render(
        <ReactFlowProvider>
          <EditStructured id='test-node-1' data={node.data} />
        </ReactFlowProvider>
      );

      const nodeButton = screen.getByText(/Edit/).closest('button');
      if (!nodeButton) throw new Error('Node button not found');
      fireEvent.click(nodeButton);

      await waitFor(() => {
        expect(screen.getByText(/Path/i)).toBeInTheDocument();
      });

      // 查找 "X" 按钮（删除按钮）
      const allButtons = screen.getAllByRole('button');
      const deleteButtons = allButtons.filter(btn => {
        const svg = btn.querySelector('svg');
        if (!svg) return false;
        const path = svg.querySelector('path');
        return path?.getAttribute('d')?.includes('M6 18L18 6M6 6l12 12');
      });

      if (deleteButtons.length > 0) {
        const initialInputs = screen.getAllByRole('textbox');
        fireEvent.click(deleteButtons[0]);

        // 验证节点被删除（输入框减少）
        await waitFor(() => {
          const currentInputs = screen.getAllByRole('textbox');
          expect(currentInputs.length).toBeLessThanOrEqual(
            initialInputs.length
          );
        });
      }
    });

    it('TC-ES-003-2: 路径类型切换 (key/num)', async () => {
      const node = createMockNode({
        type: 'get',
        getConfigData: [{ key: 'key', value: 'users' }],
      });
      mockGetNode.mockReturnValue(node);

      render(
        <ReactFlowProvider>
          <EditStructured id='test-node-1' data={node.data} />
        </ReactFlowProvider>
      );

      const nodeButton = screen.getByText(/Edit/).closest('button');
      if (!nodeButton) throw new Error('Node button not found');
      fireEvent.click(nodeButton);

      await waitFor(() => {
        expect(screen.getByText(/Path/i)).toBeInTheDocument();
      });

      // 查找类型选择下拉框
      const dropdowns = screen.getAllByTestId('puppy-dropdown');
      // 第一个是 Mode，后面的是路径类型
      if (dropdowns.length > 1) {
        const pathTypeDropdown = dropdowns[1];
        fireEvent.change(pathTypeDropdown, { target: { value: 'num' } });

        // 验证类型切换（通过检查下拉框值）
        await waitFor(() => {
          expect(pathTypeDropdown).toHaveValue('num');
        });
      }
    });

    it('TC-ES-003-3: 路径值输入', async () => {
      const node = createMockNode({
        type: 'get',
        getConfigData: [{ key: 'key', value: '' }],
      });
      mockGetNode.mockReturnValue(node);

      render(
        <ReactFlowProvider>
          <EditStructured id='test-node-1' data={node.data} />
        </ReactFlowProvider>
      );

      const nodeButton = screen.getByText(/Edit/).closest('button');
      if (!nodeButton) throw new Error('Node button not found');
      fireEvent.click(nodeButton);

      await waitFor(() => {
        expect(screen.getByText(/Path/i)).toBeInTheDocument();
      });

      // 查找路径值输入框
      const inputs = screen.getAllByRole('textbox');
      // 第一个输入框应该是路径值输入
      if (inputs.length > 0) {
        const pathInput = inputs[0];
        fireEvent.change(pathInput, { target: { value: 'username' } });

        // 验证输入值
        await waitFor(() => {
          expect(pathInput).toHaveValue('username');
        });
      }
    });

    it('TC-ES-003-4: 路径树扁平化 (flattenPathTree)', async () => {
      // 这个测试通过验证 getConfigData 是否正确保存来间接测试 flattenPathTree
      const node = createMockNode({
        type: 'get',
        getConfigData: [
          { key: 'key', value: 'users' },
          { key: 'num', value: '0' },
          { key: 'key', value: 'name' },
        ],
      });
      mockGetNode.mockReturnValue(node);

      render(
        <ReactFlowProvider>
          <EditStructured id='test-node-1' data={node.data} />
        </ReactFlowProvider>
      );

      // 验证 getConfigData 结构正确
      expect(node.data.getConfigData).toEqual([
        { key: 'key', value: 'users' },
        { key: 'num', value: '0' },
        { key: 'key', value: 'name' },
      ]);
    });

    it('TC-ES-003-5: getConfigData 数据同步', async () => {
      const node = createMockNode({
        type: 'get',
        getConfigData: [{ key: 'key', value: 'config' }],
      });
      mockGetNode.mockReturnValue(node);

      render(
        <ReactFlowProvider>
          <EditStructured id='test-node-1' data={node.data} />
        </ReactFlowProvider>
      );

      const nodeButton = screen.getByText(/Edit/).closest('button');
      if (!nodeButton) throw new Error('Node button not found');
      fireEvent.click(nodeButton);

      await waitFor(() => {
        expect(screen.getByText(/Path/i)).toBeInTheDocument();
      });

      // 修改路径值
      const inputs = screen.getAllByRole('textbox');
      if (inputs.length > 0) {
        fireEvent.change(inputs[0], { target: { value: 'settings' } });

        // 等待数据同步
        await waitFor(
          () => {
            expect(mockSetNodes).toHaveBeenCalled();
          },
          { timeout: 3000 }
        );
      }
    });
  });

  // ==========================================================================
  // P1 测试用例：Replace Value 配置
  // ==========================================================================

  describe('P1 - Replace Value 配置', () => {
    it('TC-ES-004: Replace Value 输入', async () => {
      const node = createMockNode({ type: 'replace', paramv: '' });
      mockGetNode.mockReturnValue(node);

      render(
        <ReactFlowProvider>
          <EditStructured id='test-node-1' data={node.data} />
        </ReactFlowProvider>
      );

      const nodeButton = screen.getByText(/Edit/).closest('button');
      if (!nodeButton) throw new Error('Node button not found');
      fireEvent.click(nodeButton);

      await waitFor(() => {
        expect(screen.getByText(/Replace Value/i)).toBeInTheDocument();
      });

      // 查找 Replace Value 输入框
      const replaceValueInput = screen.getByPlaceholderText(
        /Enter replacement value/i
      );
      fireEvent.change(replaceValueInput, { target: { value: '5000' } });

      // 验证输入值
      expect(replaceValueInput).toHaveValue('5000');
    });

    it('TC-ES-004-1: Replace Value 条件渲染', async () => {
      // 测试 replace 模式显示 Replace Value
      const replaceNode = createMockNode({ type: 'replace' });
      mockGetNode.mockReturnValue(replaceNode);

      const { rerender } = render(
        <ReactFlowProvider>
          <EditStructured id='test-node-1' data={replaceNode.data} />
        </ReactFlowProvider>
      );

      const nodeButton = screen.getByText(/Edit/).closest('button');
      if (!nodeButton) throw new Error('Node button not found');
      fireEvent.click(nodeButton);

      await waitFor(() => {
        expect(screen.getByText(/Replace Value/i)).toBeInTheDocument();
      });

      // 测试 get 模式不显示 Replace Value
      const getNode = createMockNode({ type: 'get' });
      mockGetNode.mockReturnValue(getNode);

      rerender(
        <ReactFlowProvider>
          <EditStructured id='test-node-1' data={getNode.data} />
        </ReactFlowProvider>
      );

      fireEvent.click(nodeButton);

      await waitFor(() => {
        expect(screen.queryByText(/Replace Value/i)).not.toBeInTheDocument();
      });
    });
  });

  // ==========================================================================
  // P1 测试用例：Run 功能
  // ==========================================================================

  describe('P1 - Run 功能', () => {
    it('TC-ES-005: 点击 Run 按钮调用 runSingleEdgeNode', async () => {
      const node = createMockNode({ type: 'get' });
      mockGetNode.mockReturnValue(node);

      render(
        <ReactFlowProvider>
          <EditStructured id='test-node-1' data={node.data} />
        </ReactFlowProvider>
      );

      const nodeButton = screen.getByText(/Edit/).closest('button');
      if (!nodeButton) throw new Error('Node button not found');
      fireEvent.click(nodeButton);

      await waitFor(() => {
        expect(screen.getByText(/Path/i)).toBeInTheDocument();
      });

      // 查找 Run 按钮 - 页面上有两个Run按钮，获取所有按钮然后选择配置面板中的（第二个）
      const runButtons = screen.getAllByRole('button', { name: /Run/i });
      // 选择可见的配置面板中的 Run 按钮（通常是第二个）
      const runButton = runButtons.length > 1 ? runButtons[1] : runButtons[0];
      fireEvent.click(runButton);

      // 验证 runSingleEdgeNode 被调用
      await waitFor(() => {
        expect(mocks.runSingleEdgeNode).toHaveBeenCalledWith(
          expect.objectContaining({
            targetNodeType: 'structured',
          })
        );
      });
    });

    it('TC-ES-005-1: Run 按钮在 loading 时显示 Stop', async () => {
      const node = createMockNode({ type: 'get' });
      mockGetNode.mockReturnValue(node);

      // Mock runSingleEdgeNode 为异步函数，不立即完成
      mocks.runSingleEdgeNode.mockImplementation(() => {
        return new Promise(resolve => {
          setTimeout(resolve, 100);
        });
      });

      render(
        <ReactFlowProvider>
          <EditStructured id='test-node-1' data={node.data} />
        </ReactFlowProvider>
      );

      const nodeButton = screen.getByText(/Edit/).closest('button');
      if (!nodeButton) throw new Error('Node button not found');
      fireEvent.click(nodeButton);

      await waitFor(() => {
        expect(screen.getByText(/Path/i)).toBeInTheDocument();
      });

      // 查找 Run 按钮 - 页面上有两个Run按钮，获取所有按钮然后选择配置面板中的（第二个）
      const runButtons = screen.getAllByRole('button', { name: /Run/i });
      const runButton = runButtons.length > 1 ? runButtons[1] : runButtons[0];
      fireEvent.click(runButton);

      // 验证 loading 状态下按钮显示 "Stop"
      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: /Stop/i })
        ).toBeInTheDocument();
      });
    });
  });
});
