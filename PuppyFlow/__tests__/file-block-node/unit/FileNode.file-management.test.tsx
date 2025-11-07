/**
 * File Block Node - 文件管理测试
 *
 * 测试用例：
 * P0:
 * - TC-FILE-022: 点击文件下载
 *
 * P1:
 * - TC-FILE-017: 显示文件列表
 * - TC-FILE-023: 下载文件无 URL
 * - TC-FILE-025: 删除单个文件
 * - TC-FILE-026: 删除最后一个文件
 * - TC-FILE-028: 删除文件时阻止冒泡
 *
 * ⚠️ 需要人工验证：
 * - window.open 的实际行为
 * - 文件删除的真实逻辑
 */

// @ts-nocheck
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import FileNode from '../../../app/components/workflow/blockNode/FileNode';
import type { Node } from '@xyflow/react';
import type { FileNodeData } from '../../../app/components/workflow/blockNode/FileNode';

// Mock 配置
const mocks = vi.hoisted(() => ({
  useReactFlow: vi.fn(),
  useNodesPerFlowContext: vi.fn(),
  useGetSourceTarget: vi.fn(),
  useFileUpload: vi.fn(),
}));

vi.mock('@xyflow/react', () => ({
  useReactFlow: mocks.useReactFlow,
  Handle: ({
    children,
    type,
    position,
    id,
    isConnectable,
    onMouseEnter,
    onMouseLeave,
    style,
  }: any) => (
    <div
      data-testid={`handle-${type}-${position}`}
      data-id={id}
      data-connectable={isConnectable}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={style}
    >
      {children}
    </div>
  ),
  Position: { Top: 'top', Right: 'right', Bottom: 'bottom', Left: 'left' },
  NodeResizeControl: ({ children, minWidth, minHeight, style }: any) => (
    <div
      data-testid='resize-control'
      data-min-width={minWidth}
      data-min-height={minHeight}
      style={style}
    >
      {children}
    </div>
  ),
}));

vi.mock('@/app/components/states/NodesPerFlowContext', () => ({
  useNodesPerFlowContext: mocks.useNodesPerFlowContext,
}));

vi.mock('@/app/components/hooks/useGetSourceTarget', () => ({
  default: mocks.useGetSourceTarget,
}));

vi.mock('@/app/components/workflow/blockNode/hooks/useFileUpload', () => ({
  useFileUpload: mocks.useFileUpload,
}));

vi.mock('@/app/components/states/UserWorkspacesContext', () => ({
  useWorkspaces: vi.fn(() => ({
    userId: 'test-user-id',
    workspaces: [],
    currentWorkspace: null,
  })),
}));

vi.mock('@/app/components/hooks/useWorkspaceManagement', () => ({
  useWorkspaceManagement: vi.fn(() => ({
    fetchUserId: vi.fn(),
  })),
}));

vi.mock('@/app/components/states/AppSettingsContext', () => ({
  useAppSettings: vi.fn(() => ({
    addWarn: vi.fn(),
  })),
}));

vi.mock('@/app/components/workflow/handles/WhiteBallHandle', () => ({
  default: ({ id, type, position }: any) => (
    <div data-testid={`white-handle-${type}-${position}`} />
  ),
}));

vi.mock(
  '@/app/components/workflow/blockNode/FileNodeTopSettingBar/NodeSettingsButton',
  () => ({
    default: () => <button data-testid='settings-button'>Settings</button>,
  })
);

vi.mock('react-dom', async () => {
  const actual = await vi.importActual('react-dom');
  return {
    ...actual,
    createPortal: (node: any) => node,
  };
});

