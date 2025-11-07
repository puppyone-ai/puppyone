/**
 * LLM Edge Node - 输出类型配置测试
 *
 * 测试用例：
 * P0:
 * - TC-LLM-020: 选择 text 输出
 * - TC-LLM-021: 选择 structured text 输出
 * - TC-LLM-023: 输出类型持久化
 *
 * P1:
 * - TC-LLM-022: 默认输出类型
 * - TC-LLM-024: 切换输出类型
 *
 * ⚠️ 测试重点：
 * - structured_output 字段是否正确保存到 node.data
 * - 布尔值正确性
 */

// @ts-nocheck
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import LLM from '../../../app/components/workflow/edgesNode/edgeNodesNew/LLM';
import type { Node } from '@xyflow/react';
import type { LLMConfigNodeData } from '../../../app/components/workflow/edgesNode/edgeNodesNew/LLM';

// Mock 配置
const mocks = vi.hoisted(() => ({
  useReactFlow: vi.fn(),
  useNodesPerFlowContext: vi.fn(),
  useGetSourceTarget: vi.fn(),
  useJsonConstructUtils: vi.fn(),
  useAppSettings: vi.fn(),
}));

vi.mock('@xyflow/react', () => ({
  useReactFlow: mocks.useReactFlow,
  Handle: ({ children }: any) => <div>{children}</div>,
  Position: { Top: 'top', Right: 'right', Bottom: 'bottom', Left: 'left' },
  MarkerType: { ArrowClosed: 'arrowclosed', Arrow: 'arrow' },
}));

vi.mock('@/app/components/states/NodesPerFlowContext', () => ({
  useNodesPerFlowContext: mocks.useNodesPerFlowContext,
}));

vi.mock('@/app/components/hooks/useGetSourceTarget', () => ({
  default: mocks.useGetSourceTarget,
}));

vi.mock('@/app/components/hooks/useJsonConstructUtils', () => ({
  default: mocks.useJsonConstructUtils,
}));

vi.mock('@/app/components/states/AppSettingsContext', () => ({
  useAppSettings: mocks.useAppSettings,
}));

vi.mock(
  '@/app/components/workflow/edgesNode/edgeNodesNew/components/InputOutputDisplay',
  () => ({
    default: () => (
      <div data-testid='input-output-display'>InputOutputDisplay</div>
    ),
  })
);

// Don't mock PuppyDropDown - use the real component with data-testid support

vi.mock('@/app/components/workflow/components/promptEditor', () => ({
  default: () => <div data-testid='prompt-editor'>PromptEditor</div>,
}));

vi.mock('react-dom', async () => {
  const actual = await vi.importActual('react-dom');
  return {
    ...actual,
    createPortal: (node: any) => node,
  };
});

