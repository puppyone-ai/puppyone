/**
 * CloudTemplateLoader - Template Loader for Cloud Deployment
 *
 * Implements the TemplateLoader interface for loading and instantiating
 * workflow templates from Git-managed template files.
 *
 * Phase 2: Template Loader Implementation
 */

import { promises as fs } from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { set as setPath } from 'lodash';
import { Model } from '@/app/components/states/AppSettingsContext';
import { SERVER_ENV } from '@/lib/serverEnv';
import {
  TemplateLoader,
  TemplateLoaderConfig,
  DEFAULT_LOADER_CONFIG,
} from './loader';
import {
  TemplatePackage,
  WorkflowDefinition,
  ResourceDescriptor,
} from './types';
import { PartitioningService, PART_SIZE } from '../storage/partitioning';
import { VectorIndexing } from '../indexing/vector-indexing';
import { VectorAutoRebuildService } from './vector-auto-rebuild';

/**
 * Storage threshold for deciding inline vs external storage
 * Aligned with STORAGE_SPEC.md: 1MB
 */
const STORAGE_THRESHOLD = 1024 * 1024; // 1MB

/**
 * CloudTemplateLoader
 *
 * Loads templates from filesystem and instantiates them into user workspaces.
 */
export class CloudTemplateLoader implements TemplateLoader {
  private config: TemplateLoaderConfig;
  private currentTemplateId: string = '';

  constructor(config?: Partial<TemplateLoaderConfig>) {
    this.config = { ...DEFAULT_LOADER_CONFIG, ...config };
  }

  /**
   * Load a template package from Git
   *
   * Reads the package.json file and validates its structure.
   *
   * @param templateId - Template identifier (e.g., "agentic-rag")
   * @returns Template package with metadata, workflow, and resources
   */
  async loadTemplate(templateId: string): Promise<TemplatePackage> {
    this.currentTemplateId = templateId;

    try {
      // Build path to template package.json
      const templateDir = path.join(process.cwd(), 'templates', templateId);
      const packagePath = path.join(templateDir, 'package.json');

      // Read and parse package.json
      const packageContent = await fs.readFile(packagePath, 'utf-8');
      const pkg: TemplatePackage = JSON.parse(packageContent);

      // Validate package structure
      this.validateTemplatePackage(pkg, templateId);

      console.log(
        `[CloudTemplateLoader] Successfully loaded template: ${templateId}`
      );

      return pkg;
    } catch (error) {
      console.error(
        `[CloudTemplateLoader] Failed to load template ${templateId}:`,
        error
      );
      throw new Error(
        `Failed to load template ${templateId}: ${(error as Error).message}`
      );
    }
  }

  /**
   * Instantiate a template into a user workspace
   *
   * This method:
   * 1. Clones the workflow JSON
   * 2. Processes each resource (copy and rewrite references)
   * 3. Attempts auto-rebuild for vector resources
   * 4. Returns the instantiated workflow
   *
   * @param pkg - Template package
   * @param userId - User ID
   * @param workspaceId - Workspace ID
   * @param availableModels - User's available models (for auto-rebuild)
   * @returns Instantiated workflow definition
   */
  async instantiateTemplate(
    pkg: TemplatePackage,
    userId: string,
    workspaceId: string,
    availableModels: Model[]
  ): Promise<WorkflowDefinition> {
    console.log(
      `[CloudTemplateLoader] Instantiating template ${pkg.metadata.id} for user ${userId}`
    );

    // Clone workflow to avoid mutating original
    const workflow: WorkflowDefinition = JSON.parse(
      JSON.stringify(pkg.workflow)
    );

    // Process each resource
    for (const resource of pkg.resources.resources) {
      console.log(
        `[CloudTemplateLoader] Processing resource: ${resource.id} (type: ${resource.type})`
      );

      try {
        await this.processResource(
          resource,
          userId,
          workspaceId,
          workflow,
          availableModels
        );
      } catch (error) {
        console.error(
          `[CloudTemplateLoader] Failed to process resource ${resource.id}:`,
          error
        );
        throw new Error(
          `Failed to process resource ${resource.id}: ${(error as Error).message}`
        );
      }
    }

    console.log(
      `[CloudTemplateLoader] Successfully instantiated template ${pkg.metadata.id}`
    );

    return workflow;
  }

