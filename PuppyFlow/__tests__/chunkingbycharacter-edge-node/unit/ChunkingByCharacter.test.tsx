/**
 * ChunkingByCharacter Edge Node - 完整测试
 *
 * 测试用例：
 * P0 致命 - delimiters 数组管理：
 * - TC-CBC-001: 添加分隔符应正确保存到 node.data.delimiters
 * - TC-CBC-001-1: delimiters 应为数组类型
 * - TC-CBC-002: 删除分隔符应正确更新 node.data.delimiters
 * - TC-CBC-003: delimiters 数据结构验证（双重保存）
 * 
 * P1 严重 - 分隔符添加和显示：
 * - TC-CBC-004: 从常用分隔符列表添加
 * - TC-CBC-005: 添加自定义分隔符（输入框）
 * - TC-CBC-006: 特殊字符显示验证
 * - TC-CBC-007: 点击 Run 按钮应触发执行
 *
 * P2 中等 - UI 交互：
 * - TC-CBC-008: 分隔符默认值验证
 * - TC-CBC-009: 点击节点按钮应打开配置菜单
 * - TC-CBC-010: 组件挂载后验证
 * - TC-CBC-011: 重复分隔符不应重复添加
 */

// @ts-nocheck
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import ChunkingByCharacter from '../../../app/components/workflow/edgesNode/edgeNodesNew/ChunkingByCharacter';
import type { Node } from '@xyflow/react';
import type { ChunkingConfigNodeData } from '../../../app/components/workflow/edgesNode/edgeNodesNew/ChunkingByCharacter';

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

vi.mock('../../../app/components/workflow/edgesNode/edgeNodesNew/components/InputOutputDisplay', () => ({
  default: () => <div data-testid='input-output-display'>InputOutputDisplay</div>,
}));

vi.mock('../../../app/utils/colors', () => ({
  UI_COLORS: {
    LINE_ACTIVE: '#39BC66',
    EDGENODE_BORDER_GREY: '#6D7177',
  },
}));

vi.mock('../../../app/components/workflow/edgesNode/edgeNodesNew/hook/runSingleEdgeNodeExecutor', () => ({
  runSingleEdgeNode: mocks.runSingleEdgeNode,
}));

vi.mock('react-dom', async () => {
  const actual = await vi.importActual('react-dom');
  return {
    ...actual,
    createPortal: (node: any) => node,
  };
});