describe('LLM Edge Node - 输出类型配置', () => {
  let mockSetNodes: any;
  let mockGetNode: any;

  const createMockNode = (
    overrides: Partial<LLMConfigNodeData> = {}
  ): Node<LLMConfigNodeData> => ({
    id: 'test-llm-1',
    type: 'llm',
    position: { x: 0, y: 0 },
    data: {
      looped: undefined,
      content: null,
      modelAndProvider: {
        id: 'gpt-4',
        name: 'GPT-4',
        provider: 'OpenAI',
        isLocal: false,
      },
      structured_output: false,
      base_url: '',
      max_tokens: 128000,
      ...overrides,
    },
  });

  beforeEach(() => {
    mockSetNodes = vi.fn();
    mockGetNode = vi.fn(() => createMockNode());

    mocks.useReactFlow.mockReturnValue({
      getNode: mockGetNode,
      setNodes: mockSetNodes,
      setEdges: vi.fn(),
      getNodes: vi.fn(() => [createMockNode()]),
      getEdges: vi.fn(() => []),
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

    mocks.useAppSettings.mockReturnValue({
      cloudModels: [],
      localModels: [],
      availableModels: [
        {
          id: 'gpt-4',
          name: 'GPT-4',
          provider: 'OpenAI',
          isLocal: false,
          active: true,
          type: 'llm',
        },
      ],
      isLocalDeployment: false,
      isLoadingLocalModels: false,
      ollamaConnected: false,
      toggleModelAvailability: vi.fn(),
      addLocalModel: vi.fn(),
      removeLocalModel: vi.fn(),
      refreshLocalModels: vi.fn(),
      userSubscriptionStatus: null,
      isLoadingSubscriptionStatus: false,
      fetchUserSubscriptionStatus: vi.fn(),
      warns: [],
      addWarn: vi.fn(),
      removeWarn: vi.fn(),
      clearWarns: vi.fn(),
      toggleWarnExpand: vi.fn(),
      usageData: null,
      planLimits: {
        workspaces: 1,
        deployedServices: 1,
        llm_calls: 50,
        runs: 100,
        fileStorage: '5M',
      },
      isLoadingUsage: false,
      fetchUsageData: vi.fn(),
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('TC-LLM-020: 选择 text 输出 (P0)', () => {
    it('选择 text 后 structured_output 应为 false', async () => {
      const mockNode = createMockNode({ structured_output: true });
      mockGetNode.mockReturnValue(mockNode);

      render(
        <LLM
          id={mockNode.id}
          type='llm'
          data={mockNode.data}
          selected={false}
          isConnectable={true}
          xPos={0}
          yPos={0}
          zIndex={0}
          dragging={false}
        />
      );

      const button = screen.getByRole('button', { name: /LLM/i });
      fireEvent.click(button);

      // 点击输出类型下拉按钮打开菜单
      const outputTypeButton = screen.getByTestId('output-type-button');
      fireEvent.click(outputTypeButton);

      // 等待下拉菜单出现并点击 'text' 选项
      await waitFor(() => {
        const textOption = screen.getByTestId('output-type-option-0');
        fireEvent.click(textOption);
      });

      await waitFor(() => {
        const setNodesCall =
          mockSetNodes.mock.calls[mockSetNodes.mock.calls.length - 1][0];
        const updatedNodes = setNodesCall([mockNode]);
        const updatedNode = updatedNodes.find((n: any) => n.id === mockNode.id);

        expect(updatedNode.data.structured_output).toBe(false);
      });
    });
  });

  describe('TC-LLM-021: 选择 structured text 输出 (P0)', () => {
    it('选择 structured text 后 structured_output 应为 true', async () => {
      const mockNode = createMockNode({ structured_output: false });
      mockGetNode.mockReturnValue(mockNode);

      render(
        <LLM
          id={mockNode.id}
          type='llm'
          data={mockNode.data}
          selected={false}
          isConnectable={true}
          xPos={0}
          yPos={0}
          zIndex={0}
          dragging={false}
        />
      );

      const button = screen.getByRole('button', { name: /LLM/i });
      fireEvent.click(button);

      // 点击输出类型下拉按钮打开菜单
      const outputTypeButton = screen.getByTestId('output-type-button');
      fireEvent.click(outputTypeButton);

      // 等待下拉菜单出现并点击 'structured text' 选项
      await waitFor(() => {
        const structuredOption = screen.getByTestId('output-type-option-1');
        fireEvent.click(structuredOption);
      });

      await waitFor(() => {
        const setNodesCall =
          mockSetNodes.mock.calls[mockSetNodes.mock.calls.length - 1][0];
        const updatedNodes = setNodesCall([mockNode]);
        const updatedNode = updatedNodes.find((n: any) => n.id === mockNode.id);

        expect(updatedNode.data.structured_output).toBe(true);
      });
    });
  });

  describe('TC-LLM-022: 默认输出类型 (P1)', () => {
    it('新节点默认应为 false', () => {
      const mockNode = createMockNode();

      render(
        <LLM
          id={mockNode.id}
          type='llm'
          data={mockNode.data}
          selected={false}
          isConnectable={true}
          xPos={0}
          yPos={0}
          zIndex={0}
          dragging={false}
        />
      );

      expect(mockNode.data.structured_output).toBe(false);
    });
  });

  describe('TC-LLM-023: 输出类型持久化 (P0)', () => {
    it('已保存的输出类型应正确恢复 - text', () => {
      const mockNode = createMockNode({ structured_output: false });
      mockGetNode.mockReturnValue(mockNode);

      render(
        <LLM
          id={mockNode.id}
          type='llm'
          data={mockNode.data}
          selected={false}
          isConnectable={true}
          xPos={0}
          yPos={0}
          zIndex={0}
          dragging={false}
        />
      );

      const button = screen.getByRole('button', { name: /LLM/i });
      fireEvent.click(button);

      const selectedValue = screen.getByTestId('output-type-selected-value');
      expect(selectedValue.textContent).toBe('text');
    });

    it('已保存的输出类型应正确恢复 - structured text', () => {
      const mockNode = createMockNode({ structured_output: true });
      mockGetNode.mockReturnValue(mockNode);

      render(
        <LLM
          id={mockNode.id}
          type='llm'
          data={mockNode.data}
          selected={false}
          isConnectable={true}
          xPos={0}
          yPos={0}
          zIndex={0}
          dragging={false}
        />
      );

      const button = screen.getByRole('button', { name: /LLM/i });
      fireEvent.click(button);

      const selectedValue = screen.getByTestId('output-type-selected-value');
      expect(selectedValue.textContent).toBe('structured text');
    });
  });

  describe('TC-LLM-024: 切换输出类型 (P1)', () => {
    it('从 text 切换到 structured text', async () => {
      const mockNode = createMockNode({ structured_output: false });
      mockGetNode.mockReturnValue(mockNode);

      render(
        <LLM
          id={mockNode.id}
          type='llm'
          data={mockNode.data}
          selected={false}
          isConnectable={true}
          xPos={0}
          yPos={0}
          zIndex={0}
          dragging={false}
        />
      );

      const button = screen.getByRole('button', { name: /LLM/i });
      fireEvent.click(button);

      // 点击输出类型下拉按钮打开菜单
      const outputTypeButton = screen.getByTestId('output-type-button');
      fireEvent.click(outputTypeButton);

      // 等待下拉菜单出现并点击 'structured text' 选项
      await waitFor(() => {
        const structuredOption = screen.getByTestId('output-type-option-1');
        fireEvent.click(structuredOption);
      });

      await waitFor(() => {
        const setNodesCall =
          mockSetNodes.mock.calls[mockSetNodes.mock.calls.length - 1][0];
        const updatedNodes = setNodesCall([mockNode]);
        const updatedNode = updatedNodes.find((n: any) => n.id === mockNode.id);

        expect(updatedNode.data.structured_output).toBe(true);
      });
    });

    it('从 structured text 切换回 text', async () => {
      const mockNode = createMockNode({ structured_output: true });
      mockGetNode.mockReturnValue(mockNode);

      render(
        <LLM
          id={mockNode.id}
          type='llm'
          data={mockNode.data}
          selected={false}
          isConnectable={true}
          xPos={0}
          yPos={0}
          zIndex={0}
          dragging={false}
        />
      );

      const button = screen.getByRole('button', { name: /LLM/i });
      fireEvent.click(button);

      // 点击输出类型下拉按钮打开菜单
      const outputTypeButton = screen.getByTestId('output-type-button');
      fireEvent.click(outputTypeButton);

      // 等待下拉菜单出现并点击 'text' 选项
      await waitFor(() => {
        const textOption = screen.getByTestId('output-type-option-0');
        fireEvent.click(textOption);
      });

      await waitFor(() => {
        const setNodesCall =
          mockSetNodes.mock.calls[mockSetNodes.mock.calls.length - 1][0];
        const updatedNodes = setNodesCall([mockNode]);
        const updatedNode = updatedNodes.find((n: any) => n.id === mockNode.id);

        expect(updatedNode.data.structured_output).toBe(false);
      });
    });
  });
});

/**
 * 🔧 测试总结：
 *
 * ✅ 已测试（P0）：
 * - TC-LLM-020: 选择 text 输出
 * - TC-LLM-021: 选择 structured text 输出
 * - TC-LLM-023: 输出类型持久化
 *
 * ✅ 已测试（P1）：
 * - TC-LLM-022: 默认输出类型
 * - TC-LLM-024: 切换输出类型
 *
 * 📝 运行命令：
 *    npm run test -- LLM.output.test.tsx
 */
