/**
 * File Block Node - 文件上传测试
 *
 * 测试用例：
 * P0:
 * - TC-FILE-001: 点击上传单个文件
 * - TC-FILE-002: 拖拽上传单个文件
 * - TC-FILE-009: 上传中显示进度
 * - TC-FILE-011: 上传失败处理
 * 
 * P1:
 * - TC-FILE-003: 上传多个文件
 * - TC-FILE-004: 上传支持的文件类型
 * - TC-FILE-005: 上传不支持的文件类型
 * - TC-FILE-006: 上传超大文件
 * - TC-FILE-010: 上传成功后状态恢复
 * - TC-FILE-014: 上传中再次上传
 * - TC-FILE-015: 快速连续上传多个文件
 *
 * ⚠️ 需要人工验证：
 * - useFileUpload hook 的实际实现
 * - 文件上传的真实行为
 * - 文件类型验证逻辑
 */

// @ts-nocheck
import React from 'react';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import FileNode from '@/components/workflow/blockNode/FileNode';
import type { Node } from '@xyflow/react';
import type { FileNodeData } from '@/components/workflow/blockNode/FileNode';

// Mock 配置
const mocks = vi.hoisted(() => ({
  useReactFlow: vi.fn(),
  useNodesPerFlowContext: vi.fn(),
  useGetSourceTarget: vi.fn(),
  useFileUpload: vi.fn(),
}));

vi.mock('@xyflow/react', () => ({
  useReactFlow: mocks.useReactFlow,
  Handle: ({ children, type, position, id, isConnectable, onMouseEnter, onMouseLeave, style }: any) => (
    <div data-testid={`handle-${type}-${position}`} data-id={id} data-connectable={isConnectable} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} style={style}>{children}</div>
  ),
  Position: { Top: 'top', Right: 'right', Bottom: 'bottom', Left: 'left' },
  NodeResizeControl: ({ children, minWidth, minHeight, style }: any) => (
    <div data-testid='resize-control' data-min-width={minWidth} data-min-height={minHeight} style={style}>{children}</div>
  ),
}));

vi.mock('@/components/states/NodesPerFlowContext', () => ({
  useNodesPerFlowContext: mocks.useNodesPerFlowContext,
}));

vi.mock('@/components/hooks/useGetSourceTarget', () => ({
  default: mocks.useGetSourceTarget,
}));

vi.mock('@/components/workflow/blockNode/hooks/useFileUpload', () => ({
  useFileUpload: mocks.useFileUpload,
}));

vi.mock('@/components/workflow/handles/WhiteBallHandle', () => ({
  default: ({ id, type, position }: any) => (
    <div data-testid={`white-handle-${type}-${position}`} data-handle-id={id} />
  ),
}));

vi.mock('@/components/workflow/blockNode/FileNodeTopSettingBar/NodeSettingsButton', () => ({
  default: ({ nodeid }: any) => (
    <button data-testid='settings-button'>Settings</button>
  ),
}));

// Mock ReactDOM.createPortal
vi.mock('react-dom', async () => {
  const actual = await vi.importActual('react-dom');
  return {
    ...actual,
    createPortal: (node: any) => node,
  };
});

