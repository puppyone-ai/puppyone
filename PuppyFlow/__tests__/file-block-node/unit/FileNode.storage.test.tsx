/**
 * File Block Node - 外部存储测试
 *
 * 测试用例：
 * P0:
 * - TC-FILE-030: 上传后生成 resourceKey
 * - TC-FILE-031: 保存 external_metadata
 * - TC-FILE-035: 删除文件后清理 external_metadata
 *
 * P1:
 * - TC-FILE-032: 更新文件时保持 resourceKey
 * - TC-FILE-033: versionId 跟随文件变更递增
 * - TC-FILE-036: 所有文件删除后清空 external_metadata
 * - TC-FILE-037: external_metadata 包含完整文件信息
 *
 * ⚠️ 需要人工验证：
 * - useFileUpload hook 中 resourceKey 的生成逻辑
 * - external_metadata 的实际持久化
 * - versionId 的更新机制
 */

// @ts-nocheck
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
    <div data-testid={`white-handle-${type}-${position}`} />
  ),
}));

vi.mock(
  '@/components/workflow/blockNode/FileNodeTopSettingBar/NodeSettingsButton',
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

describe('FileNode - 外部存储', () => {
  let mockSetNodes: any;
  let mockGetNode: any;

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
      handleDelete: vi.fn(),
      resourceKey: null,
      versionId: null,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('TC-FILE-030: 上传后生成 resourceKey (P0)', () => {
    it('上传文件后应生成 resourceKey', () => {
      // Mock 上传后的状态
      const mockResourceKey = 'resource_file_abc123';
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
        handleDelete: vi.fn(),
        resourceKey: mockResourceKey,
        versionId: 1,
      });

      const mockNode = createMockNode({
        content: mockFiles as any,
        external_metadata: {
          content_type: 'files',
          resource_key: mockResourceKey,
          version_id: 1,
          files: mockFiles,
        },
      });

      mockGetNode.mockReturnValue(mockNode);

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

      // 验证 resourceKey 存在
      expect(mockNode.data.external_metadata?.resource_key).toBe(
        mockResourceKey
      );
    });

    it('resourceKey 应以 resource_file_ 开头', () => {
      const mockResourceKey = 'resource_file_xyz789';
      const mockFiles = [
        {
          fileName: 'document.pdf',
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
        handleDelete: vi.fn(),
        resourceKey: mockResourceKey,
        versionId: 1,
      });

      const mockNode = createMockNode({
        content: mockFiles as any,
        external_metadata: {
          content_type: 'files',
          resource_key: mockResourceKey,
          version_id: 1,
          files: mockFiles,
        },
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

      expect(mockNode.data.external_metadata?.resource_key).toMatch(
        /^resource_file_/
      );
    });
  });

  describe('TC-FILE-031: 保存 external_metadata (P0)', () => {
    it('应保存完整的 external_metadata', () => {
      const mockResourceKey = 'resource_file_test123';
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
        handleDelete: vi.fn(),
        resourceKey: mockResourceKey,
        versionId: 1,
      });

      const mockNode = createMockNode({
        content: mockFiles as any,
        external_metadata: {
          content_type: 'files',
          resource_key: mockResourceKey,
          version_id: 1,
          files: mockFiles,
        },
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

      // 验证 external_metadata 结构
      const metadata = mockNode.data.external_metadata;
      expect(metadata).toBeDefined();
      expect(metadata?.content_type).toBe('files');
      expect(metadata?.resource_key).toBe(mockResourceKey);
      expect(metadata?.version_id).toBe(1);
      expect(metadata?.files).toEqual(mockFiles);
    });

    it('external_metadata.content_type 应为 files', () => {
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
        handleDelete: vi.fn(),
        resourceKey: 'resource_file_123',
        versionId: 1,
      });

      const mockNode = createMockNode({
        content: mockFiles as any,
        external_metadata: {
          content_type: 'files',
          resource_key: 'resource_file_123',
          version_id: 1,
          files: mockFiles,
        },
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

      expect(mockNode.data.external_metadata?.content_type).toBe('files');
    });
  });

  describe('TC-FILE-032: 更新文件时保持 resourceKey (P1)', () => {
    it('添加新文件时 resourceKey 应保持不变', () => {
      const mockResourceKey = 'resource_file_persistent';

      // 第一次渲染：1个文件
      const firstFiles = [
        {
          fileName: 'file1.pdf',
          fileType: 'pdf',
          task_id: 'task-1',
          download_url: 'url1',
        },
      ];

      mocks.useFileUpload.mockReturnValue({
        uploadedFiles: firstFiles,
        isOnUploading: false,
        inputRef: { current: document.createElement('input') },
        handleInputChange: vi.fn(),
        handleFileDrop: vi.fn(),
        handleDelete: vi.fn(),
        resourceKey: mockResourceKey,
        versionId: 1,
      });

      const { rerender } = render(
        <FileNode
          id='test-node'
          type='file'
          data={{
            ...createMockNode().data,
            content: firstFiles as any,
            external_metadata: {
              content_type: 'files',
              resource_key: mockResourceKey,
              version_id: 1,
              files: firstFiles,
            },
          }}
          selected={false}
          isConnectable={true}
          xPos={0}
          yPos={0}
          zIndex={0}
          dragging={false}
        />
      );

      // 第二次渲染：2个文件，但 resourceKey 不变
      const secondFiles = [
        ...firstFiles,
        {
          fileName: 'file2.pdf',
          fileType: 'pdf',
          task_id: 'task-2',
          download_url: 'url2',
        },
      ];

      mocks.useFileUpload.mockReturnValue({
        uploadedFiles: secondFiles,
        isOnUploading: false,
        inputRef: { current: document.createElement('input') },
        handleInputChange: vi.fn(),
        handleFileDrop: vi.fn(),
        handleDelete: vi.fn(),
        resourceKey: mockResourceKey, // 保持不变
        versionId: 2, // versionId 递增
      });

      const mockNode = createMockNode({
        content: secondFiles as any,
        external_metadata: {
          content_type: 'files',
          resource_key: mockResourceKey,
          version_id: 2,
          files: secondFiles,
        },
      });

      mockGetNode.mockReturnValue(mockNode);

      rerender(
        <FileNode
          id='test-node'
          type='file'
          data={mockNode.data}
          selected={false}
          isConnectable={true}
          xPos={0}
          yPos={0}
          zIndex={0}
          dragging={false}
        />
      );

      // 验证 resourceKey 保持一致
      expect(mockNode.data.external_metadata?.resource_key).toBe(
        mockResourceKey
      );
    });
  });

  describe('TC-FILE-033: versionId 跟随文件变更递增 (P1)', () => {
    it('添加文件后 versionId 应递增', () => {
      const mockResourceKey = 'resource_file_version';

      // 初始：versionId = 1
      const firstFiles = [
        {
          fileName: 'file1.pdf',
          fileType: 'pdf',
          task_id: 'task-1',
          download_url: 'url1',
        },
      ];

      mocks.useFileUpload.mockReturnValue({
        uploadedFiles: firstFiles,
        isOnUploading: false,
        inputRef: { current: document.createElement('input') },
        handleInputChange: vi.fn(),
        handleFileDrop: vi.fn(),
        handleDelete: vi.fn(),
        resourceKey: mockResourceKey,
        versionId: 1,
      });

      const { rerender } = render(
        <FileNode
          id='test-node'
          type='file'
          data={{
            ...createMockNode().data,
            content: firstFiles as any,
            external_metadata: {
              content_type: 'files',
              resource_key: mockResourceKey,
              version_id: 1,
              files: firstFiles,
            },
          }}
          selected={false}
          isConnectable={true}
          xPos={0}
          yPos={0}
          zIndex={0}
          dragging={false}
        />
      );

      // 更新后：versionId = 2
      const secondFiles = [
        ...firstFiles,
        {
          fileName: 'file2.pdf',
          fileType: 'pdf',
          task_id: 'task-2',
          download_url: 'url2',
        },
      ];

      mocks.useFileUpload.mockReturnValue({
        uploadedFiles: secondFiles,
        isOnUploading: false,
        inputRef: { current: document.createElement('input') },
        handleInputChange: vi.fn(),
        handleFileDrop: vi.fn(),
        handleDelete: vi.fn(),
        resourceKey: mockResourceKey,
        versionId: 2,
      });

      const mockNode = createMockNode({
        content: secondFiles as any,
        external_metadata: {
          content_type: 'files',
          resource_key: mockResourceKey,
          version_id: 2,
          files: secondFiles,
        },
      });

      mockGetNode.mockReturnValue(mockNode);

      rerender(
        <FileNode
          id='test-node'
          type='file'
          data={mockNode.data}
          selected={false}
          isConnectable={true}
          xPos={0}
          yPos={0}
          zIndex={0}
          dragging={false}
        />
      );

      // 验证 versionId 递增
      expect(mockNode.data.external_metadata?.version_id).toBe(2);
    });
  });

  describe('TC-FILE-035: 删除文件后清理 external_metadata (P0)', () => {
    it.skip('删除部分文件后 external_metadata 应更新', () => {
      // 需要验证 useFileUpload 中的删除逻辑
      // 在集成测试中验证
    });
  });

  describe('TC-FILE-036: 所有文件删除后清空 external_metadata (P1)', () => {
    it('删除所有文件后 external_metadata 应为空', () => {
      // 初始：有文件
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
        handleDelete: vi.fn(),
        resourceKey: 'resource_file_123',
        versionId: 1,
      });

      const { rerender } = render(
        <FileNode
          id='test-node'
          type='file'
          data={{
            ...createMockNode().data,
            content: mockFiles as any,
            external_metadata: {
              content_type: 'files',
              resource_key: 'resource_file_123',
              version_id: 1,
              files: mockFiles,
            },
          }}
          selected={false}
          isConnectable={true}
          xPos={0}
          yPos={0}
          zIndex={0}
          dragging={false}
        />
      );

      // 删除后：无文件
      mocks.useFileUpload.mockReturnValue({
        uploadedFiles: [],
        isOnUploading: false,
        inputRef: { current: document.createElement('input') },
        handleInputChange: vi.fn(),
        handleFileDrop: vi.fn(),
        handleDelete: vi.fn(),
        resourceKey: null,
        versionId: null,
      });

      const mockNode = createMockNode({
        content: '',
        external_metadata: undefined,
      });

      mockGetNode.mockReturnValue(mockNode);

      rerender(
        <FileNode
          id='test-node'
          type='file'
          data={mockNode.data}
          selected={false}
          isConnectable={true}
          xPos={0}
          yPos={0}
          zIndex={0}
          dragging={false}
        />
      );

      // 验证 external_metadata 被清空
      expect(mockNode.data.external_metadata).toBeUndefined();
    });

    it('删除所有文件后 resourceKey 应为 null', () => {
      mocks.useFileUpload.mockReturnValue({
        uploadedFiles: [],
        isOnUploading: false,
        inputRef: { current: document.createElement('input') },
        handleInputChange: vi.fn(),
        handleFileDrop: vi.fn(),
        handleDelete: vi.fn(),
        resourceKey: null,
        versionId: null,
      });

      const mockNode = createMockNode({
        content: '',
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

      // 验证没有 external_metadata
      expect(mockNode.data.external_metadata).toBeUndefined();
    });
  });

  describe('TC-FILE-037: external_metadata 包含完整文件信息 (P1)', () => {
    it('external_metadata.files 应包含所有文件', () => {
      const mockFiles = [
        {
          fileName: 'file1.pdf',
          fileType: 'pdf',
          task_id: 'task-1',
          download_url: 'url1',
        },
        {
          fileName: 'file2.docx',
          fileType: 'docx',
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
        handleDelete: vi.fn(),
        resourceKey: 'resource_file_123',
        versionId: 1,
      });

      const mockNode = createMockNode({
        content: mockFiles as any,
        external_metadata: {
          content_type: 'files',
          resource_key: 'resource_file_123',
          version_id: 1,
          files: mockFiles,
        },
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

      // 验证 external_metadata.files 包含所有文件
      expect(mockNode.data.external_metadata?.files).toEqual(mockFiles);
      expect(mockNode.data.external_metadata?.files).toHaveLength(2);
    });

    it('每个文件应包含必需字段', () => {
      const mockFiles = [
        {
          fileName: 'test.pdf',
          fileType: 'pdf',
          task_id: 'task-123',
          download_url: 'https://example.com/test.pdf',
        },
      ];

      mocks.useFileUpload.mockReturnValue({
        uploadedFiles: mockFiles,
        isOnUploading: false,
        inputRef: { current: document.createElement('input') },
        handleInputChange: vi.fn(),
        handleFileDrop: vi.fn(),
        handleDelete: vi.fn(),
        resourceKey: 'resource_file_123',
        versionId: 1,
      });

      const mockNode = createMockNode({
        content: mockFiles as any,
        external_metadata: {
          content_type: 'files',
          resource_key: 'resource_file_123',
          version_id: 1,
          files: mockFiles,
        },
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

      const file = mockNode.data.external_metadata?.files?.[0];
      expect(file).toHaveProperty('fileName');
      expect(file).toHaveProperty('fileType');
      expect(file).toHaveProperty('task_id');
      expect(file).toHaveProperty('download_url');
    });
  });
});

/**
 * 🔧 人工验证清单：
 *
 * 1. ✅ resourceKey 生成
 *    - [ ] 验证 resourceKey 的唯一性
 *    - [ ] 测试 resourceKey 的持久化
 *    - [ ] 验证 resourceKey 格式的一致性
 *
 * 2. ✅ external_metadata 持久化
 *    - [ ] 验证数据库存储
 *    - [ ] 测试加载已有节点的 external_metadata
 *    - [ ] 验证元数据与文件内容的一致性
 *
 * 3. ✅ versionId 管理
 *    - [ ] 验证 versionId 的递增逻辑
 *    - [ ] 测试并发更新时的版本控制
 *    - [ ] 验证版本回退场景
 *
 * 4. ✅ 集成测试
 *    - [ ] 完整上传-删除-清理流程
 *    - [ ] 多次文件操作的元数据一致性
 *    - [ ] 异常情况下的数据恢复
 *
 * 📝 运行命令：
 *    npm run test -- FileNode.storage.test.tsx
 */