  /**
   * Process a single resource
   *
   * Reads the resource file, determines storage strategy, uploads if needed,
   * and updates workflow references.
   *
   * @param resource - Resource descriptor from manifest
   * @param userId - User ID
   * @param workspaceId - Workspace ID
   * @param workflow - Workflow definition (mutated)
   * @param availableModels - User's available models
   */
  private async processResource(
    resource: ResourceDescriptor,
    userId: string,
    workspaceId: string,
    workflow: WorkflowDefinition,
    availableModels: Model[]
  ): Promise<void> {
    // Read resource content from filesystem
    const resourcePath = path.join(
      process.cwd(),
      'templates',
      this.currentTemplateId,
      resource.source.path
    );
    const resourceContent = await fs.readFile(resourcePath, 'utf-8');

    // Parse if structured
    let parsedContent: any;
    if (resource.source.format === 'structured') {
      parsedContent = JSON.parse(resourceContent);
    }

    // Determine storage strategy based on size
    const contentSize = Buffer.byteLength(resourceContent, 'utf-8');
    const isExternal = contentSize >= STORAGE_THRESHOLD;

    console.log(
      `[CloudTemplateLoader] Resource ${resource.id}: ${contentSize} bytes, ${isExternal ? 'external' : 'inline'} storage`
    );

    // Find the target block in workflow
    const block = workflow.blocks.find(b => b.id === resource.block_id);
    if (!block) {
      throw new Error(
        `Block ${resource.block_id} not found in workflow for resource ${resource.id}`
      );
    }

    // Handle different resource types
    switch (resource.type) {
      case 'external_storage':
        await this.processExternalStorage(
          resource,
          resourceContent,
          parsedContent,
          isExternal,
          userId,
          block,
          workflow
        );
        break;

      case 'vector_collection':
        await this.processVectorCollection(
          resource,
          resourceContent,
          parsedContent,
          isExternal,
          userId,
          workspaceId,
          block,
          workflow,
          availableModels
        );
        break;

      case 'file':
        await this.processFile(resource, resourcePath, userId, block, workflow);
        break;

      default:
        throw new Error(`Unknown resource type: ${(resource as any).type}`);
    }
  }

  /**
   * Process external_storage resource
   */
  private async processExternalStorage(
    resource: ResourceDescriptor,
    resourceContent: string,
    parsedContent: any,
    isExternal: boolean,
    userId: string,
    block: any,
    workflow: WorkflowDefinition
  ): Promise<void> {
    if (isExternal) {
      // Upload with partitioning
      const versionId = uuidv4();
      const targetKey = `${userId}/${block.id}/${versionId}`;
      const resourceKey = await this.uploadWithPartitioning(
        resourceContent,
        resource.source.format,
        targetKey,
        userId
      );

      // Update workflow reference to external storage
      this.updateWorkflowReference(
        workflow,
        block.id,
        resource.mounted_path,
        resourceKey
      );

      // Set storage metadata
      if (!block.data.external_metadata) {
        block.data.external_metadata = {};
      }
      block.data.external_metadata.resource_key = resourceKey;
      block.data.storage_class = 'external';
      block.data.isExternalStorage = true;
    } else {
      // Inline storage
      this.updateWorkflowReference(
        workflow,
        block.id,
        resource.mounted_path,
        parsedContent || resourceContent
      );
      block.data.storage_class = 'internal';
      block.data.isExternalStorage = false;

      // Clear any old external_metadata from template
      if (block.data.external_metadata) {
        delete block.data.external_metadata;
      }
    }
  }

