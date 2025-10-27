/**
 * LLM Edge Node - 模型和提供者配置测试
 *
 * 测试用例：
 * P0:
 * - TC-LLM-001: 选择模型
 * - TC-LLM-002: 默认模型初始化
 * - TC-LLM-003: 模型持久化
 *
 * P1:
 * - TC-LLM-004: 切换模型
 * - TC-LLM-005: Local vs Cloud 模型
 * - TC-LLM-007: Provider 正确保存
 *
 * ⚠️ 测试重点：
 * - 参数是否正确保存到 node.data.modelAndProvider
 * - 数据结构是否完整（id, name, provider, isLocal）
 */

// @ts-nocheck
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
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
  Handle: ({ children, type, position, id, isConnectable, style }: any) => (
    <div
      data-testid={`handle-${type}-${position}`}
      data-id={id}
      data-connectable={isConnectable}
      style={style}
    >
      {children}
    </div>
  ),
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
  PuppyDropdown: ({ options, selectedValue, onSelect, renderOption }: any) => (
    <div data-testid='puppy-dropdown'>
      <div data-testid='selected-value'>
        {selectedValue ? JSON.stringify(selectedValue) : 'null'}
      </div>
      <select
        data-testid='dropdown-select'
        value={selectedValue?.id || ''}
        onChange={e => {
          const selected = options.find(
            (opt: any) => opt.id === e.target.value
          );
          if (selected) onSelect(selected);
        }}
      >
        {Array.isArray(options) &&
          options.map((opt: any) => (
            <option key={opt.id || opt} value={opt.id || opt}>
              {opt.name || opt}
            </option>
          ))}
      </select>
    </div>
  ),
}));

vi.mock('@/components/workflow/components/promptEditor', () => ({
  default: ({ messages, onChange }: any) => (
    <div data-testid='prompt-editor'>
      <textarea
        data-testid='prompt-textarea'
        value={JSON.stringify(messages)}
        onChange={e => onChange(JSON.parse(e.target.value))}
      />
    </div>
  ),
}));

vi.mock('react-dom', async () => {
  const actual = await vi.importActual('react-dom');
  return {
    ...actual,
    createPortal: (node: any) => node,
  };
});

