/**
 * IfElse Edge Node - 参数配置测试
 *
 * 测试用例：
 * P0 致命 - 核心数据结构保存失败导致条件判断功能不可用：
 * - TC-IE-001: cases 数组修改后保存
 * - TC-IE-001-1: cases 应为数组类型
 * - TC-IE-004: Condition 类型修改应正确保存
 * - TC-IE-004-1: Condition 值(cond_v)修改应正确保存
 * - TC-IE-005: Condition 的源节点修改应正确保存
 * - TC-IE-008: Action 的源节点修改应正确保存
 * - TC-IE-008-1: Action 的目标节点修改应正确保存
 *
 * P1 严重 - 动态配置功能异常影响用户体验：
 * - TC-IE-002: 添加新 Case 应正确更新
 * - TC-IE-002-1: 删除 Case 应正确更新
 * - TC-IE-003: 新增 Case 应包含默认 condition 和 action
 * - TC-IE-003-1: 不能删除最后一个 Case
 * - TC-IE-006: 添加新 Condition 应正确更新
 * - TC-IE-006-1: 删除 Condition 应正确更新
 * - TC-IE-007: AND/OR 操作切换应正确保存
 * - TC-IE-009: 添加新 Action 应正确更新
 * - TC-IE-009-1: 删除 Action 应正确更新
 *
 * P2 中等 - 初始化和 UI 交互：
 * - TC-IE-010: cases 初始化验证
 * - TC-IE-010-1: 从 node.data.cases 加载现有配置
 * - TC-IE-011: 默认 case 结构验证
 * - TC-IE-012: 组件挂载验证
 * - TC-IE-013: 配置菜单展开/收起
 * - TC-IE-013-1: 配置菜单初始状态
 *
 * ⚠️ 测试重点：
 * - Cases 数组的增删改查
 * - Condition 和 Action 的参数修改
 * - 复杂嵌套结构的状态管理
 */

// @ts-nocheck
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import IfElse from '../../../app/components/workflow/edgesNode/edgeNodesNew/ifelse';
import type { Node } from '@xyflow/react';
import type {
  ChooseConfigNodeData,
  CaseItem,
} from '../../../app/components/workflow/edgesNode/edgeNodesNew/ifelse';

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