  /**
   * Process vector_collection resource
   */
  private async processVectorCollection(
    resource: ResourceDescriptor,
    resourceContent: string,
    parsedContent: any,
    isExternal: boolean,
    userId: string,
    workspaceId: string,
    block: any,
    workflow: WorkflowDefinition,
    availableModels: Model[]
  ): Promise<void> {
    // Upload content (always for vector collections per architecture)
    const versionId = uuidv4();
    const targetKey = `${userId}/${block.id}/${versionId}`;

    if (isExternal) {
      const resourceKey = await this.uploadWithPartitioning(
        resourceContent,
        resource.source.format,
        targetKey,
        userId
      );

      // Set external storage metadata
      if (!block.data.external_metadata) {
        block.data.external_metadata = {};
      }
      block.data.external_metadata.resource_key = resourceKey;
      block.data.storage_class = 'external';
      block.data.isExternalStorage = true;
    } else {
      // Inline storage
      if (resource.mounted_paths?.content) {
        this.updateWorkflowReference(
          workflow,
          block.id,
          resource.mounted_paths.content,
          parsedContent || resourceContent
        );
      }
      block.data.storage_class = 'internal';
      block.data.isExternalStorage = false;

      // Clear any old external_metadata from template
      if (block.data.external_metadata) {
        delete block.data.external_metadata;
      }
    }

    // Initialize indexing list with pending status
    if (!block.data.indexingList) {
      block.data.indexingList = [];
    }

    // Get indexing config from mounted_paths
    const indexingConfigPath = resource.mounted_paths?.indexing_config;
    if (indexingConfigPath && block.data.indexingList.length > 0) {
      const indexingItem = block.data.indexingList[0];

      // Set pending status and empty entries
      indexingItem.entries = [];
      indexingItem.status = 'pending';
      indexingItem.index_name = '';
      indexingItem.collection_configs = {};

      // Attempt auto-rebuild if enabled
      if (this.config.enableAutoRebuild && Array.isArray(parsedContent)) {
        try {
          const rebuildResult =
            await VectorAutoRebuildService.attemptAutoRebuild({
              resourceDescriptor: resource,
              content: parsedContent,
              availableModels,
              userId,
              workspaceId,
              blockId: block.id,
            });

          if (rebuildResult.success && rebuildResult.entries) {
            indexingItem.entries = rebuildResult.entries;
            indexingItem.status = 'pending'; // Still pending actual embedding
            console.log(
              `[CloudTemplateLoader] Auto-rebuild prepared ${rebuildResult.entries.length} entries for block ${block.id}`
            );
          }
        } catch (error) {
          console.warn(
            `[CloudTemplateLoader] Auto-rebuild failed for block ${block.id}:`,
            error
          );
          // Continue with empty entries - user can manually trigger
        }
      }
    }
  }