describe('FileNode - 文件管理', () => {
  let mockSetNodes: any;
  let mockGetNode: any;
  let mockHandleDelete: any;
  let mockWindowOpen: any;

  const createMockNode = (
    overrides: Partial<FileNodeData> = {}
  ): Node<FileNodeData> => ({
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
    mockHandleDelete = vi.fn();
    mockWindowOpen = vi.fn();

    // Mock window.open
    global.window.open = mockWindowOpen;

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

    mocks.useFileUpload.mockReturnValue({
      uploadedFiles: [],
      isOnUploading: false,
      inputRef: { current: document.createElement('input') },
      handleInputChange: vi.fn(),
      handleFileDrop: vi.fn(),
      handleDelete: mockHandleDelete,
      resourceKey: null,
      versionId: null,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('TC-FILE-017: 显示文件列表 (P1)', () => {
    it('应该显示所有已上传的文件', () => {
      const mockFiles = [
        {
          fileName: 'document.pdf',
          fileType: 'pdf',
          task_id: 'task-1',
          download_url: 'url1',
        },
        {
          fileName: 'spreadsheet.xlsx',
          fileType: 'xlsx',
          task_id: 'task-2',
          download_url: 'url2',
        },
      ];

      mocks.useFileUpload.mockReturnValue({
        uploadedFiles: mockFiles,
        isOnUploading: false,
        inputRef: { current: document.createElement('input') },
        handleInputChange: vi.fn(),
        handleFileDrop: vi.fn(),
        handleDelete: mockHandleDelete,
        resourceKey: 'resource-key',
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

      // 验证文件名显示
      expect(screen.getByText('document.pdf')).toBeInTheDocument();
      expect(screen.getByText('spreadsheet.xlsx')).toBeInTheDocument();
    });

    it('文件名应该去除 file_ 前缀', () => {
      const mockFiles = [
        {
          fileName: 'file_report.pdf',
          fileType: 'pdf',
          task_id: 'task-1',
          download_url: 'url1',
        },
      ];

      mocks.useFileUpload.mockReturnValue({
        uploadedFiles: mockFiles,
        isOnUploading: false,
        inputRef: { current: document.createElement('input') },
        handleInputChange: vi.fn(),
        handleFileDrop: vi.fn(),
        handleDelete: mockHandleDelete,
        resourceKey: 'resource-key',
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

      // 验证前缀被移除
      expect(screen.getByText('report.pdf')).toBeInTheDocument();
      expect(screen.queryByText('file_report.pdf')).not.toBeInTheDocument();
    });

    it('文件名为空时应显示 task_id 或 Unnamed file', () => {
      const mockFiles = [
        {
          fileName: '',
          fileType: 'pdf',
          task_id: 'task-xyz',
          download_url: 'url1',
        },
      ];

      mocks.useFileUpload.mockReturnValue({
        uploadedFiles: mockFiles,
        isOnUploading: false,
        inputRef: { current: document.createElement('input') },
        handleInputChange: vi.fn(),
        handleFileDrop: vi.fn(),
        handleDelete: mockHandleDelete,
        resourceKey: 'resource-key',
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

      // 验证后备显示
      const text = screen.getByText(/task-xyz\.pdf|Unnamed file/);
      expect(text).toBeInTheDocument();
    });

    it('每个文件应显示文件图标', () => {
      const mockFiles = [
        {
          fileName: 'test.pdf',
          fileType: 'pdf',
          task_id: 'task-1',
          download_url: 'url1',
        },
      ];

      mocks.useFileUpload.mockReturnValue({
        uploadedFiles: mockFiles,
        isOnUploading: false,
        inputRef: { current: document.createElement('input') },
        handleInputChange: vi.fn(),
        handleFileDrop: vi.fn(),
        handleDelete: mockHandleDelete,
        resourceKey: 'resource-key',
        versionId: 'version-1',
      });

      const mockNode = createMockNode({ content: mockFiles as any });

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

      // 验证文件图标存在
      const fileIcons = container.querySelectorAll('svg path');
      expect(fileIcons.length).toBeGreaterThan(0);
    });

    it('每个文件应有删除按钮', () => {
      const mockFiles = [
        {
          fileName: 'test.pdf',
          fileType: 'pdf',
          task_id: 'task-1',
          download_url: 'url1',
        },
      ];

      mocks.useFileUpload.mockReturnValue({
        uploadedFiles: mockFiles,
        isOnUploading: false,
        inputRef: { current: document.createElement('input') },
        handleInputChange: vi.fn(),
        handleFileDrop: vi.fn(),
        handleDelete: mockHandleDelete,
        resourceKey: 'resource-key',
        versionId: 'version-1',
      });

      const mockNode = createMockNode({ content: mockFiles as any });

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

      // 查找删除按钮
      const deleteButtons = container.querySelectorAll('button');
      const hasDeleteButton = Array.from(deleteButtons).some(btn =>
        btn.querySelector('svg path[d*="M18 6L6 18M6 6l12 12"]')
      );
      expect(hasDeleteButton).toBe(true);
    });
  });

  describe('TC-FILE-022: 点击文件下载 (P0)', () => {
    it('点击文件应打开下载链接', () => {
      const mockFiles = [
        {
          fileName: 'document.pdf',
          fileType: 'pdf',
          task_id: 'task-1',
          download_url: 'https://example.com/document.pdf',
        },
      ];

      mocks.useFileUpload.mockReturnValue({
        uploadedFiles: mockFiles,
        isOnUploading: false,
        inputRef: { current: document.createElement('input') },
        handleInputChange: vi.fn(),
        handleFileDrop: vi.fn(),
        handleDelete: mockHandleDelete,
        resourceKey: 'resource-key',
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

      // 点击文件名
      const fileName = screen.getByText('document.pdf');
      fireEvent.click(fileName);

      // 验证 window.open 被调用
      expect(mockWindowOpen).toHaveBeenCalledWith(
        'https://example.com/document.pdf',
        '_blank'
      );
    });

    it('应该在新标签页打开文件', () => {
      const mockFiles = [
        {
          fileName: 'test.pdf',
          fileType: 'pdf',
          task_id: 'task-1',
          download_url: 'https://example.com/test.pdf',
        },
      ];

      mocks.useFileUpload.mockReturnValue({
        uploadedFiles: mockFiles,
        isOnUploading: false,
        inputRef: { current: document.createElement('input') },
        handleInputChange: vi.fn(),
        handleFileDrop: vi.fn(),
        handleDelete: mockHandleDelete,
        resourceKey: 'resource-key',
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

      const fileName = screen.getByText('test.pdf');
      fireEvent.click(fileName);

      // 验证使用 '_blank' 参数
      expect(mockWindowOpen).toHaveBeenCalledWith(expect.any(String), '_blank');
    });
  });

  describe('TC-FILE-023: 下载文件无 URL (P1)', () => {
    it('download_url 为空时不应触发 window.open', () => {
      const mockFiles = [
        {
          fileName: 'test.pdf',
          fileType: 'pdf',
          task_id: 'task-1',
          download_url: '',
        },
      ];

      mocks.useFileUpload.mockReturnValue({
        uploadedFiles: mockFiles,
        isOnUploading: false,
        inputRef: { current: document.createElement('input') },
        handleInputChange: vi.fn(),
        handleFileDrop: vi.fn(),
        handleDelete: mockHandleDelete,
        resourceKey: 'resource-key',
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

      const fileName = screen.getByText('test.pdf');
      fireEvent.click(fileName);

      // 验证 window.open 未被调用
      expect(mockWindowOpen).not.toHaveBeenCalled();
    });
  });

  describe('TC-FILE-025: 删除单个文件 (P1)', () => {
    it('点击删除按钮应调用 handleDelete', () => {
      const mockFiles = [
        {
          fileName: 'test.pdf',
          fileType: 'pdf',
          task_id: 'task-1',
          download_url: 'url1',
        },
      ];

      mocks.useFileUpload.mockReturnValue({
        uploadedFiles: mockFiles,
        isOnUploading: false,
        inputRef: { current: document.createElement('input') },
        handleInputChange: vi.fn(),
        handleFileDrop: vi.fn(),
        handleDelete: mockHandleDelete,
        resourceKey: 'resource-key',
        versionId: 'version-1',
      });

      const mockNode = createMockNode({ content: mockFiles as any });

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

      // 查找删除按钮（包含 X 图标的按钮）
      const deleteButton = Array.from(
        container.querySelectorAll('button')
      ).find(btn => btn.querySelector('svg path[d*="M18 6L6 18M6 6l12 12"]'));

      expect(deleteButton).toBeTruthy();
      fireEvent.click(deleteButton!);

      // 验证 handleDelete 被调用
      expect(mockHandleDelete).toHaveBeenCalledWith(mockFiles[0], 0);
    });
  });

  describe('TC-FILE-026: 删除最后一个文件 (P1)', () => {
    it('删除唯一文件后应显示空状态', () => {
      const { rerender } = render(
        <FileNode
          id='test-node'
          type='file'
          data={{
            ...createMockNode().data,
            content: [
              {
                fileName: 'test.pdf',
                fileType: 'pdf',
                task_id: 'task-1',
                download_url: 'url1',
              },
            ] as any,
          }}
          selected={false}
          isConnectable={true}
          xPos={0}
          yPos={0}
          zIndex={0}
          dragging={false}
        />
      );

      // 初始：有文件
      mocks.useFileUpload.mockReturnValue({
        uploadedFiles: [
          {
            fileName: 'test.pdf',
            fileType: 'pdf',
            task_id: 'task-1',
            download_url: 'url1',
          },
        ],
        isOnUploading: false,
        inputRef: { current: document.createElement('input') },
        handleInputChange: vi.fn(),
        handleFileDrop: vi.fn(),
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
            content: [
              {
                fileName: 'test.pdf',
                fileType: 'pdf',
                task_id: 'task-1',
                download_url: 'url1',
              },
            ] as any,
          }}
          selected={false}
          isConnectable={true}
          xPos={0}
          yPos={0}
          zIndex={0}
          dragging={false}
        />
      );

      expect(screen.getByText('test.pdf')).toBeInTheDocument();

      // 删除后：无文件
      mocks.useFileUpload.mockReturnValue({
        uploadedFiles: [],
        isOnUploading: false,
        inputRef: { current: document.createElement('input') },
        handleInputChange: vi.fn(),
        handleFileDrop: vi.fn(),
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
            content: '',
          }}
          selected={false}
          isConnectable={true}
          xPos={0}
          yPos={0}
          zIndex={0}
          dragging={false}
        />
      );

      // 验证空状态显示
      expect(screen.getByText(/Drag and drop files here/i)).toBeInTheDocument();
      expect(screen.queryByText('test.pdf')).not.toBeInTheDocument();
    });
  });

  describe('TC-FILE-028: 删除文件时阻止冒泡 (P1)', () => {
    it('点击删除按钮不应触发文件点击事件', () => {
      const mockFiles = [
        {
          fileName: 'test.pdf',
          fileType: 'pdf',
          task_id: 'task-1',
          download_url: 'https://example.com/test.pdf',
        },
      ];

      mocks.useFileUpload.mockReturnValue({
        uploadedFiles: mockFiles,
        isOnUploading: false,
        inputRef: { current: document.createElement('input') },
        handleInputChange: vi.fn(),
        handleFileDrop: vi.fn(),
        handleDelete: mockHandleDelete,
        resourceKey: 'resource-key',
        versionId: 'version-1',
      });

      const mockNode = createMockNode({ content: mockFiles as any });

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

      // 点击删除按钮
      const deleteButton = Array.from(
        container.querySelectorAll('button')
      ).find(btn => btn.querySelector('svg path[d*="M18 6L6 18M6 6l12 12"]'));

      fireEvent.click(deleteButton!);

      // 验证 handleDelete 被调用
      expect(mockHandleDelete).toHaveBeenCalled();
      // 验证 window.open 未被调用（没有触发文件打开）
      expect(mockWindowOpen).not.toHaveBeenCalled();
    });
  });
});

/**
 * 🔧 人工验证清单：
 *
 * 1. ✅ 文件下载
 *    - [ ] 验证 window.open 在真实浏览器中的行为
 *    - [ ] 测试下载链接过期的情况
 *    - [ ] 验证不同文件类型的打开方式
 *
 * 2. ✅ 文件删除
 *    - [ ] 验证 handleDelete 的实际实现
 *    - [ ] 测试删除后的 UI 更新
 *    - [ ] 验证删除失败的错误处理
 *
 * 3. ✅ 文件列表
 *    - [ ] 测试大量文件的显示性能
 *    - [ ] 验证文件名截断的视觉效果
 *    - [ ] 测试特殊字符文件名的显示
 *
 * 📝 运行命令：
 *    npm run test -- FileNode.file-management.test.tsx
 */
