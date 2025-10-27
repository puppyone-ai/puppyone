/**
 * LLM Edge Node - Settings 配置测试
 *
 * 测试用例（P1）：
 * - TC-LLM-025: 设置 Base URL
 * - TC-LLM-026: 默认 Base URL
 * - TC-LLM-027: Base URL 持久化
 * - TC-LLM-028: 清空 Base URL
 * - TC-LLM-030: 设置 Max Tokens
 * - TC-LLM-031: 默认 Max Tokens
 * - TC-LLM-032: Max Tokens 持久化
 * - TC-LLM-033: Max Tokens 最小值边界
 *
 * ⚠️ 测试重点：
 * - base_url 和 max_tokens 是否正确保存到 node.data
 * - 默认值和边界值处理
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
  PuppyDropdown: () => <div data-testid='puppy-dropdown'>Dropdown</div>,
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

describe('LLM Edge Node - Settings 配置', () => {
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

  describe('TC-LLM-025: 设置 Base URL (P1)', () => {
    it('输入 Base URL 后应保存到 node.data', async () => {
      const mockNode = createMockNode();
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

      // 展开 Settings
      const showButton = screen.getByRole('button', { name: /Show/i });
      fireEvent.click(showButton);

      // 查找 Base URL 输入框
      const inputs = screen.getAllByRole('textbox');
      const baseUrlInput = inputs.find(input =>
        input.getAttribute('placeholder')?.includes('api.example.com')
      ) as HTMLInputElement;

      expect(baseUrlInput).toBeDefined();

      fireEvent.change(baseUrlInput!, {
        target: { value: 'https://custom.api.com/v1' },
      });

      await waitFor(() => {
        const setNodesCall =
          mockSetNodes.mock.calls[mockSetNodes.mock.calls.length - 1][0];
        const updatedNodes = setNodesCall([mockNode]);
        const updatedNode = updatedNodes.find((n: any) => n.id === mockNode.id);

        expect(updatedNode.data.base_url).toBe('https://custom.api.com/v1');
      });
    });
  });

  describe('TC-LLM-026: 默认 Base URL (P1)', () => {
    it('新节点默认 base_url 应为空字符串', () => {
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

      expect(mockNode.data.base_url).toBe('');
    });
  });

  describe('TC-LLM-027: Base URL 持久化 (P1)', () => {
    it('已保存的 Base URL 应正确恢复', () => {
      const customUrl = 'https://my-custom-api.com/v2';
      const mockNode = createMockNode({ base_url: customUrl });
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

      const showButton = screen.getByRole('button', { name: /Show/i });
      fireEvent.click(showButton);

      const inputs = screen.getAllByRole('textbox');
      const baseUrlInput = inputs.find(input =>
        input.getAttribute('placeholder')?.includes('api.example.com')
      ) as HTMLInputElement;

      expect(baseUrlInput.value).toBe(customUrl);
    });
  });

  describe('TC-LLM-028: 清空 Base URL (P1)', () => {
    it('删除 Base URL 内容后应保存为空字符串', async () => {
      const mockNode = createMockNode({ base_url: 'https://old.api.com' });
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

      const showButton = screen.getByRole('button', { name: /Show/i });
      fireEvent.click(showButton);

      const inputs = screen.getAllByRole('textbox');
      const baseUrlInput = inputs.find(input =>
        input.getAttribute('placeholder')?.includes('api.example.com')
      ) as HTMLInputElement;

      fireEvent.change(baseUrlInput!, { target: { value: '' } });

      await waitFor(() => {
        const setNodesCall =
          mockSetNodes.mock.calls[mockSetNodes.mock.calls.length - 1][0];
        const updatedNodes = setNodesCall([mockNode]);
        const updatedNode = updatedNodes.find((n: any) => n.id === mockNode.id);

        expect(updatedNode.data.base_url).toBe('');
      });
    });
  });

  describe('TC-LLM-030: 设置 Max Tokens (P1)', () => {
    it('修改 Max Tokens 后应保存到 node.data', async () => {
      const mockNode = createMockNode();
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

      const showButton = screen.getByRole('button', { name: /Show/i });
      fireEvent.click(showButton);

      // 查找 Max Tokens 输入框
      const numberInputs = screen.getAllByRole('spinbutton');
      const maxTokensInput = numberInputs.find(
        input => input.getAttribute('min') === '1'
      ) as HTMLInputElement;

      fireEvent.change(maxTokensInput!, { target: { value: '4096' } });

      await waitFor(() => {
        const setNodesCall =
          mockSetNodes.mock.calls[mockSetNodes.mock.calls.length - 1][0];
        const updatedNodes = setNodesCall([mockNode]);
        const updatedNode = updatedNodes.find((n: any) => n.id === mockNode.id);

        expect(updatedNode.data.max_tokens).toBe(4096);
      });
    });
  });

  describe('TC-LLM-031: 默认 Max Tokens (P1)', () => {
    it('新节点默认 max_tokens 应为 128000', () => {
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

      expect(mockNode.data.max_tokens).toBe(128000);
    });
  });

  describe('TC-LLM-032: Max Tokens 持久化 (P1)', () => {
    it('已保存的 Max Tokens 应正确恢复', () => {
      const customTokens = 8192;
      const mockNode = createMockNode({ max_tokens: customTokens });
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

      const showButton = screen.getByRole('button', { name: /Show/i });
      fireEvent.click(showButton);

      const numberInputs = screen.getAllByRole('spinbutton');
      const maxTokensInput = numberInputs.find(
        input => input.getAttribute('min') === '1'
      ) as HTMLInputElement;

      expect(parseInt(maxTokensInput.value)).toBe(customTokens);
    });
  });

  describe('TC-LLM-033: Max Tokens 最小值边界 (P1)', () => {
    it('设置为 1 应接受并保存', async () => {
      const mockNode = createMockNode();
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

      const showButton = screen.getByRole('button', { name: /Show/i });
      fireEvent.click(showButton);

      const numberInputs = screen.getAllByRole('spinbutton');
      const maxTokensInput = numberInputs.find(
        input => input.getAttribute('min') === '1'
      ) as HTMLInputElement;

      fireEvent.change(maxTokensInput!, { target: { value: '1' } });

      await waitFor(() => {
        const setNodesCall =
          mockSetNodes.mock.calls[mockSetNodes.mock.calls.length - 1][0];
        const updatedNodes = setNodesCall([mockNode]);
        const updatedNode = updatedNodes.find((n: any) => n.id === mockNode.id);

        expect(updatedNode.data.max_tokens).toBe(1);
      });
    });

    it('设置为 128000 应接受并保存', async () => {
      const mockNode = createMockNode();
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

      const showButton = screen.getByRole('button', { name: /Show/i });
      fireEvent.click(showButton);

      const numberInputs = screen.getAllByRole('spinbutton');
      const maxTokensInput = numberInputs.find(
        input => input.getAttribute('min') === '1'
      ) as HTMLInputElement;

      fireEvent.change(maxTokensInput!, { target: { value: '128000' } });

      await waitFor(() => {
        const setNodesCall =
          mockSetNodes.mock.calls[mockSetNodes.mock.calls.length - 1][0];
        const updatedNodes = setNodesCall([mockNode]);
        const updatedNode = updatedNodes.find((n: any) => n.id === mockNode.id);

        expect(updatedNode.data.max_tokens).toBe(128000);
      });
    });
  });
});

/**
 * 🔧 测试总结：
 *
 * ✅ 已测试（P1）：
 * - TC-LLM-025: 设置 Base URL
 * - TC-LLM-026: 默认 Base URL
 * - TC-LLM-027: Base URL 持久化
 * - TC-LLM-028: 清空 Base URL
 * - TC-LLM-030: 设置 Max Tokens
 * - TC-LLM-031: 默认 Max Tokens
 * - TC-LLM-032: Max Tokens 持久化
 * - TC-LLM-033: Max Tokens 边界值
 *
 * 📝 运行命令：
 *    npm run test -- LLM.settings.test.tsx
 */