  /**
   * Upload a file directly to PuppyStorage backend
   *
   * @param fileKey - Full key for the file (userId/blockId/versionId/fileName)
   * @param fileBuffer - File content as Buffer
   * @param fileName - File name
   * @param mimeType - MIME type of the file
   * @param userId - User ID for namespace
   */
  private async uploadFileToPuppyStorage(
    fileKey: string,
    fileBuffer: Buffer,
    fileName: string,
    mimeType: string,
    userId: string
  ): Promise<void> {
    const url = `${SERVER_ENV.PUPPY_STORAGE_BACKEND}/files/upload/file`;

    // Parse key: userId/blockId/versionId/fileName
    const [uid, blockId, ...rest] = fileKey.split('/');

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-service-key': SERVER_ENV.SERVICE_KEY || '',
      },
      body: JSON.stringify({
        user_id: userId,
        block_id: blockId,
        file_path: rest.join('/'),
        file_name: fileName,
        content: fileBuffer.toString('base64'),
        mime_type: mimeType,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `File upload failed: ${response.status} ${response.statusText} - ${errorText}`
      );
    }
  }

  /**
   * Process file resource
   */
  private async processFile(
    resource: ResourceDescriptor,
    resourcePath: string,
    userId: string,
    block: any,
    workflow: WorkflowDefinition
  ): Promise<void> {
    // For file resources, we need to upload the file as-is
    // Files are always external, no partitioning
    const fileName = path.basename(resourcePath);
    const fileBuffer = await fs.readFile(resourcePath);
    const targetKey = `${userId}/${block.id}/files/${fileName}`;

    console.log(`[CloudTemplateLoader] Uploading file: ${fileName}`);

    // Upload file
    await this.uploadFileToPuppyStorage(
      targetKey,
      fileBuffer,
      fileName,
      resource.source.mime_type || 'application/octet-stream',
      userId
    );

    console.log(`[CloudTemplateLoader] File uploaded: ${targetKey}`);

    // Update workflow reference
    if (!block.data.uploadedFiles) {
      block.data.uploadedFiles = [];
    }

    block.data.uploadedFiles.push({
      key: targetKey,
      name: fileName,
      size: fileBuffer.length,
      type: resource.source.mime_type || 'application/octet-stream',
    });
  }

  /**
   * Upload a part directly to PuppyStorage backend
   *
   * @param partKey - Full key for the part (userId/blockId/versionId/partName)
   * @param content - Part content as Uint8Array
   * @param contentType - MIME type of the content
   * @param userId - User ID for namespace
   * @returns Upload result with etag and size
   */
  private async uploadPartToPuppyStorage(
    partKey: string,
    content: Uint8Array,
    contentType: string,
    userId: string
  ): Promise<{ etag: string; size: number }> {
    const url = `${SERVER_ENV.PUPPY_STORAGE_BACKEND}/files/upload/part/direct`;

    // Parse key: userId/blockId/versionId/partName
    const [uid, blockId, versionId, ...rest] = partKey.split('/');
    const fileName = rest.join('/');

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-service-key': SERVER_ENV.SERVICE_KEY || '',
      },
      body: JSON.stringify({
        user_id: userId,
        block_id: blockId,
        version_id: versionId,
        file_name: fileName,
        content: Buffer.from(content).toString('base64'),
        content_type: contentType,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Upload part failed: ${response.status} ${response.statusText} - ${errorText}`
      );
    }

    return await response.json();
  }

  /**
   * Upload content with partitioning
   *
   * Uses PartitioningService to partition large content and uploads each part.
   *
   * @param content - Content to upload
   * @param format - Content format ('text' or 'structured')
   * @param targetKey - Base key for uploaded resource
   * @param userId - User ID for namespace
   * @returns Final resource key
   */
  private async uploadWithPartitioning(
    content: string,
    format: 'text' | 'structured' | 'binary',
    targetKey: string,
    userId: string
  ): Promise<string> {
    const contentType = format === 'structured' ? 'structured' : 'text';
    const parts = PartitioningService.partition(content, contentType);

    console.log(
      `[CloudTemplateLoader] Uploading ${parts.length} parts for ${targetKey}...`
    );

    const manifestParts = [];

    // Upload each part
    for (const part of parts) {
      const partKey = `${targetKey}/${part.name}`;
      const result = await this.uploadPartToPuppyStorage(
        partKey,
        part.bytes,
        part.mime,
        userId
      );

      manifestParts.push({
        name: part.name,
        mime: part.mime,
        size: result.size,
        etag: result.etag,
      });
    }

    // Create manifest
    const manifest = {
      format: 'partitioned',
      parts: manifestParts,
    };

    // Upload manifest
    const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
    await this.uploadPartToPuppyStorage(
      `${targetKey}/manifest.json`,
      manifestBytes,
      'application/json',
      userId
    );

    console.log(
      `[CloudTemplateLoader] Uploaded ${parts.length} parts + manifest for ${targetKey}`
    );

    return targetKey;
  }

  /**
   * Update workflow reference
   *
   * Uses lodash.set() to update nested properties in workflow blocks.
   *
   * @param workflow - Workflow definition
   * @param blockId - Block ID
   * @param path - Property path (e.g., "data.content")
   * @param value - New value
   */
  private updateWorkflowReference(
    workflow: WorkflowDefinition,
    blockId: string,
    path: string,
    value: any
  ): void {
    const block = workflow.blocks.find(b => b.id === blockId);
    if (!block) {
      throw new Error(`Block ${blockId} not found in workflow`);
    }

    // Convert mounted_path to property path
    // e.g., "data.content" -> ["data", "content"]
    const pathSegments = path.split('.');

    // Set the value using lodash.set
    setPath(block, pathSegments, value);

    console.log(`[CloudTemplateLoader] Updated ${blockId}.${path}`);
  }

  /**
   * Validate template package structure
   */
  private validateTemplatePackage(
    pkg: TemplatePackage,
    expectedId: string
  ): void {
    if (!pkg.metadata) {
      throw new Error('Template package missing metadata');
    }

    if (!pkg.workflow) {
      throw new Error('Template package missing workflow');
    }

    if (!pkg.resources) {
      throw new Error('Template package missing resources');
    }

    if (pkg.metadata.id !== expectedId) {
      throw new Error(
        `Template ID mismatch: expected ${expectedId}, got ${pkg.metadata.id}`
      );
    }

    if (!Array.isArray(pkg.workflow.blocks)) {
      throw new Error('Workflow blocks must be an array');
    }

    if (!Array.isArray(pkg.workflow.edges)) {
      throw new Error('Workflow edges must be an array');
    }

    if (!Array.isArray(pkg.resources.resources)) {
      throw new Error('Resources must be an array');
    }
  }
}