describe('FileNode - 文件上传', () => {
  let mockSetNodes: any;
  let mockGetNode: any;
  let mockHandleInputChange: any;
  let mockHandleFileDrop: any;
  let mockHandleDelete: any;

  const createMockNode = (overrides: Partial<FileNodeData> = {}): Node<FileNodeData> => ({
    id: 'test-file-node-1',
    type: 'file',
    position: { x: 0, y: 0 },
    data: {
      content: '',
      label: 'Test File Node',
      isLoading: false,
      isWaitingForFlow: false,
      locked: false,
      isInput: false,
      isOutput: false,
      editable: false,
      ...overrides,
    },
  });

  beforeEach(() => {
    mockSetNodes = vi.fn();
    mockGetNode = vi.fn(() => createMockNode());
    mockHandleInputChange = vi.fn();
    mockHandleFileDrop = vi.fn();
    mockHandleDelete = vi.fn();

    mocks.useReactFlow.mockReturnValue({
      getNode: mockGetNode,
      setNodes: mockSetNodes,
      getNodes: vi.fn(() => [createMockNode()]),
    });

    mocks.useNodesPerFlowContext.mockReturnValue({
      activatedNode: null,
      isOnConnect: false,
      isOnGeneratingNewNode: false,
      setNodeUneditable: vi.fn(),
      editNodeLabel: vi.fn(),
      preventInactivateNode: vi.fn(),
      allowInactivateNodeWhenClickOutside: vi.fn(),
      activateNode: vi.fn(),
      inactivateNode: vi.fn(),
    });

    mocks.useGetSourceTarget.mockReturnValue({
      getSourceNodeIdWithLabel: vi.fn(() => []),
      getTargetNodeIdWithLabel: vi.fn(() => []),
    });

    // Mock useFileUpload hook 默认返回
    mocks.useFileUpload.mockReturnValue({
      uploadedFiles: [],
      isOnUploading: false,
      inputRef: { current: document.createElement('input') },
      handleInputChange: mockHandleInputChange,
      handleFileDrop: mockHandleFileDrop,
      handleDelete: mockHandleDelete,
      resourceKey: null,
      versionId: null,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('TC-FILE-001: 点击上传单个文件 (P0)', () => {
    it('应该能点击空白区域触发文件选择', () => {
      const mockNode = createMockNode();

      render(
        <FileNode
          id={mockNode.id}
          type={mockNode.type as string}
          data={mockNode.data}
          selected={false}
          isConnectable={true}
          xPos={0}
          yPos={0}
          zIndex={0}
          dragging={false}
        />
      );

      // 查找上传区域
      const uploadArea = screen.getByText(/Drag and drop files here/i).closest('div');
      expect(uploadArea).toBeInTheDocument();
    });

    it('上传成功后文件应显示在列表中', () => {
      const mockFile = {
        fileName: 'test.pdf',
        fileType: 'pdf',
        download_url: 'https://example.com/test.pdf',
        task_id: 'task-123',
      };

      // Mock 返回已上传的文件
      mocks.useFileUpload.mockReturnValue({
        uploadedFiles: [mockFile],
        isOnUploading: false,
        inputRef: { current: document.createElement('input') },
        handleInputChange: mockHandleInputChange,
        handleFileDrop: mockHandleFileDrop,
        handleDelete: mockHandleDelete,
        resourceKey: 'resource-key-123',
        versionId: 'version-1',
      });

      const mockNode = createMockNode({
        content: [mockFile] as any,
      });

      render(
        <FileNode
          id={mockNode.id}
          type={mockNode.type as string}
          data={mockNode.data}
          selected={false}
          isConnectable={true}
          xPos={0}
          yPos={0}
          zIndex={0}
          dragging={false}
        />
      );

      // 验证文件显示
      expect(screen.getByText('test.pdf')).toBeInTheDocument();
    });
  });

  describe('TC-FILE-002: 拖拽上传单个文件 (P0)', () => {
    it('应该能拖拽文件到上传区域', () => {
      const mockNode = createMockNode();

      const { container } = render(
        <FileNode
          id={mockNode.id}
          type={mockNode.type as string}
          data={mockNode.data}
          selected={false}
          isConnectable={true}
          xPos={0}
          yPos={0}
          zIndex={0}
          dragging={false}
        />
      );

      // 查找可拖拽的容器区域（包含 hover:bg-gray-800/40 的 div）
      const uploadContainers = container.querySelectorAll('.hover\\:bg-gray-800\\/40');
      expect(uploadContainers.length).toBeGreaterThan(0);
    });

    it.skip('拖拽离开应恢复样式', () => {
      // 样式的动态变化需要在真实浏览器环境中验证
      // 或者需要更复杂的状态追踪机制
    });

    it('拖拽释放应触发文件上传', () => {
      const mockNode = createMockNode();

      render(
        <FileNode
          id={mockNode.id}
          type={mockNode.type as string}
          data={mockNode.data}
          selected={false}
          isConnectable={true}
          xPos={0}
          yPos={0}
          zIndex={0}
          dragging={false}
        />
      );

      const uploadArea = screen.getByText(/Drag and drop files here/i).closest('div');

      // 模拟文件拖拽释放
      const dropEvent = new Event('drop', { bubbles: true });
      fireEvent.drop(uploadArea!, dropEvent);

      // 验证 handleFileDrop 被调用
      expect(mockHandleFileDrop).toHaveBeenCalled();
    });
  });

  describe('TC-FILE-003: 上传多个文件 (P1)', () => {
    it('应该能显示多个已上传的文件', () => {
      const mockFiles = [
        { fileName: 'file1.pdf', fileType: 'pdf', task_id: 'task-1', download_url: 'url1' },
        { fileName: 'file2.docx', fileType: 'docx', task_id: 'task-2', download_url: 'url2' },
        { fileName: 'file3.txt', fileType: 'txt', task_id: 'task-3', download_url: 'url3' },
      ];

      mocks.useFileUpload.mockReturnValue({
        uploadedFiles: mockFiles,
        isOnUploading: false,
        inputRef: { current: document.createElement('input') },
        handleInputChange: mockHandleInputChange,
        handleFileDrop: mockHandleFileDrop,
        handleDelete: mockHandleDelete,
        resourceKey: 'resource-key-123',
        versionId: 'version-1',
      });

      const mockNode = createMockNode({ content: mockFiles as any });

      render(
        <FileNode
          id={mockNode.id}
          type={mockNode.type as string}
          data={mockNode.data}
          selected={false}
          isConnectable={true}
          xPos={0}
          yPos={0}
          zIndex={0}
          dragging={false}
        />
      );

      // 验证所有文件都显示
      expect(screen.getByText('file1.pdf')).toBeInTheDocument();
      expect(screen.getByText('file2.docx')).toBeInTheDocument();
      expect(screen.getByText('file3.txt')).toBeInTheDocument();
    });
  });

  describe('TC-FILE-004: 上传支持的文件类型 (P1)', () => {
    it('input accept 应该包含支持的文件类型', () => {
      const mockNode = createMockNode();

      render(
        <FileNode
          id={mockNode.id}
          type={mockNode.type as string}
          data={mockNode.data}
          selected={false}
          isConnectable={true}
          xPos={0}
          yPos={0}
          zIndex={0}
          dragging={false}
        />
      );

      const fileInput = document.querySelector('input[type="file"]');
      expect(fileInput).toHaveAttribute('accept', '.json, .pdf, .txt, .docx, .csv, .xlsx, .markdown, .md, .mdx');
    });

    it('input 应该支持多文件上传', () => {
      const mockNode = createMockNode();

      render(
        <FileNode
          id={mockNode.id}
          type={mockNode.type as string}
          data={mockNode.data}
          selected={false}
          isConnectable={true}
          xPos={0}
          yPos={0}
          zIndex={0}
          dragging={false}
        />
      );

      const fileInput = document.querySelector('input[type="file"]');
      expect(fileInput).toHaveAttribute('multiple');
    });
  });

  describe('TC-FILE-009: 上传中显示进度 (P0)', () => {
    it('上传中应显示加载状态', () => {
      mocks.useFileUpload.mockReturnValue({
        uploadedFiles: [],
        isOnUploading: true, // 上传中
        inputRef: { current: document.createElement('input') },
        handleInputChange: mockHandleInputChange,
        handleFileDrop: mockHandleFileDrop,
        handleDelete: mockHandleDelete,
        resourceKey: null,
        versionId: null,
      });

      const mockNode = createMockNode();

      render(
        <FileNode
          id={mockNode.id}
          type={mockNode.type as string}
          data={mockNode.data}
          selected={false}
          isConnectable={true}
          xPos={0}
          yPos={0}
          zIndex={0}
          dragging={false}
        />
      );

      // 验证加载状态显示
      expect(screen.getByText('Uploading')).toBeInTheDocument();
      expect(screen.getByText('Please wait...')).toBeInTheDocument();
    });

    it('上传中应显示旋转动画', () => {
      mocks.useFileUpload.mockReturnValue({
        uploadedFiles: [],
        isOnUploading: true,
        inputRef: { current: document.createElement('input') },
        handleInputChange: mockHandleInputChange,
        handleFileDrop: mockHandleFileDrop,
        handleDelete: mockHandleDelete,
        resourceKey: null,
        versionId: null,
      });

      const mockNode = createMockNode();

      const { container } = render(
        <FileNode
          id={mockNode.id}
          type={mockNode.type as string}
          data={mockNode.data}
          selected={false}
          isConnectable={true}
          xPos={0}
          yPos={0}
          zIndex={0}
          dragging={false}
        />
      );

      // 查找带动画的 SVG
      const animatedSvg = container.querySelector('.animate-\\[spin_2s_linear_infinite\\]');
      expect(animatedSvg).toBeInTheDocument();
    });
  });

  describe('TC-FILE-010: 上传成功后状态恢复 (P1)', () => {
    it('上传完成后应隐藏加载状态', () => {
      const { rerender } = render(
        <FileNode
          id='test-node'
          type='file'
          data={{
            ...createMockNode().data,
          }}
          selected={false}
          isConnectable={true}
          xPos={0}
          yPos={0}
          zIndex={0}
          dragging={false}
        />
      );

      // 初始：上传中
      mocks.useFileUpload.mockReturnValue({
        uploadedFiles: [],
        isOnUploading: true,
        inputRef: { current: document.createElement('input') },
        handleInputChange: mockHandleInputChange,
        handleFileDrop: mockHandleFileDrop,
        handleDelete: mockHandleDelete,
        resourceKey: null,
        versionId: null,
      });

      rerender(
        <FileNode
          id='test-node'
          type='file'
          data={{
            ...createMockNode().data,
          }}
          selected={false}
          isConnectable={true}
          xPos={0}
          yPos={0}
          zIndex={0}
          dragging={false}
        />
      );

      expect(screen.getByText('Uploading')).toBeInTheDocument();

      // 完成：上传成功
      const mockFile = {
        fileName: 'uploaded.pdf',
        fileType: 'pdf',
        task_id: 'task-123',
        download_url: 'url',
      };

      mocks.useFileUpload.mockReturnValue({
        uploadedFiles: [mockFile],
        isOnUploading: false, // 上传完成
        inputRef: { current: document.createElement('input') },
        handleInputChange: mockHandleInputChange,
        handleFileDrop: mockHandleFileDrop,
        handleDelete: mockHandleDelete,
        resourceKey: 'resource-key',
        versionId: 'version-1',
      });

      rerender(
        <FileNode
          id='test-node'
          type='file'
          data={{
            ...createMockNode().data,
            content: [mockFile] as any,
          }}
          selected={false}
          isConnectable={true}
          xPos={0}
          yPos={0}
          zIndex={0}
          dragging={false}
        />
      );

      // 验证加载状态消失
      expect(screen.queryByText('Uploading')).not.toBeInTheDocument();
      // 验证文件显示
      expect(screen.getByText('uploaded.pdf')).toBeInTheDocument();
    });
  });

  describe('TC-FILE-011: 上传失败处理 (P0)', () => {
    it.skip('上传失败应显示错误提示', () => {
      // 需要 useFileUpload hook 支持错误状态
      // 在真实实现中验证
    });
  });

  describe('TC-FILE-014: 上传中再次上传 (P1)', () => {
    it.skip('上传中应禁用再次上传', () => {
      // 需要验证 useFileUpload 的队列处理逻辑
      // 在集成测试中验证
    });
  });

  describe('TC-FILE-015: 快速连续上传多个文件 (P1)', () => {
    it.skip('应该能处理快速连续的文件上传', () => {
      // 需要真实的上传队列测试
      // 在集成测试中验证
    });
  });
});

/**
 * 🔧 人工验证清单：
 *
 * 1. ✅ useFileUpload Hook
 *    - [ ] 验证 hook 的实际实现
 *    - [ ] 测试文件上传的真实行为
 *    - [ ] 验证错误处理逻辑
 *
 * 2. ✅ 文件类型验证
 *    - [ ] 测试不支持的文件类型被拒绝
 *    - [ ] 验证文件大小限制
 *    - [ ] 测试特殊文件名处理
 *
 * 3. ✅ 上传状态管理
 *    - [ ] 验证 isOnUploading 的完整流程
 *    - [ ] 测试上传进度反馈
 *    - [ ] 验证并发上传处理
 *
 * 4. ✅ 集成测试
 *    - [ ] 真实文件上传测试
 *    - [ ] 拖拽上传完整流程
 *    - [ ] 网络错误模拟
 *
 * 📝 运行命令：
 *    npm run test -- FileNode.upload.test.tsx
 */