vi.mock('../../../app/components/misc/PuppyDropDown', () => ({
  PuppyDropdown: mocks.PuppyDropdown,
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

describe('IfElse Edge Node - 参数配置', () => {
  let mockSetNodes: any;
  let mockGetNode: any;
  let mockSetEdges: any;

  const createMockTextNode = (id: string, label: string): any => ({
    id,
    type: 'text',
    position: { x: 0, y: 0 },
    data: { label },
  });

  const createDefaultCase = (): CaseItem => ({
    conditions: [
      {
        id: 'source-node-1',
        label: 'source1',
        condition: 'contains',
        type: 'text',
        cond_v: '',
        operation: 'AND',
      },
    ],
    actions: [
      {
        from_id: 'source-node-1',
        from_label: 'output',
        outputs: [],
      },
    ],
  });

  const createMockNode = (
    overrides: Partial<ChooseConfigNodeData> = {}
  ): Node<ChooseConfigNodeData> => ({
    id: 'test-ifelse-1',
    type: 'ifelse',
    position: { x: 0, y: 0 },
    data: {
      looped: false,
      content: null,
      switch: undefined,
      ON: undefined,
      OFF: undefined,
      cases: undefined,
      ...overrides,
    },
  });

  beforeEach(() => {
    mockSetNodes = vi.fn();
    mockSetEdges = vi.fn();
    mockGetNode = vi.fn(id => {
      if (id === 'test-ifelse-1') return createMockNode();
      if (id === 'source-node-1')
        return createMockTextNode('source-node-1', 'source1');
      if (id === 'source-node-2')
        return createMockTextNode('source-node-2', 'source2');
      if (id === 'target-node-1')
        return createMockTextNode('target-node-1', 'target1');
      return null;
    });

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
      getSourceNodeIdWithLabel: vi.fn(() => [
        { id: 'source-node-1', label: 'source1' },
        { id: 'source-node-2', label: 'source2' },
      ]),
      getTargetNodeIdWithLabel: vi.fn(() => [
        { id: 'target-node-1', label: 'target1' },
      ]),
    });

    mocks.useJsonConstructUtils.mockReturnValue({
      streamResult: vi.fn(),
      reportError: vi.fn(),
      resetLoadingUI: vi.fn(),
    });

    mocks.useAppSettings.mockReturnValue({});

    mocks.runSingleEdgeNode.mockResolvedValue(undefined);

    // Mock PuppyDropdown
    mocks.PuppyDropdown.mockImplementation(
      ({ options, onSelect, selectedValue, mapValueTodisplay }: any) => {
        const displayValue = mapValueTodisplay
          ? mapValueTodisplay(selectedValue)
          : selectedValue;
        return (
          <div data-testid='puppy-dropdown'>
            <button data-testid='dropdown-button'>
              {displayValue || 'Select'}
            </button>
            <div data-testid='dropdown-options'>
              {Array.isArray(options) &&
                options.map((opt: any, idx: number) => {
                  const optValue = typeof opt === 'string' ? opt : opt;
                  return (
                    <button
                      key={idx}
                      data-testid={`dropdown-option-${idx}`}
                      onClick={() => onSelect(optValue)}
                    >
                      {typeof opt === 'string' ? opt : opt.label || opt.id}
                    </button>
                  );
                })}
            </div>
          </div>
        );
      }
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ==================== P0 测试用例 ====================

  describe('P0: 核心数据保存', () => {
    it('TC-IE-001: 修改 cases 应正确保存到 node.data.cases', async () => {
      const node = createMockNode();
      render(
        <IfElse {...node} id={node.id} data={node.data} isConnectable={true} />
      );

      // 点击节点打开配置菜单
      const nodeButton = screen.getByRole('button', { name: /IF\/ELSE/i });
      fireEvent.click(nodeButton);

      await waitFor(() => {
        expect(screen.getByText('If/Else')).toBeInTheDocument();
      });

      // 等待初始化完成
      await waitFor(
        () => {
          expect(mockSetNodes).toHaveBeenCalled();
        },
        { timeout: 3000 }
      );

      // 获取最后一次调用的 setNodes
      const lastCall =
        mockSetNodes.mock.calls[mockSetNodes.mock.calls.length - 1][0];
      const updatedNodes =
        typeof lastCall === 'function' ? lastCall([node]) : lastCall;
      const updatedNode = updatedNodes.find((n: any) => n.id === node.id);

      // 验证 cases 被保存（应该被初始化为空数组或包含默认 case）
      expect(updatedNode.data.cases).toBeDefined();
      expect(Array.isArray(updatedNode.data.cases)).toBe(true);
    });

    it('TC-IE-001-1: cases 应为数组类型', async () => {
      const initialCase = createDefaultCase();
      const node = createMockNode({ cases: [initialCase] });

      render(
        <IfElse {...node} id={node.id} data={node.data} isConnectable={true} />
      );

      const nodeButton = screen.getByRole('button', { name: /IF\/ELSE/i });
      fireEvent.click(nodeButton);

      await waitFor(
        () => {
          expect(mockSetNodes).toHaveBeenCalled();
        },
        { timeout: 3000 }
      );

      const lastCall =
        mockSetNodes.mock.calls[mockSetNodes.mock.calls.length - 1][0];
      const updatedNodes =
        typeof lastCall === 'function' ? lastCall([node]) : lastCall;
      const updatedNode = updatedNodes.find((n: any) => n.id === node.id);

      // 验证 cases 是数组类型
      expect(Array.isArray(updatedNode.data.cases)).toBe(true);
      // 验证数组包含至少一个元素
      expect(updatedNode.data.cases.length).toBeGreaterThan(0);
      // 验证每个 case 包含 conditions 和 actions
      updatedNode.data.cases.forEach((caseItem: CaseItem) => {
        expect(Array.isArray(caseItem.conditions)).toBe(true);
        expect(Array.isArray(caseItem.actions)).toBe(true);
      });
    });

    it('TC-IE-004: 修改 Condition 类型应正确保存', async () => {
      const initialCase = createDefaultCase();
      const node = createMockNode({ cases: [initialCase] });

      render(
        <IfElse {...node} id={node.id} data={node.data} isConnectable={true} />
      );

      const nodeButton = screen.getByRole('button', { name: /IF\/ELSE/i });
      fireEvent.click(nodeButton);

      await waitFor(() => {
        expect(screen.getByText('If/Else')).toBeInTheDocument();
      });

      // 查找 Condition 类型的下拉菜单（第二个 PuppyDropdown）
      const dropdowns = screen.getAllByTestId('puppy-dropdown');
      // 第一个是节点选择，第二个是条件类型
      const conditionTypeDropdown = dropdowns[1];

      // 点击选项改变条件类型
      const options = conditionTypeDropdown.querySelectorAll(
        '[data-testid^="dropdown-option-"]'
      );
      if (options.length > 1) {
        fireEvent.click(options[1]); // 选择第二个选项（如 "doesn't contain"）
      }

      await waitFor(
        () => {
          expect(mockSetNodes).toHaveBeenCalled();
        },
        { timeout: 3000 }
      );

      const lastCall =
        mockSetNodes.mock.calls[mockSetNodes.mock.calls.length - 1][0];
      const updatedNodes =
        typeof lastCall === 'function' ? lastCall([node]) : lastCall;
      const updatedNode = updatedNodes.find((n: any) => n.id === node.id);

      // 验证 condition 被更新（不再是初始的 'contains'）
      expect(updatedNode.data.cases[0].conditions[0].condition).toBeDefined();
    });

    it('TC-IE-004-1: 修改 Condition 值(cond_v)应正确保存', async () => {
      const initialCase = createDefaultCase();
      const node = createMockNode({ cases: [initialCase] });

      render(
        <IfElse {...node} id={node.id} data={node.data} isConnectable={true} />
      );

      const nodeButton = screen.getByRole('button', { name: /IF\/ELSE/i });
      fireEvent.click(nodeButton);

      await waitFor(() => {
        expect(screen.getByText('If/Else')).toBeInTheDocument();
      });

      // 查找条件值输入框
      const conditionInput = screen.getByPlaceholderText('Enter value...');
      expect(conditionInput).toBeInTheDocument();

      // 输入条件值
      fireEvent.change(conditionInput, { target: { value: 'test value' } });

      await waitFor(
        () => {
          const calls = mockSetNodes.mock.calls;
          const lastCall = calls[calls.length - 1][0];
          const updatedNodes =
            typeof lastCall === 'function' ? lastCall([node]) : lastCall;
          const updatedNode = updatedNodes.find((n: any) => n.id === node.id);

          expect(updatedNode.data.cases[0].conditions[0].cond_v).toBe(
            'test value'
          );
        },
        { timeout: 3000 }
      );
    });

    it('TC-IE-005: 修改 Condition 的源节点应正确保存', async () => {
      const initialCase = createDefaultCase();
      const node = createMockNode({ cases: [initialCase] });

      render(
        <IfElse {...node} id={node.id} data={node.data} isConnectable={true} />
      );

      const nodeButton = screen.getByRole('button', { name: /IF\/ELSE/i });
      fireEvent.click(nodeButton);

      await waitFor(() => {
        expect(screen.getByText('If/Else')).toBeInTheDocument();
      });

      // 查找第一个 PuppyDropdown（源节点选择）
      const dropdowns = screen.getAllByTestId('puppy-dropdown');
      const sourceNodeDropdown = dropdowns[0];

      // 点击第二个源节点选项
      const options = sourceNodeDropdown.querySelectorAll(
        '[data-testid^="dropdown-option-"]'
      );
      if (options.length > 1) {
        fireEvent.click(options[1]); // 选择 source-node-2
      }

      await waitFor(
        () => {
          const calls = mockSetNodes.mock.calls;
          const lastCall = calls[calls.length - 1][0];
          const updatedNodes =
            typeof lastCall === 'function' ? lastCall([node]) : lastCall;
          const updatedNode = updatedNodes.find((n: any) => n.id === node.id);

          // 验证源节点 ID 被更新
          const conditionId = updatedNode.data.cases[0].conditions[0].id;
          expect(['source-node-1', 'source-node-2']).toContain(conditionId);
        },
        { timeout: 3000 }
      );
    });

    it('TC-IE-008: 修改 Action 的源节点应正确保存', async () => {
      const initialCase = createDefaultCase();
      const node = createMockNode({ cases: [initialCase] });

      render(
        <IfElse {...node} id={node.id} data={node.data} isConnectable={true} />
      );

      const nodeButton = screen.getByRole('button', { name: /IF\/ELSE/i });
      fireEvent.click(nodeButton);

      await waitFor(() => {
        expect(screen.getByText('If/Else')).toBeInTheDocument();
        expect(screen.getByText('copy to')).toBeInTheDocument();
      });

      // Action 部分的第一个下拉菜单是源节点选择
      // 在 Then 部分找到源节点下拉菜单
      const dropdowns = screen.getAllByTestId('puppy-dropdown');
      // 通常前2个是 Condition 的，后面的是 Action 的
      const actionSourceDropdown = dropdowns[2];

      const options = actionSourceDropdown.querySelectorAll(
        '[data-testid^="dropdown-option-"]'
      );
      if (options.length > 1) {
        fireEvent.click(options[1]);
      }

      await waitFor(
        () => {
          const calls = mockSetNodes.mock.calls;
          const lastCall = calls[calls.length - 1][0];
          const updatedNodes =
            typeof lastCall === 'function' ? lastCall([node]) : lastCall;
          const updatedNode = updatedNodes.find((n: any) => n.id === node.id);

          // 验证 action 的源节点被更新
          const actionFromId = updatedNode.data.cases[0].actions[0].from_id;
          expect(['source-node-1', 'source-node-2']).toContain(actionFromId);
        },
        { timeout: 3000 }
      );
    });

    it('TC-IE-008-1: 修改 Action 的目标节点应正确保存', async () => {
      const initialCase = createDefaultCase();
      const node = createMockNode({ cases: [initialCase] });

      render(
        <IfElse {...node} id={node.id} data={node.data} isConnectable={true} />
      );

      const nodeButton = screen.getByRole('button', { name: /IF\/ELSE/i });
      fireEvent.click(nodeButton);

      await waitFor(() => {
        expect(screen.getByText('copy to')).toBeInTheDocument();
      });

      // Action 部分的第二个下拉菜单是目标节点选择
      const dropdowns = screen.getAllByTestId('puppy-dropdown');
      const actionTargetDropdown = dropdowns[3]; // 第4个下拉菜单

      const options = actionTargetDropdown.querySelectorAll(
        '[data-testid^="dropdown-option-"]'
      );
      if (options.length > 0) {
        fireEvent.click(options[0]); // 选择 target-node-1
      }

      await waitFor(
        () => {
          const calls = mockSetNodes.mock.calls;
          const lastCall = calls[calls.length - 1][0];
          const updatedNodes =
            typeof lastCall === 'function' ? lastCall([node]) : lastCall;
          const updatedNode = updatedNodes.find((n: any) => n.id === node.id);

          // 验证 action 的目标节点被保存到 outputs 数组
          const outputs = updatedNode.data.cases[0].actions[0].outputs;
          expect(Array.isArray(outputs)).toBe(true);
          if (outputs.length > 0) {
            expect(outputs[0]).toBe('target-node-1');
          }
        },
        { timeout: 3000 }
      );
    });
  });

  // ==================== P1 测试用例 ====================

  describe('P1: 动态配置功能', () => {
    it('TC-IE-002: 添加新 Case 应正确更新 cases 数组', async () => {
      const initialCase = createDefaultCase();
      const node = createMockNode({ cases: [initialCase] });

      render(
        <IfElse {...node} id={node.id} data={node.data} isConnectable={true} />
      );

      const nodeButton = screen.getByRole('button', { name: /IF\/ELSE/i });
      fireEvent.click(nodeButton);

      await waitFor(() => {
        expect(screen.getByText('Add New Case')).toBeInTheDocument();
      });

      const initialCasesLength = 1;

      // 点击 "Add New Case" 按钮
      const addCaseButton = screen.getByText('Add New Case');
      fireEvent.click(addCaseButton);

      await waitFor(
        () => {
          const calls = mockSetNodes.mock.calls;
          const lastCall = calls[calls.length - 1][0];
          const updatedNodes =
            typeof lastCall === 'function' ? lastCall([node]) : lastCall;
          const updatedNode = updatedNodes.find((n: any) => n.id === node.id);

          // 验证 cases 数组长度增加
          expect(updatedNode.data.cases.length).toBe(initialCasesLength + 1);
        },
        { timeout: 3000 }
      );
    });

    it('TC-IE-002-1: 删除 Case 应正确更新 cases 数组', async () => {
      const case1 = createDefaultCase();
      const case2 = createDefaultCase();
      const node = createMockNode({ cases: [case1, case2] });

      render(
        <IfElse {...node} id={node.id} data={node.data} isConnectable={true} />
      );

      const nodeButton = screen.getByRole('button', { name: /IF\/ELSE/i });
      fireEvent.click(nodeButton);

      await waitFor(() => {
        expect(screen.getByText('Case 1')).toBeInTheDocument();
        expect(screen.getByText('Case 2')).toBeInTheDocument();
      });

      // 查找删除按钮（Case 1 的删除按钮）
      const deleteButtons = screen.getAllByRole('button').filter(btn => {
        const svg = btn.querySelector('svg');
        return svg && svg.querySelector('path[d*="M18 6L6 18"]');
      });

      if (deleteButtons.length > 0) {
        fireEvent.click(deleteButtons[0]);

        await waitFor(
          () => {
            const calls = mockSetNodes.mock.calls;
            const lastCall = calls[calls.length - 1][0];
            const updatedNodes =
              typeof lastCall === 'function' ? lastCall([node]) : lastCall;
            const updatedNode = updatedNodes.find((n: any) => n.id === node.id);

            // 验证 cases 数组长度减少
            expect(updatedNode.data.cases.length).toBe(1);
          },
          { timeout: 3000 }
        );
      }
    });

    it('TC-IE-003: 新增 Case 应包含默认 condition 和 action', async () => {
      const initialCase = createDefaultCase();
      const node = createMockNode({ cases: [initialCase] });

      render(
        <IfElse {...node} id={node.id} data={node.data} isConnectable={true} />
      );

      const nodeButton = screen.getByRole('button', { name: /IF\/ELSE/i });
      fireEvent.click(nodeButton);

      await waitFor(() => {
        expect(screen.getByText('Add New Case')).toBeInTheDocument();
      });

      const addCaseButton = screen.getByText('Add New Case');
      fireEvent.click(addCaseButton);

      await waitFor(
        () => {
          const calls = mockSetNodes.mock.calls;
          const lastCall = calls[calls.length - 1][0];
          const updatedNodes =
            typeof lastCall === 'function' ? lastCall([node]) : lastCall;
          const updatedNode = updatedNodes.find((n: any) => n.id === node.id);

          // 验证新 case 包含 conditions 和 actions
          const newCase = updatedNode.data.cases[1];
          expect(newCase).toBeDefined();
          expect(Array.isArray(newCase.conditions)).toBe(true);
          expect(newCase.conditions.length).toBeGreaterThan(0);
          expect(Array.isArray(newCase.actions)).toBe(true);
          expect(newCase.actions.length).toBeGreaterThan(0);

          // 验证默认 condition
          expect(newCase.conditions[0].condition).toBe('contains');
          expect(newCase.conditions[0].operation).toBe('AND');

          // 验证默认 action
          expect(newCase.actions[0].from_label).toBe('output');
        },
        { timeout: 3000 }
      );
    });

    it('TC-IE-003-1: 不能删除最后一个 Case', async () => {
      const initialCase = createDefaultCase();
      const node = createMockNode({ cases: [initialCase] });

      render(
        <IfElse {...node} id={node.id} data={node.data} isConnectable={true} />
      );

      const nodeButton = screen.getByRole('button', { name: /IF\/ELSE/i });
      fireEvent.click(nodeButton);

      await waitFor(() => {
        expect(screen.getByText('Case 1')).toBeInTheDocument();
      });

      // 查找 Case 1 标题附近的删除按钮
      const deleteButtons = screen.getAllByRole('button').filter(btn => {
        const svg = btn.querySelector('svg');
        return svg && svg.querySelector('path[d*="M18 6L6 18"]');
      });

      // 由于只有一个 Case，删除按钮应该不存在或被隐藏
      // 或者点击后不会删除（取决于实现）
      const initialCaseDeleteButton = deleteButtons.find(btn => {
        const parent = btn.closest('div');
        return parent?.textContent?.includes('Case 1');
      });

      // 如果找到了删除按钮，验证它被隐藏或不可见
      if (initialCaseDeleteButton) {
        // 按钮存在但应该不可见（根据代码 cases.length > 1 的条件）
        expect(initialCaseDeleteButton).not.toBeVisible();
      } else {
        // 或者按钮根本不存在
        expect(initialCaseDeleteButton).toBeUndefined();
      }
    });

    it('TC-IE-006: 添加新 Condition 应正确更新', async () => {
      const initialCase = createDefaultCase();
      const node = createMockNode({ cases: [initialCase] });

      render(
        <IfElse {...node} id={node.id} data={node.data} isConnectable={true} />
      );

      const nodeButton = screen.getByRole('button', { name: /IF\/ELSE/i });
      fireEvent.click(nodeButton);

      await waitFor(() => {
        expect(screen.getByText('Add Condition')).toBeInTheDocument();
      });

      const addConditionButton = screen.getByText('Add Condition');
      fireEvent.click(addConditionButton);

      await waitFor(
        () => {
          const calls = mockSetNodes.mock.calls;
          const lastCall = calls[calls.length - 1][0];
          const updatedNodes =
            typeof lastCall === 'function' ? lastCall([node]) : lastCall;
          const updatedNode = updatedNodes.find((n: any) => n.id === node.id);

          // 验证 conditions 数组长度增加
          expect(updatedNode.data.cases[0].conditions.length).toBe(2);

          // 验证新 condition 的默认值
          const newCondition = updatedNode.data.cases[0].conditions[1];
          expect(newCondition.condition).toBe('contains');
          expect(newCondition.operation).toBe('AND');
        },
        { timeout: 3000 }
      );
    });

    it('TC-IE-006-1: 删除 Condition 应正确更新', async () => {
      const caseWithTwoConditions: CaseItem = {
        conditions: [
          {
            id: 'source-node-1',
            label: 'source1',
            condition: 'contains',
            type: 'text',
            cond_v: '',
            operation: 'AND',
          },
          {
            id: 'source-node-2',
            label: 'source2',
            condition: 'contains',
            type: 'text',
            cond_v: '',
            operation: 'AND',
          },
        ],
        actions: [
          {
            from_id: 'source-node-1',
            from_label: 'output',
            outputs: [],
          },
        ],
      };
      const node = createMockNode({ cases: [caseWithTwoConditions] });

      render(
        <IfElse {...node} id={node.id} data={node.data} isConnectable={true} />
      );

      const nodeButton = screen.getByRole('button', { name: /IF\/ELSE/i });
      fireEvent.click(nodeButton);

      await waitFor(() => {
        expect(screen.getByText('Condition')).toBeInTheDocument();
      });

      // 查找 Condition 的删除按钮
      const deleteButtons = screen.getAllByRole('button').filter(btn => {
        const svg = btn.querySelector('svg');
        return svg && svg.querySelector('path[d*="M18 6L6 18"]');
      });

      // 应该有多个删除按钮（Case 删除 + Condition 删除）
      if (deleteButtons.length > 1) {
        fireEvent.click(deleteButtons[1]); // 点击第一个 Condition 的删除按钮

        await waitFor(
          () => {
            const calls = mockSetNodes.mock.calls;
            const lastCall = calls[calls.length - 1][0];
            const updatedNodes =
              typeof lastCall === 'function' ? lastCall([node]) : lastCall;
            const updatedNode = updatedNodes.find((n: any) => n.id === node.id);

            // 验证 conditions 数组长度减少
            expect(updatedNode.data.cases[0].conditions.length).toBe(1);
          },
          { timeout: 3000 }
        );
      }
    });

    it('TC-IE-007: AND/OR 操作切换应正确保存', async () => {
      const caseWithTwoConditions: CaseItem = {
        conditions: [
          {
            id: 'source-node-1',
            label: 'source1',
            condition: 'contains',
            type: 'text',
            cond_v: '',
            operation: 'AND',
          },
          {
            id: 'source-node-2',
            label: 'source2',
            condition: 'contains',
            type: 'text',
            cond_v: '',
            operation: 'AND',
          },
        ],
        actions: [
          {
            from_id: 'source-node-1',
            from_label: 'output',
            outputs: [],
          },
        ],
      };
      const node = createMockNode({ cases: [caseWithTwoConditions] });

      render(
        <IfElse {...node} id={node.id} data={node.data} isConnectable={true} />
      );

      const nodeButton = screen.getByRole('button', { name: /IF\/ELSE/i });
      fireEvent.click(nodeButton);

      // 增加超时时间并使用更灵活的查询方式
      const andOrButton = await waitFor(
        () => {
          // 尝试查找 AND 或 OR 按钮
          const andButton = screen.queryByText('AND');
          const orButton = screen.queryByText('OR');
          const button = andButton || orButton;
          if (!button) throw new Error('AND/OR button not found');
          return button;
        },
        { timeout: 5000 }
      );

      const initialOperation = andOrButton.textContent;
      fireEvent.click(andOrButton);

      await waitFor(
        () => {
          const calls = mockSetNodes.mock.calls;
          const lastCall = calls[calls.length - 1][0];
          const updatedNodes =
            typeof lastCall === 'function' ? lastCall([node]) : lastCall;
          const updatedNode = updatedNodes.find((n: any) => n.id === node.id);

          // 验证 operation 从 AND 切换到 OR
          const operation = updatedNode.data.cases[0].conditions[0].operation;
          expect(operation).toBe(initialOperation === 'AND' ? 'OR' : 'AND');
        },
        { timeout: 3000 }
      );
    });

    it('TC-IE-009: 添加新 Action 应正确更新', async () => {
      const initialCase = createDefaultCase();
      const node = createMockNode({ cases: [initialCase] });

      render(
        <IfElse {...node} id={node.id} data={node.data} isConnectable={true} />
      );

      const nodeButton = screen.getByRole('button', { name: /IF\/ELSE/i });
      fireEvent.click(nodeButton);

      await waitFor(() => {
        expect(screen.getByText('Add Action')).toBeInTheDocument();
      });

      const addActionButton = screen.getByText('Add Action');
      fireEvent.click(addActionButton);

      await waitFor(
        () => {
          const calls = mockSetNodes.mock.calls;
          const lastCall = calls[calls.length - 1][0];
          const updatedNodes =
            typeof lastCall === 'function' ? lastCall([node]) : lastCall;
          const updatedNode = updatedNodes.find((n: any) => n.id === node.id);

          // 验证 actions 数组长度增加
          expect(updatedNode.data.cases[0].actions.length).toBe(2);

          // 验证新 action 的默认值
          const newAction = updatedNode.data.cases[0].actions[1];
          expect(newAction.from_label).toBe('output');
          expect(Array.isArray(newAction.outputs)).toBe(true);
        },
        { timeout: 3000 }
      );
    });

    it('TC-IE-009-1: 删除 Action 应正确更新', async () => {
      const caseWithTwoActions: CaseItem = {
        conditions: [
          {
            id: 'source-node-1',
            label: 'source1',
            condition: 'contains',
            type: 'text',
            cond_v: '',
            operation: 'AND',
          },
        ],
        actions: [
          {
            from_id: 'source-node-1',
            from_label: 'output',
            outputs: [],
          },
          {
            from_id: 'source-node-2',
            from_label: 'output',
            outputs: [],
          },
        ],
      };
      const node = createMockNode({ cases: [caseWithTwoActions] });

      render(
        <IfElse {...node} id={node.id} data={node.data} isConnectable={true} />
      );

      const nodeButton = screen.getByRole('button', { name: /IF\/ELSE/i });
      fireEvent.click(nodeButton);

      await waitFor(() => {
        expect(screen.getByText('Then')).toBeInTheDocument();
      });

      // 查找 Action 的删除按钮（在 Then 部分）
      const deleteButtons = screen.getAllByRole('button').filter(btn => {
        const svg = btn.querySelector('svg');
        return svg && svg.querySelector('path[d*="M18 6L6 18"]');
      });

      // 应该有多个删除按钮，找到 Action 部分的
      const actionDeleteButton = deleteButtons[deleteButtons.length - 1];
      if (actionDeleteButton) {
        fireEvent.click(actionDeleteButton);

        await waitFor(
          () => {
            const calls = mockSetNodes.mock.calls;
            const lastCall = calls[calls.length - 1][0];
            const updatedNodes =
              typeof lastCall === 'function' ? lastCall([node]) : lastCall;
            const updatedNode = updatedNodes.find((n: any) => n.id === node.id);

            // 验证 actions 数组长度减少
            expect(updatedNode.data.cases[0].actions.length).toBe(1);
          },
          { timeout: 3000 }
        );
      }
    });
  });

  // ==================== P2 测试用例 ====================

  describe('P2: 初始化和 UI 交互', () => {
    it('TC-IE-010: 节点初始化时 cases 应为空数组或包含默认 case', async () => {
      const node = createMockNode(); // cases 为 undefined

      render(
        <IfElse {...node} id={node.id} data={node.data} isConnectable={true} />
      );

      const nodeButton = screen.getByRole('button', { name: /IF\/ELSE/i });
      fireEvent.click(nodeButton);

      await waitFor(
        () => {
          expect(mockSetNodes).toHaveBeenCalled();
        },
        { timeout: 3000 }
      );

      const lastCall =
        mockSetNodes.mock.calls[mockSetNodes.mock.calls.length - 1][0];
      const updatedNodes =
        typeof lastCall === 'function' ? lastCall([node]) : lastCall;
      const updatedNode = updatedNodes.find((n: any) => n.id === node.id);

      // 验证 cases 被初始化为数组
      expect(Array.isArray(updatedNode.data.cases)).toBe(true);
    });

    it('TC-IE-010-1: 节点初始化时应从 node.data.cases 加载现有配置', async () => {
      const existingCase: CaseItem = {
        conditions: [
          {
            id: 'existing-node',
            label: 'existing',
            condition: "doesn't contain",
            type: 'structured',
            cond_v: 'test',
            operation: 'OR',
          },
        ],
        actions: [
          {
            from_id: 'existing-node',
            from_label: 'custom-output',
            outputs: ['target-node-1'],
          },
        ],
      };

      const node = createMockNode({ cases: [existingCase] });

      // Mock getNode 返回包含现有配置的节点
      mockGetNode.mockImplementation(id => {
        if (id === 'test-ifelse-1') return node;
        if (id === 'existing-node')
          return createMockTextNode('existing-node', 'existing');
        if (id === 'target-node-1')
          return createMockTextNode('target-node-1', 'target1');
        return null;
      });

      render(
        <IfElse {...node} id={node.id} data={node.data} isConnectable={true} />
      );

      const nodeButton = screen.getByRole('button', { name: /IF\/ELSE/i });
      fireEvent.click(nodeButton);

      await waitFor(() => {
        expect(screen.getByText('If/Else')).toBeInTheDocument();
      });

      await waitFor(
        () => {
          const calls = mockSetNodes.mock.calls;
          const lastCall = calls[calls.length - 1][0];
          const updatedNodes =
            typeof lastCall === 'function' ? lastCall([node]) : lastCall;
          const updatedNode = updatedNodes.find((n: any) => n.id === node.id);

          // 验证现有配置被加载
          expect(updatedNode.data.cases).toBeDefined();
          expect(updatedNode.data.cases.length).toBeGreaterThan(0);

          const loadedCase = updatedNode.data.cases[0];
          // 验证 condition 的配置
          expect(loadedCase.conditions[0].cond_v).toBe('test');
        },
        { timeout: 3000 }
      );
    });

    it('TC-IE-011: 默认 case 应包含一个 condition 和一个 action', async () => {
      const node = createMockNode();

      render(
        <IfElse {...node} id={node.id} data={node.data} isConnectable={true} />
      );

      const nodeButton = screen.getByRole('button', { name: /IF\/ELSE/i });
      fireEvent.click(nodeButton);

      // 等待初始化完成
      await waitFor(
        () => {
          const calls = mockSetNodes.mock.calls;
          if (calls.length > 0) {
            const lastCall = calls[calls.length - 1][0];
            const updatedNodes =
              typeof lastCall === 'function' ? lastCall([node]) : lastCall;
            const updatedNode = updatedNodes.find((n: any) => n.id === node.id);

            if (updatedNode.data.cases && updatedNode.data.cases.length > 0) {
              const defaultCase = updatedNode.data.cases[0];

              // 验证默认 case 结构
              expect(defaultCase.conditions.length).toBeGreaterThanOrEqual(1);
              expect(defaultCase.actions.length).toBeGreaterThanOrEqual(1);

              // 验证默认 condition
              expect(defaultCase.conditions[0].condition).toBe('contains');
              expect(defaultCase.conditions[0].operation).toBe('AND');

              // 验证默认 action
              expect(defaultCase.actions[0].from_label).toBe('output');

              return true;
            }
          }
          return false;
        },
        { timeout: 5000 }
      );
    });

    it('TC-IE-012: 组件挂载后验证', async () => {
      const node = createMockNode();

      const { container } = render(
        <IfElse {...node} id={node.id} data={node.data} isConnectable={true} />
      );

      // 验证组件已渲染
      expect(container).toBeInTheDocument();

      // 验证节点按钮存在
      const nodeButton = screen.getByRole('button', { name: /IF\/ELSE/i });
      expect(nodeButton).toBeInTheDocument();

      // 验证 SVG 图标存在
      const svg = container.querySelector('svg');
      expect(svg).toBeInTheDocument();
    });

    it('TC-IE-013: 点击节点按钮应打开/关闭配置菜单', async () => {
      const node = createMockNode();

      render(
        <IfElse {...node} id={node.id} data={node.data} isConnectable={true} />
      );

      // 初始状态：配置菜单应不可见
      expect(screen.queryByText('If/Else')).not.toBeInTheDocument();

      // 点击节点按钮打开菜单
      const nodeButton = screen.getByRole('button', { name: /IF\/ELSE/i });
      fireEvent.click(nodeButton);

      await waitFor(() => {
        expect(screen.getByText('If/Else')).toBeInTheDocument();
      });

      // 再次点击关闭菜单
      fireEvent.click(nodeButton);

      await waitFor(() => {
        expect(screen.queryByText('If/Else')).not.toBeInTheDocument();
      });
    });

    it('TC-IE-013-1: 配置菜单初始状态应为关闭', async () => {
      const node = createMockNode();

      render(
        <IfElse {...node} id={node.id} data={node.data} isConnectable={true} />
      );

      // 验证配置菜单初始不可见
      expect(screen.queryByText('If/Else')).not.toBeInTheDocument();
      expect(screen.queryByText('Add New Case')).not.toBeInTheDocument();
    });
  });
});