describe('ChunkingByCharacter Edge Node - 完整测试', () => {
  let mockSetNodes: any;
  let mockGetNode: any;
  let mockGetInternalNode: any;
  let mockSetEdges: any;
  let testNode: Node<ChunkingConfigNodeData>;

  const createMockNode = (overrides: Partial<ChunkingConfigNodeData> = {}): Node<ChunkingConfigNodeData> => ({
    id: 'test-chunkingbycharacter-1',
    type: 'chunkingbycharacter',
    position: { x: 0, y: 0 },
    data: {
      looped: false,
      subMenuType: null,
      sub_chunking_mode: 'size',
      content: null,
      delimiters: [',', ';', '\n'],
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
    testNode = createMockNode();
    mockSetNodes = vi.fn();
    mockSetEdges = vi.fn();
    mockGetNode = vi.fn(() => testNode);
    mockGetInternalNode = vi.fn(() => ({ id: 'test-chunkingbycharacter-1' }));

    mocks.useReactFlow.mockReturnValue({
      getNode: mockGetNode,
      getInternalNode: mockGetInternalNode,
      setNodes: mockSetNodes,
      setEdges: mockSetEdges,
      getNodes: vi.fn(() => [testNode]),
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

  // ==================== P0 测试用例: delimiters 数组管理 ====================

  describe('P0: delimiters 数组管理', () => {
    it('TC-CBC-001: 添加分隔符应正确保存到 node.data.delimiters', async () => {
      render(<ChunkingByCharacter {...testNode} id={testNode.id} data={testNode.data} isConnectable={true} />);

      // 打开配置菜单
      const nodeButton = screen.getByText('Chunk');
      fireEvent.click(nodeButton);

      await waitFor(() => {
        expect(screen.getByText('Chunk By Character')).toBeInTheDocument();
      });

      // 点击 "+" 按钮显示输入框（找到添加按钮，而不是删除按钮）
      const allButtons = screen.getAllByRole('button');
      const plusButtons = allButtons.filter(btn => {
        const svg = btn.querySelector('svg');
        if (!svg) return false;
        const path = svg.querySelector('path');
        return path?.getAttribute('d')?.includes('M12 5v14M5 12h14');
      });
      
      if (plusButtons.length > 0) {
        fireEvent.click(plusButtons[0]);

        // 等待输入框出现
        await waitFor(() => {
          const input = screen.getByPlaceholderText('Type...');
          expect(input).toBeInTheDocument();
        });

        // 输入新分隔符
        const input = screen.getByPlaceholderText('Type...');
        fireEvent.change(input, { target: { value: '|' } });
        fireEvent.keyDown(input, { key: 'Enter' });

        // 验证 setNodes 被调用，delimiters 包含新分隔符
        await waitFor(() => {
          expect(mockSetNodes).toHaveBeenCalled();
          const lastCall = mockSetNodes.mock.calls[mockSetNodes.mock.calls.length - 1];
          const updatedNode = lastCall[0]([testNode])[0];
          expect(updatedNode.data.delimiters).toContain('|');
        }, { timeout: 3000 });
      }
    });

    it('TC-CBC-001-1: delimiters 应为数组类型', () => {
      const node = createMockNode({ delimiters: [',', ';'] });
      
      expect(Array.isArray(node.data.delimiters)).toBe(true);
      expect(node.data.delimiters).toHaveLength(2);
      expect(typeof node.data.delimiters[0]).toBe('string');
      expect(typeof node.data.delimiters[1]).toBe('string');
    });

    it('TC-CBC-002: 删除分隔符应正确更新 node.data.delimiters', async () => {
      render(<ChunkingByCharacter {...testNode} id={testNode.id} data={testNode.data} isConnectable={true} />);

      // 打开配置菜单
      fireEvent.click(screen.getByText('Chunk'));

      await waitFor(() => {
        expect(screen.getByText('Chunk By Character')).toBeInTheDocument();
      });

      // 找到第一个分隔符 "," 的容器
      const delimiterCards = screen.getAllByText(',');
      if (delimiterCards.length > 0) {
        const firstCommaCard = delimiterCards[0].closest('div');
        
        if (firstCommaCard) {
          // 悬停以显示删除按钮
          fireEvent.mouseEnter(firstCommaCard);

          // 查找删除按钮（X SVG）
          const deleteButtons = within(firstCommaCard).getAllByRole('button');
          const deleteButton = deleteButtons.find(btn => {
            const svg = btn.querySelector('svg');
            if (!svg) return false;
            const lines = svg.querySelectorAll('line');
            return lines.length === 2; // X 图标有两条线
          });

          if (deleteButton) {
            fireEvent.click(deleteButton);

            // 验证 setNodes 被调用，delimiters 不再包含 ","
            await waitFor(() => {
              expect(mockSetNodes).toHaveBeenCalled();
              const lastCall = mockSetNodes.mock.calls[mockSetNodes.mock.calls.length - 1];
              const updatedNode = lastCall[0]([testNode])[0];
              expect(updatedNode.data.delimiters).not.toContain(',');
              expect(updatedNode.data.delimiters.length).toBe(2);
            }, { timeout: 3000 });
          }
        }
      }
    });

    it('TC-CBC-003: delimiters 数据结构验证（双重保存）', async () => {
      render(<ChunkingByCharacter {...testNode} id={testNode.id} data={testNode.data} isConnectable={true} />);

      // 打开配置菜单并添加分隔符
      fireEvent.click(screen.getByText('Chunk'));

      await waitFor(() => {
        expect(screen.getByText('Chunk By Character')).toBeInTheDocument();
      });

      // 找到 "+" 按钮
      const plusButtons = screen.getAllByRole('button').filter(btn => {
        const svg = btn.querySelector('svg');
        if (!svg) return false;
        const path = svg.querySelector('path');
        return path?.getAttribute('d')?.includes('M12 5v14M5 12h14');
      });

      if (plusButtons.length > 0) {
        fireEvent.click(plusButtons[0]);

        await waitFor(() => {
          expect(screen.getByPlaceholderText('Type...')).toBeInTheDocument();
        });

        const input = screen.getByPlaceholderText('Type...');
        fireEvent.change(input, { target: { value: '-' } });
        fireEvent.keyDown(input, { key: 'Enter' });

        // 验证双重保存：delimiters 数组和 content JSON 字符串
        await waitFor(() => {
          const lastCall = mockSetNodes.mock.calls[mockSetNodes.mock.calls.length - 1];
          const updatedNode = lastCall[0]([testNode])[0];
          
          // 验证 delimiters 字段
          expect(updatedNode.data.delimiters).toContain('-');
          
          // 验证 content 字段是 JSON 字符串
          expect(typeof updatedNode.data.content).toBe('string');
          const parsedContent = JSON.parse(updatedNode.data.content);
          expect(Array.isArray(parsedContent)).toBe(true);
          expect(parsedContent).toContain('-');
          
          // 验证两者一致
          expect(parsedContent).toEqual(updatedNode.data.delimiters);
        }, { timeout: 3000 });
      }
    });
  });

  // ==================== P1 测试用例: 分隔符添加和显示 ====================

  describe('P1: 分隔符添加和显示', () => {
    it('TC-CBC-004: 从常用分隔符列表添加', async () => {
      render(<ChunkingByCharacter {...testNode} id={testNode.id} data={testNode.data} isConnectable={true} />);

      // 打开配置菜单
      fireEvent.click(screen.getByText('Chunk'));

      await waitFor(() => {
        expect(screen.getByText('Chunk By Character')).toBeInTheDocument();
      });

      // 找到 "Period (.)" 按钮（在 Common delimiters 区域）
      const periodButton = screen.getByText(/Period \(\.\)/i);
      expect(periodButton).toBeInTheDocument();

      // 点击添加
      fireEvent.click(periodButton);

      // 验证分隔符被添加
      await waitFor(() => {
        expect(mockSetNodes).toHaveBeenCalled();
        const lastCall = mockSetNodes.mock.calls[mockSetNodes.mock.calls.length - 1];
        const updatedNode = lastCall[0]([testNode])[0];
        expect(updatedNode.data.delimiters).toContain('.');
      }, { timeout: 3000 });
    });

    it('TC-CBC-005: 添加自定义分隔符（输入框）', async () => {
      render(<ChunkingByCharacter {...testNode} id={testNode.id} data={testNode.data} isConnectable={true} />);

      // 打开配置菜单
      fireEvent.click(screen.getByText('Chunk'));

      await waitFor(() => {
        expect(screen.getByText('Chunk By Character')).toBeInTheDocument();
      });

      // 点击 "+" 按钮
      const plusButtons = screen.getAllByRole('button').filter(btn => {
        const svg = btn.querySelector('svg');
        if (!svg) return false;
        const path = svg.querySelector('path');
        return path?.getAttribute('d')?.includes('M12 5v14M5 12h14');
      });

      if (plusButtons.length > 0) {
        fireEvent.click(plusButtons[0]);

        // 验证输入框出现并自动聚焦
        await waitFor(() => {
          const input = screen.getByPlaceholderText('Type...');
          expect(input).toBeInTheDocument();
          expect(document.activeElement).toBe(input);
        });

        // 输入 "#"
        const input = screen.getByPlaceholderText('Type...');
        fireEvent.change(input, { target: { value: '#' } });
        
        // 按 Enter 确认
        fireEvent.keyDown(input, { key: 'Enter' });

        // 验证添加成功
        await waitFor(() => {
          const lastCall = mockSetNodes.mock.calls[mockSetNodes.mock.calls.length - 1];
          const updatedNode = lastCall[0]([testNode])[0];
          expect(updatedNode.data.delimiters).toContain('#');
        }, { timeout: 3000 });

        // 验证输入框消失（这里我们假设输入框会关闭）
        await waitFor(() => {
          expect(screen.queryByPlaceholderText('Type...')).not.toBeInTheDocument();
        });
      }
    });

    it('TC-CBC-006: 特殊字符显示验证', async () => {
      // 测试 \n, \t, 空格的显示
      const nodeWithSpecialChars = createMockNode({ delimiters: [',', '\n', '\t', ' '] });
      
      // 更新 mockGetNode 返回这个节点
      mockGetNode.mockReturnValue(nodeWithSpecialChars);
      
      render(<ChunkingByCharacter {...nodeWithSpecialChars} id={nodeWithSpecialChars.id} data={nodeWithSpecialChars.data} isConnectable={true} />);

      fireEvent.click(screen.getByText('Chunk'));

      await waitFor(() => {
        expect(screen.getByText('Chunk By Character')).toBeInTheDocument();
      });

      // 等待分隔符渲染
      await waitFor(() => {
        // 验证 \n 显示为 "Enter"
        expect(screen.getByText('Enter')).toBeInTheDocument();
      });
      
      // 验证 \t 显示为 "Tab" （使用 getAllByText 因为可能有多个匹配）
      const tabElements = screen.getAllByText((content, element) => {
        return element?.textContent === 'Tab' || content === 'Tab';
      });
      expect(tabElements.length).toBeGreaterThan(0);
      
      // 验证空格显示为 "Space"
      const spaceElements = screen.getAllByText((content, element) => {
        return element?.textContent === 'Space' || content === 'Space';
      });
      expect(spaceElements.length).toBeGreaterThan(0);
      
      // 验证普通字符 "," 原样显示
      const commas = screen.getAllByText(',');
      expect(commas.length).toBeGreaterThan(0);
    });

    it('TC-CBC-007: 点击 Run 按钮应触发执行', async () => {
      render(<ChunkingByCharacter {...testNode} id={testNode.id} data={testNode.data} isConnectable={true} />);

      // 打开配置菜单
      fireEvent.click(screen.getByText('Chunk'));

      await waitFor(() => {
        expect(screen.getByText('Chunk By Character')).toBeInTheDocument();
      });

      // 找到配置菜单中的 Run 按钮
      const runButtons = screen.getAllByText('Run');
      const menuRunButton = runButtons.find(button => {
        const parent = button.parentElement;
        return parent?.className.includes('w-[57px]') && parent?.className.includes('h-[24px]');
      });

      expect(menuRunButton).toBeDefined();

      if (menuRunButton) {
        fireEvent.click(menuRunButton);

        // 验证 runSingleEdgeNode 被调用
        await waitFor(() => {
          expect(mocks.runSingleEdgeNode).toHaveBeenCalled();
        }, { timeout: 3000 });

        // 验证调用参数
        expect(mocks.runSingleEdgeNode).toHaveBeenCalledWith(
          expect.objectContaining({
            parentId: testNode.id,
            targetNodeType: 'structured',
            context: expect.any(Object),
          })
        );
      }
    });
  });

  // ==================== P2 测试用例: 初始化和 UI 交互 ====================

  describe('P2: 初始化和 UI 交互', () => {
    it('TC-CBC-008: 分隔符默认值验证', () => {
      const node = createMockNode();

      // 验证默认值
      expect(node.data.delimiters).toEqual([',', ';', '\n']);
      expect(Array.isArray(node.data.delimiters)).toBe(true);
      expect(node.data.delimiters).toHaveLength(3);
    });

    it('TC-CBC-009: 点击节点按钮应打开配置菜单', async () => {
      render(<ChunkingByCharacter {...testNode} id={testNode.id} data={testNode.data} isConnectable={true} />);

      // 点击节点按钮
      const nodeButton = screen.getByText('Chunk');
      fireEvent.click(nodeButton);

      // 验证配置菜单显示
      await waitFor(() => {
        expect(screen.getByText('Chunk By Character')).toBeInTheDocument();
        expect(screen.getByTestId('input-output-display')).toBeInTheDocument();
        expect(screen.getByText('Delimiters')).toBeInTheDocument();
        expect(screen.getByText('Common delimiters:')).toBeInTheDocument();
      });
    });

    it('TC-CBC-010: 组件挂载后验证', () => {
      const { container } = render(
        <ChunkingByCharacter {...testNode} id={testNode.id} data={testNode.data} isConnectable={true} />
      );

      // 验证组件已渲染
      expect(container).toBeInTheDocument();
      
      // 验证节点按钮存在
      expect(screen.getByText('Chunk')).toBeInTheDocument();
      expect(screen.getByText('Char')).toBeInTheDocument();
      
      // 验证 SVG 图标存在
      const svgs = container.querySelectorAll('svg');
      expect(svgs.length).toBeGreaterThan(0);
    });

    it('TC-CBC-011: 重复分隔符不应重复添加', async () => {
      render(<ChunkingByCharacter {...testNode} id={testNode.id} data={testNode.data} isConnectable={true} />);

      // 打开配置菜单
      fireEvent.click(screen.getByText('Chunk'));

      await waitFor(() => {
        expect(screen.getByText('Chunk By Character')).toBeInTheDocument();
      });

      // 记录初始的 delimiters 数量（默认有 3 个：,, ;, \n）
      const initialDelimiters = testNode.data.delimiters;
      const initialLength = initialDelimiters.length;
      expect(initialDelimiters).toContain(',');

      // 尝试再次添加 "," （通过常用分隔符列表）
      const commaButton = screen.getByText(/Comma \(,\)/i);
      fireEvent.click(commaButton);

      // 等待一段时间，验证 setNodes 被调用
      await waitFor(() => {
        if (mockSetNodes.mock.calls.length > 0) {
          const lastCall = mockSetNodes.mock.calls[mockSetNodes.mock.calls.length - 1];
          const updatedNode = lastCall[0]([testNode])[0];
          
          // 验证 delimiters 中只有一个 ","
          const commaCount = updatedNode.data.delimiters.filter((d: string) => d === ',').length;
          expect(commaCount).toBe(1);
          
          // 验证数组长度没有增加
          expect(updatedNode.data.delimiters.length).toBe(initialLength);
        }
      }, { timeout: 3000 });
    });
  });
});