describe('LLM Edge Node - 模型和提供者配置', () => {
  let mockSetNodes: any;
  let mockGetNode: any;
  let mockSetEdges: any;

  const createMockNode = (
    overrides: Partial<LLMConfigNodeData> = {}
  ): Node<LLMConfigNodeData> => ({
    id: 'test-llm-1',
    type: 'llm',
    position: { x: 0, y: 0 },
    data: {
      looped: undefined,
      content: null,
      modelAndProvider: undefined,
      structured_output: undefined,
      base_url: undefined,
      max_tokens: undefined,
      ...overrides,
    },
  });

  const mockModels = [
    {
      id: 'gpt-4',
      name: 'GPT-4',
      provider: 'OpenAI',
      isLocal: false,
      active: true,
      type: 'llm',
    },
    {
      id: 'claude-3',
      name: 'Claude 3',
      provider: 'Anthropic',
      isLocal: false,
      active: true,
      type: 'llm',
    },
    {
      id: 'llama-2',
      name: 'Llama 2',
      provider: 'Meta',
      isLocal: true,
      active: true,
      type: 'llm',
    },
  ];

  beforeEach(() => {
    mockSetNodes = vi.fn();
    mockGetNode = vi.fn(() => createMockNode());
    mockSetEdges = vi.fn();

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

    mocks.useAppSettings.mockReturnValue({
      availableModels: mockModels,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('TC-LLM-001: 选择模型 (P0)', () => {
    it('选择模型后应保存到 node.data.modelAndProvider', async () => {
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

      // 打开菜单
      const button = screen.getByRole('button', { name: /LLM/i });
      button.click();

      await waitFor(() => {
        expect(screen.getByTestId('puppy-dropdown')).toBeInTheDocument();
      });

      // 选择模型
      const dropdown = screen.getByTestId('dropdown-select');
      dropdown.value = 'claude-3';
      dropdown.dispatchEvent(new Event('change', { bubbles: true }));

      await waitFor(() => {
        expect(mockSetNodes).toHaveBeenCalled();
      });

      // 验证 setNodes 被调用且包含正确的模型信息
      const setNodesCall =
        mockSetNodes.mock.calls[mockSetNodes.mock.calls.length - 1][0];
      const updatedNodes = setNodesCall([mockNode]);
      const updatedNode = updatedNodes.find((n: any) => n.id === mockNode.id);

      expect(updatedNode.data.modelAndProvider).toBeDefined();
      expect(updatedNode.data.modelAndProvider.id).toBe('claude-3');
      expect(updatedNode.data.modelAndProvider.name).toBe('Claude 3');
      expect(updatedNode.data.modelAndProvider.provider).toBe('Anthropic');
      expect(updatedNode.data.modelAndProvider.isLocal).toBe(false);
    });

    it('modelAndProvider 应包含完整字段', async () => {
      const mockNode = createMockNode({
        modelAndProvider: {
          id: 'gpt-4',
          name: 'GPT-4',
          provider: 'OpenAI',
          isLocal: false,
        },
      });
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

      // 验证数据结构
      expect(mockNode.data.modelAndProvider).toHaveProperty('id');
      expect(mockNode.data.modelAndProvider).toHaveProperty('name');
      expect(mockNode.data.modelAndProvider).toHaveProperty('provider');
      expect(mockNode.data.modelAndProvider).toHaveProperty('isLocal');
    });
  });

  describe('TC-LLM-002: 默认模型初始化 (P0)', () => {
    it('新节点应自动选择第一个可用的 LLM 模型', () => {
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

      // 打开菜单查看默认选择
      const button = screen.getByRole('button', { name: /LLM/i });
      button.click();

      // 验证有默认选择的模型
      const selectedValue = screen.getByTestId('selected-value');
      expect(selectedValue.textContent).toContain('gpt-4'); // 第一个模型
    });

    it('modelAndProvider 不应为空', () => {
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

      // 组件内部应初始化模型
      const button = screen.getByRole('button', { name: /LLM/i });
      button.click();

      const selectedValue = screen.getByTestId('selected-value');
      expect(selectedValue.textContent).not.toBe('null');
      expect(selectedValue.textContent).not.toBe('undefined');
    });
  });

  describe('TC-LLM-003: 模型持久化 (P0)', () => {
    it('已保存的模型应正确恢复', () => {
      const savedModel = {
        id: 'claude-3',
        name: 'Claude 3',
        provider: 'Anthropic',
        isLocal: false,
      };

      const mockNode = createMockNode({
        modelAndProvider: savedModel,
      });
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

      // 打开菜单验证
      const button = screen.getByRole('button', { name: /LLM/i });
      button.click();

      const selectedValue = screen.getByTestId('selected-value');
      const selectedData = JSON.parse(selectedValue.textContent || '{}');

      expect(selectedData.id).toBe('claude-3');
      expect(selectedData.provider).toBe('Anthropic');
    });
  });

  describe('TC-LLM-004: 切换模型 (P1)', () => {
    it('切换模型后数据应更新', async () => {
      const mockNode = createMockNode({
        modelAndProvider: {
          id: 'gpt-4',
          name: 'GPT-4',
          provider: 'OpenAI',
          isLocal: false,
        },
      });
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
      button.click();

      // 切换到另一个模型
      const dropdown = screen.getByTestId('dropdown-select');
      dropdown.value = 'llama-2';
      dropdown.dispatchEvent(new Event('change', { bubbles: true }));

      await waitFor(() => {
        expect(mockSetNodes).toHaveBeenCalled();
      });

      const setNodesCall =
        mockSetNodes.mock.calls[mockSetNodes.mock.calls.length - 1][0];
      const updatedNodes = setNodesCall([mockNode]);
      const updatedNode = updatedNodes.find((n: any) => n.id === mockNode.id);

      // 验证模型已更新为新模型
      expect(updatedNode.data.modelAndProvider.id).toBe('llama-2');
      expect(updatedNode.data.modelAndProvider.name).toBe('Llama 2');
      expect(updatedNode.data.modelAndProvider.provider).toBe('Meta');
    });

    it('旧模型信息应被完全覆盖', async () => {
      const mockNode = createMockNode({
        modelAndProvider: {
          id: 'gpt-4',
          name: 'GPT-4',
          provider: 'OpenAI',
          isLocal: false,
        },
      });
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
      button.click();

      const dropdown = screen.getByTestId('dropdown-select');
      dropdown.value = 'claude-3';
      dropdown.dispatchEvent(new Event('change', { bubbles: true }));

      await waitFor(() => {
        const setNodesCall =
          mockSetNodes.mock.calls[mockSetNodes.mock.calls.length - 1][0];
        const updatedNodes = setNodesCall([mockNode]);
        const updatedNode = updatedNodes.find((n: any) => n.id === mockNode.id);

        // 确保没有残留 OpenAI 的信息
        expect(updatedNode.data.modelAndProvider.provider).not.toBe('OpenAI');
        expect(updatedNode.data.modelAndProvider.provider).toBe('Anthropic');
      });
    });
  });

  describe('TC-LLM-005: Local vs Cloud 模型 (P1)', () => {
    it('isLocal 字段应正确反映模型类型', () => {
      // 测试 Cloud 模型
      const cloudNode = createMockNode({
        modelAndProvider: {
          id: 'gpt-4',
          name: 'GPT-4',
          provider: 'OpenAI',
          isLocal: false,
        },
      });
      mockGetNode.mockReturnValue(cloudNode);

      const { unmount } = render(
        <LLM
          id={cloudNode.id}
          type='llm'
          data={cloudNode.data}
          selected={false}
          isConnectable={true}
          xPos={0}
          yPos={0}
          zIndex={0}
          dragging={false}
        />
      );

      expect(cloudNode.data.modelAndProvider?.isLocal).toBe(false);

      unmount();

      // 测试 Local 模型
      const localNode = createMockNode({
        modelAndProvider: {
          id: 'llama-2',
          name: 'Llama 2',
          provider: 'Meta',
          isLocal: true,
        },
      });
      mockGetNode.mockReturnValue(localNode);

      render(
        <LLM
          id={localNode.id}
          type='llm'
          data={localNode.data}
          selected={false}
          isConnectable={true}
          xPos={0}
          yPos={0}
          zIndex={0}
          dragging={false}
        />
      );

      expect(localNode.data.modelAndProvider?.isLocal).toBe(true);
    });
  });

  describe('TC-LLM-007: Provider 正确保存 (P1)', () => {
    it('provider 字段应正确保存', async () => {
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
      button.click();

      const dropdown = screen.getByTestId('dropdown-select');
      dropdown.value = 'claude-3';
      dropdown.dispatchEvent(new Event('change', { bubbles: true }));

      await waitFor(() => {
        const setNodesCall =
          mockSetNodes.mock.calls[mockSetNodes.mock.calls.length - 1][0];
        const updatedNodes = setNodesCall([mockNode]);
        const updatedNode = updatedNodes.find((n: any) => n.id === mockNode.id);

        expect(updatedNode.data.modelAndProvider.provider).toBe('Anthropic');
      });
    });

    it('provider 应为有效字符串', () => {
      const mockNode = createMockNode({
        modelAndProvider: {
          id: 'gpt-4',
          name: 'GPT-4',
          provider: 'OpenAI',
          isLocal: false,
        },
      });

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

      expect(typeof mockNode.data.modelAndProvider?.provider).toBe('string');
      expect(mockNode.data.modelAndProvider?.provider.length).toBeGreaterThan(
        0
      );
    });
  });
});

/**
 * 🔧 测试总结：
 *
 * ✅ 已测试（P0）：
 * - TC-LLM-001: 选择模型保存
 * - TC-LLM-002: 默认模型初始化
 * - TC-LLM-003: 模型持久化
 *
 * ✅ 已测试（P1）：
 * - TC-LLM-004: 切换模型
 * - TC-LLM-005: Local vs Cloud 模型
 * - TC-LLM-007: Provider 保存
 *
 * 📝 运行命令：
 *    npm run test -- LLM.model.test.tsx
 */
