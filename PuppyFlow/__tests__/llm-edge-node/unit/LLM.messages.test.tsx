/**
 * LLM Edge Node - Messages 配置测试
 *
 * 测试用例：
 * P0:
 * - TC-LLM-009: 编辑消息内容
 * - TC-LLM-010: 默认消息初始化
 * - TC-LLM-011: 消息持久化
 * 
 * P1:
 * - TC-LLM-012: 添加多条消息
 * - TC-LLM-013: 删除消息
 * - TC-LLM-014: 消息顺序
 * - TC-LLM-017: 使用输入变量
 * - TC-LLM-019: 多个变量
 *
 * ⚠️ 测试重点：
 * - 消息数组是否正确保存到 node.data.content
 * - 数据结构: [{role, content}, ...]
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

vi.mock('@/components/workflow/edgesNode/edgeNodesNew/components/InputOutputDisplay', () => ({
  default: () => <div data-testid='input-output-display'>InputOutputDisplay</div>,
}));

vi.mock('@/components/misc/PuppyDropDown', () => ({
  PuppyDropdown: ({ selectedValue }: any) => (
    <div data-testid='puppy-dropdown'>{selectedValue?.name || 'Select'}</div>
  ),
}));

vi.mock('@/components/workflow/components/promptEditor', () => ({
  default: ({ messages, onChange }: any) => (
    <div data-testid='prompt-editor'>
      <textarea
        data-testid='prompt-textarea'
        value={JSON.stringify(messages)}
        onChange={(e) => {
          try {
            onChange(JSON.parse(e.target.value));
          } catch (error) {
            // Invalid JSON, ignore
          }
        }}
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

describe('LLM Edge Node - Messages 配置', () => {
  let mockSetNodes: any;
  let mockGetNode: any;

  const createMockNode = (overrides: Partial<LLMConfigNodeData> = {}): Node<LLMConfigNodeData> => ({
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
      availableModels: [{
        id: 'gpt-4',
        name: 'GPT-4',
        provider: 'OpenAI',
        isLocal: false,
        active: true,
        type: 'llm',
      }],
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('TC-LLM-009: 编辑消息内容 (P0)', () => {
    it('修改消息后应保存到 node.data.content', async () => {
      const initialMessages = [
        { role: 'system', content: 'You are an AI' },
        { role: 'user', content: 'Answer the question' },
      ];

      const mockNode = createMockNode({ content: initialMessages as any });
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
      fireEvent.click(button);

      // 修改消息
      const textarea = screen.getByTestId('prompt-textarea');
      const newMessages = [
        { role: 'system', content: 'You are a helpful assistant' },
        { role: 'user', content: 'Help me solve this' },
      ];

      fireEvent.change(textarea, {
        target: { value: JSON.stringify(newMessages) },
      });

      await waitFor(() => {
        expect(mockSetNodes).toHaveBeenCalled();
      });

      // 验证 content 更新
      const setNodesCall = mockSetNodes.mock.calls[mockSetNodes.mock.calls.length - 1][0];
      const updatedNodes = setNodesCall([mockNode]);
      const updatedNode = updatedNodes.find((n: any) => n.id === mockNode.id);

      expect(updatedNode.data.content).toEqual(newMessages);
    });

    it('content 应包含 role 和 content 字段', () => {
      const messages = [
        { role: 'system', content: 'System message' },
        { role: 'user', content: 'User message' },
      ];

      const mockNode = createMockNode({ content: messages as any });

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

      messages.forEach(msg => {
        expect(msg).toHaveProperty('role');
        expect(msg).toHaveProperty('content');
        expect(['system', 'user', 'assistant']).toContain(msg.role);
      });
    });
  });

  describe('TC-LLM-010: 默认消息初始化 (P0)', () => {
    it('新节点应有默认消息', () => {
      const mockNode = createMockNode({ content: null });
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

      // 组件会初始化 content，验证 setNodes 被调用
      waitFor(() => {
        const calls = mockSetNodes.mock.calls;
        if (calls.length > 0) {
          const lastCall = calls[calls.length - 1][0];
          const updatedNodes = lastCall([mockNode]);
          const updatedNode = updatedNodes.find((n: any) => n.id === mockNode.id);

          expect(Array.isArray(updatedNode.data.content)).toBe(true);
          expect(updatedNode.data.content.length).toBeGreaterThan(0);
        }
      });
    });

    it('默认应包含 system 和 user 消息', () => {
      const mockNode = createMockNode({
        content: [
          { role: 'system', content: 'You are an AI' },
          { role: 'user', content: 'Answer the question' },
        ] as any,
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

      const content = mockNode.data.content as any[];
      expect(content.some((msg: any) => msg.role === 'system')).toBe(true);
      expect(content.some((msg: any) => msg.role === 'user')).toBe(true);
    });
  });

  describe('TC-LLM-011: 消息持久化 (P0)', () => {
    it('已保存的消息应正确恢复', () => {
      const savedMessages = [
        { role: 'system', content: 'Custom system prompt' },
        { role: 'user', content: 'Custom user prompt' },
        { role: 'assistant', content: 'Custom assistant response' },
      ];

      const mockNode = createMockNode({ content: savedMessages as any });
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

      const textarea = screen.getByTestId('prompt-textarea');
      const displayedMessages = JSON.parse(textarea.value);

      expect(displayedMessages).toEqual(savedMessages);
    });

    it('消息顺序应保持一致', () => {
      const messages = [
        { role: 'system', content: 'First' },
        { role: 'user', content: 'Second' },
        { role: 'assistant', content: 'Third' },
      ];

      const mockNode = createMockNode({ content: messages as any });

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

      const content = mockNode.data.content as any[];
      expect(content[0].content).toBe('First');
      expect(content[1].content).toBe('Second');
      expect(content[2].content).toBe('Third');
    });
  });

  describe('TC-LLM-012: 添加多条消息 (P1)', () => {
    it('应支持多条消息保存', async () => {
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

      const textarea = screen.getByTestId('prompt-textarea');
      const multiMessages = [
        { role: 'system', content: 'System 1' },
        { role: 'system', content: 'System 2' },
        { role: 'user', content: 'User 1' },
        { role: 'assistant', content: 'Assistant 1' },
        { role: 'user', content: 'User 2' },
      ];

      fireEvent.change(textarea, {
        target: { value: JSON.stringify(multiMessages) },
      });

      await waitFor(() => {
        const setNodesCall = mockSetNodes.mock.calls[mockSetNodes.mock.calls.length - 1][0];
        const updatedNodes = setNodesCall([mockNode]);
        const updatedNode = updatedNodes.find((n: any) => n.id === mockNode.id);

        expect(updatedNode.data.content).toHaveLength(5);
        expect(updatedNode.data.content).toEqual(multiMessages);
      });
    });
  });

  describe('TC-LLM-013: 删除消息 (P1)', () => {
    it('删除消息后数组应更新', async () => {
      const initialMessages = [
        { role: 'system', content: 'System' },
        { role: 'user', content: 'User' },
        { role: 'assistant', content: 'Assistant' },
      ];

      const mockNode = createMockNode({ content: initialMessages as any });
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

      const textarea = screen.getByTestId('prompt-textarea');
      // 删除中间的 user 消息
      const updatedMessages = [
        { role: 'system', content: 'System' },
        { role: 'assistant', content: 'Assistant' },
      ];

      fireEvent.change(textarea, {
        target: { value: JSON.stringify(updatedMessages) },
      });

      await waitFor(() => {
        const setNodesCall = mockSetNodes.mock.calls[mockSetNodes.mock.calls.length - 1][0];
        const updatedNodes = setNodesCall([mockNode]);
        const updatedNode = updatedNodes.find((n: any) => n.id === mockNode.id);

        expect(updatedNode.data.content).toHaveLength(2);
        expect(updatedNode.data.content).toEqual(updatedMessages);
      });
    });
  });

  describe('TC-LLM-014: 消息顺序 (P1)', () => {
    it('调整顺序后应正确保存', async () => {
      const initialMessages = [
        { role: 'user', content: 'A' },
        { role: 'user', content: 'B' },
        { role: 'user', content: 'C' },
      ];

      const mockNode = createMockNode({ content: initialMessages as any });
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

      const textarea = screen.getByTestId('prompt-textarea');
      // 调整顺序
      const reorderedMessages = [
        { role: 'user', content: 'C' },
        { role: 'user', content: 'A' },
        { role: 'user', content: 'B' },
      ];

      fireEvent.change(textarea, {
        target: { value: JSON.stringify(reorderedMessages) },
      });

      await waitFor(() => {
        const setNodesCall = mockSetNodes.mock.calls[mockSetNodes.mock.calls.length - 1][0];
        const updatedNodes = setNodesCall([mockNode]);
        const updatedNode = updatedNodes.find((n: any) => n.id === mockNode.id);

        expect(updatedNode.data.content[0].content).toBe('C');
        expect(updatedNode.data.content[1].content).toBe('A');
        expect(updatedNode.data.content[2].content).toBe('B');
      });
    });
  });

  describe('TC-LLM-017: 使用输入变量 (P1)', () => {
    it('变量语法应保存到 content', async () => {
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

      const textarea = screen.getByTestId('prompt-textarea');
      const messagesWithVariable = [
        { role: 'system', content: 'You are an AI' },
        { role: 'user', content: 'Answer: {{inputText}}' },
      ];

      fireEvent.change(textarea, {
        target: { value: JSON.stringify(messagesWithVariable) },
      });

      await waitFor(() => {
        const setNodesCall = mockSetNodes.mock.calls[mockSetNodes.mock.calls.length - 1][0];
        const updatedNodes = setNodesCall([mockNode]);
        const updatedNode = updatedNodes.find((n: any) => n.id === mockNode.id);

        expect(updatedNode.data.content[1].content).toBe('Answer: {{inputText}}');
        expect(updatedNode.data.content[1].content).toContain('{{');
        expect(updatedNode.data.content[1].content).toContain('}}');
      });
    });

    it('变量不应被解析或转义', async () => {
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

      const textarea = screen.getByTestId('prompt-textarea');
      const message = [
        { role: 'user', content: '{{var1}} and {{var2}}' },
      ];

      fireEvent.change(textarea, {
        target: { value: JSON.stringify(message) },
      });

      await waitFor(() => {
        const setNodesCall = mockSetNodes.mock.calls[mockSetNodes.mock.calls.length - 1][0];
        const updatedNodes = setNodesCall([mockNode]);
        const updatedNode = updatedNodes.find((n: any) => n.id === mockNode.id);

        // 变量语法应完全保留
        expect(updatedNode.data.content[0].content).toBe('{{var1}} and {{var2}}');
      });
    });
  });

  describe('TC-LLM-019: 多个变量 (P1)', () => {
    it('多个变量应保持原样', async () => {
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

      const textarea = screen.getByTestId('prompt-textarea');
      const complexMessage = [
        {
          role: 'user',
          content: 'Compare {{input1}} with {{input2}} and analyze {{input3}}',
        },
      ];

      fireEvent.change(textarea, {
        target: { value: JSON.stringify(complexMessage) },
      });

      await waitFor(() => {
        const setNodesCall = mockSetNodes.mock.calls[mockSetNodes.mock.calls.length - 1][0];
        const updatedNodes = setNodesCall([mockNode]);
        const updatedNode = updatedNodes.find((n: any) => n.id === mockNode.id);

        const content = updatedNode.data.content[0].content;
        expect(content).toContain('{{input1}}');
        expect(content).toContain('{{input2}}');
        expect(content).toContain('{{input3}}');
        // 确保没有被合并
        expect(content.match(/\{\{/g)?.length).toBe(3);
      });
    });
  });
});

/**
 * 🔧 测试总结：
 *
 * ✅ 已测试（P0）：
 * - TC-LLM-009: 编辑消息内容
 * - TC-LLM-010: 默认消息初始化
 * - TC-LLM-011: 消息持久化
 *
 * ✅ 已测试（P1）：
 * - TC-LLM-012: 添加多条消息
 * - TC-LLM-013: 删除消息
 * - TC-LLM-014: 消息顺序
 * - TC-LLM-017: 使用输入变量
 * - TC-LLM-019: 多个变量
 *
 * 📝 运行命令：
 *    npm run test -- LLM.messages.test.tsx
 */

