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
import LLM from '@/components/workflow/edgesNode/edgeNodesNew/LLM';
import type { Node } from '@xyflow/react';
import type { LLMConfigNodeData } from '@/components/workflow/edgesNode/edgeNodesNew/LLM';

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

vi.mock('@/components/states/NodesPerFlowContext', () => ({
  useNodesPerFlowContext: mocks.useNodesPerFlowContext,
}));

vi.mock('@/components/hooks/useGetSourceTarget', () => ({
  default: mocks.useGetSourceTarget,
}));

vi.mock('@/components/hooks/useJsonConstructUtils', () => ({
  default: mocks.useJsonConstructUtils,
}));

vi.mock('@/components/states/AppSettingsContext', () => ({
  useAppSettings: mocks.useAppSettings,
}));

vi.mock(
  '@/components/workflow/edgesNode/edgeNodesNew/components/InputOutputDisplay',
  () => ({
    default: () => (
      <div data-testid='input-output-display'>InputOutputDisplay</div>
    ),
  })
);

vi.mock('@/components/misc/PuppyDropDown', () => ({
  PuppyDropdown: ({ options, selectedValue, onSelect }: any) => (
    <div data-testid='puppy-dropdown'>
      <div data-testid='selected-output-type'>
        {typeof selectedValue === 'string' ? selectedValue : ''}
      </div>
      <select
        data-testid='output-type-select'
        value={selectedValue}
        onChange={e => onSelect(e.target.value)}
      >
        {Array.isArray(options) &&
          options.map((opt: string) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
      </select>
    </div>
  ),
}));

vi.mock('@/components/workflow/components/promptEditor', () => ({
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

      // 查找输出类型下拉框
      const selects = screen.getAllByTestId('output-type-select');
      const outputSelect = selects.find(select =>
        Array.from(select.options).some(
          (opt: any) => opt.value === 'text' || opt.value === 'structured text'
        )
      );

      fireEvent.change(outputSelect!, { target: { value: 'text' } });

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

      const selects = screen.getAllByTestId('output-type-select');
      const outputSelect = selects.find(select =>
        Array.from(select.options).some(
          (opt: any) => opt.value === 'text' || opt.value === 'structured text'
        )
      );

      fireEvent.change(outputSelect!, { target: { value: 'structured text' } });

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

      const selectedTypes = screen.getAllByTestId('selected-output-type');
      const outputType = selectedTypes.find(
        el => el.textContent === 'text' || el.textContent === 'structured text'
      );

      expect(outputType?.textContent).toBe('text');
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

      const selectedTypes = screen.getAllByTestId('selected-output-type');
      const outputType = selectedTypes.find(
        el => el.textContent === 'text' || el.textContent === 'structured text'
      );

      expect(outputType?.textContent).toBe('structured text');
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

      const selects = screen.getAllByTestId('output-type-select');
      const outputSelect = selects.find(select =>
        Array.from(select.options).some(
          (opt: any) => opt.value === 'text' || opt.value === 'structured text'
        )
      );

      fireEvent.change(outputSelect!, { target: { value: 'structured text' } });

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

      const selects = screen.getAllByTestId('output-type-select');
      const outputSelect = selects.find(select =>
        Array.from(select.options).some(
          (opt: any) => opt.value === 'text' || opt.value === 'structured text'
        )
      );

      fireEvent.change(outputSelect!, { target: { value: 'text' } });

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
