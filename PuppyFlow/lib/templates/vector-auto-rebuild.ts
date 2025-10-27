/**
 * Vector Auto-Rebuild Service
 *
 * Handles automatic vector index rebuilding during template instantiation.
 * When a template with vector resources is instantiated, this service:
 * 1. Checks model compatibility
 * 2. Extracts vector entries from content
 * 3. Triggers embedding (non-blocking)
 * 4. Updates index status
 *
 * Phase 1.9: Auto-Rebuild Vector Indexes
 */

import { Model } from '@/app/components/states/AppSettingsContext';
import { ResourceDescriptor } from './types';
import { VectorIndexing, VectorEntry } from '@/lib/indexing/vector-indexing';
import {
  ModelCompatibilityService,
  CompatibilityResult,
} from './model-compatibility';
import { NormalizedEmbeddingModel } from './model-bridge';

/**
 * Rebuild Options
 *
 * Parameters needed to attempt automatic vector index rebuilding.
 */
export interface RebuildOptions {
  resourceDescriptor: ResourceDescriptor;
  content: any[]; // Raw content from which to extract entries
  availableModels: Model[]; // User's available models from AppSettings
  userId: string;
  workspaceId: string;
  blockId: string;
}

/**
 * Rebuild Result
 *
 * Result of the auto-rebuild attempt.
 */
export interface RebuildResult {
  success: boolean;
  status: 'completed' | 'pending' | 'failed' | 'skipped';
  entries?: VectorEntry[];
  collectionName?: string;
  model?: NormalizedEmbeddingModel;
  error?: string;
  warning?: string;
  compatibilityResult?: CompatibilityResult;
}

/**
 * Vector Auto-Rebuild Service
 *
 * Main service class for automatic vector index rebuilding.
 */
export class VectorAutoRebuildService {
  /**
   * Attempt automatic vector index rebuilding
   *
   * Main entry point for auto-rebuild logic. This method:
   * 1. Validates the resource is a vector_collection
   * 2. Checks model compatibility
   * 3. Decides action based on compatibility
   * 4. Extracts entries and triggers embedding if appropriate
   *
   * @param options - Rebuild options
   * @returns Rebuild result
   */
  static async attemptAutoRebuild(
    options: RebuildOptions
  ): Promise<RebuildResult> {
    const {
      resourceDescriptor,
      content,
      availableModels,
      userId,
      workspaceId,
      blockId,
    } = options;

    // Step 1: Validate resource type
    if (resourceDescriptor.type !== 'vector_collection') {
      return {
        success: false,
        status: 'skipped',
        warning: 'Resource is not a vector_collection, skipping auto-rebuild',
      };
    }

    // Step 2: Check model compatibility
    const compatibility = ModelCompatibilityService.checkCompatibility(
      resourceDescriptor.target.embedding_model,
      availableModels
    );

    // Step 3: Decide action based on compatibility
    switch (compatibility.action) {
      case 'skip':
        return {
          success: false,
          status: 'skipped',
          warning: compatibility.reason,
          compatibilityResult: compatibility,
        };

      case 'manual_select':
        return {
          success: false,
          status: 'pending',
          warning: `${compatibility.reason}. User needs to manually select a model and build index.`,
          compatibilityResult: compatibility,
        };

      case 'auto_rebuild':
      case 'warn_and_rebuild':
        // Proceed with auto-rebuild
        break;

      default:
        return {
          success: false,
          status: 'failed',
          error: `Unknown compatibility action: ${compatibility.action}`,
        };
    }

    // Step 4: Extract entries from content
    let entries: VectorEntry[];
    try {
      // Get indexing config from resource descriptor
      const indexingConfig = this.extractIndexingConfig(resourceDescriptor);

      if (!indexingConfig) {
        return {
          success: false,
          status: 'failed',
          error: 'No indexing configuration found in resource descriptor',
        };
      }

      // Extract entries
      entries = VectorIndexing.extractEntries(content, indexingConfig);

      if (entries.length === 0) {
        return {
          success: false,
          status: 'pending',
          warning:
            'No entries extracted from content. Index will remain pending.',
        };
      }
    } catch (error) {
      return {
        success: false,
        status: 'failed',
        error: `Failed to extract entries: ${(error as Error).message}`,
      };
    }

    // Step 5: Generate collection name
    const collectionName = this.generateCollectionName(
      userId,
      blockId,
      workspaceId
    );

    // Step 6: Trigger embedding (non-blocking in Phase 1.9)
    // Note: Actual embedding API will be implemented in Phase 2
    try {
      await this.triggerEmbedding(
        entries,
        collectionName,
        compatibility.suggestedModel!
      );

      return {
        success: true,
        status: 'completed',
        entries,
        collectionName,
        model: compatibility.suggestedModel,
        warning:
          compatibility.action === 'warn_and_rebuild' ||
          compatibility.confidence === 'low'
            ? compatibility.reason
            : undefined,
        compatibilityResult: compatibility,
      };
    } catch (error) {
      return {
        success: false,
        status: 'failed',
        error: `Failed to trigger embedding: ${(error as Error).message}`,
        entries, // Still return entries for debugging
      };
    }
  }

  /**
   * Extract indexing configuration from resource descriptor
   *
   * @param resource - Resource descriptor
   * @returns Indexing config or null
   */
  private static extractIndexingConfig(
    resource: ResourceDescriptor
  ): any | null {
    // For vector_collection resources, the indexing config should be in mounted_paths
    if (resource.mounted_paths?.indexing_config) {
      // The indexing_config path points to the indexing configuration
      // In the actual implementation, this would be extracted from the workflow JSON
      // For now, we'll construct a basic config from the resource descriptor

      return {
        type: 'vector',
        key_path: [], // Will be extracted from actual content
        value_path: [],
      };
    }

    // Fallback: Construct config from chunks and content paths
    if (resource.mounted_paths?.chunks || resource.mounted_paths?.content) {
      return {
        type: 'vector',
        key_path: resource.mounted_paths?.chunks || [],
        value_path: resource.mounted_paths?.content || [],
      };
    }

    return null;
  }

  /**
   * Generate collection name for vector database
   *
   * @param userId - User ID
   * @param blockId - Block ID
   * @param workspaceId - Workspace ID
   * @returns Collection name
   */
  private static generateCollectionName(
    userId: string,
    blockId: string,
    workspaceId: string
  ): string {
    // Format: user_{userId}_workspace_{workspaceId}_block_{blockId}
    return `user_${userId}_workspace_${workspaceId}_block_${blockId}`;
  }

  /**
   * Trigger embedding for vector entries
   *
   * This is a placeholder for Phase 1.9. The actual implementation will be
   * completed in Phase 2 when the CloudTemplateLoader and embedding API are integrated.
   *
   * @param entries - Vector entries to embed
   * @param collectionName - Collection name in vector DB
   * @param model - Model to use for embedding
   */
  private static async triggerEmbedding(
    entries: VectorEntry[],
    collectionName: string,
    model: NormalizedEmbeddingModel
  ): Promise<void> {
    // TODO: Phase 2 implementation
    // This will call the embedding API endpoint:
    // POST /api/storage/vector/embed
    // Body: {
    //   entries: entries.map(e => e.content),
    //   collection_name: collectionName,
    //   model_id: model.id,
    //   key_path: [...],
    //   value_path: [...]
    // }

    console.log('[Phase 1.9 Placeholder] Triggering embedding:', {
      entriesCount: entries.length,
      collectionName,
      modelId: model.id,
      modelProvider: model.provider,
    });

    // Simulate async operation
    await new Promise(resolve => setTimeout(resolve, 100));

    // In Phase 2, this will:
    // 1. Send entries to PuppyEngine for embedding
    // 2. Store vectors in ChromaDB
    // 3. Update indexing status to 'completed'
    // 4. Store collection metadata

    console.log(
      '[Phase 1.9 Placeholder] Embedding triggered successfully (simulated)'
    );
  }

  /**
   * Validate rebuild options
   *
   * @param options - Options to validate
   * @returns True if valid, error message if invalid
   */
  static validateOptions(options: RebuildOptions): true | string {
    if (!options.resourceDescriptor) {
      return 'Missing resourceDescriptor';
    }

    if (!options.content) {
      return 'Missing content';
    }

    if (!options.availableModels || options.availableModels.length === 0) {
      return 'Missing availableModels';
    }

    if (!options.userId) {
      return 'Missing userId';
    }

    if (!options.workspaceId) {
      return 'Missing workspaceId';
    }

    if (!options.blockId) {
      return 'Missing blockId';
    }

    return true;
  }

  /**
   * Get rebuild status summary for UI display
   *
   * @param result - Rebuild result
   * @returns Human-readable summary
   */
  static getStatusSummary(result: RebuildResult): string {
    if (result.success) {
      const modelInfo = result.model
        ? ` using ${result.model.name} (${result.model.provider})`
        : '';
      return `✅ Index built successfully${modelInfo}. ${result.entries?.length || 0} entries indexed.`;
    }

    if (result.status === 'pending') {
      return `⏳ Index pending. ${result.warning || result.error || 'User action required.'}`;
    }

    if (result.status === 'skipped') {
      return `⏭️ Index skipped. ${result.warning || 'No action taken.'}`;
    }

    return `❌ Index build failed. ${result.error || 'Unknown error.'}`;
  }

  /**
   * Check if a resource should attempt auto-rebuild
   *
   * @param resource - Resource descriptor
   * @returns True if should attempt auto-rebuild
   */
  static shouldAttemptAutoRebuild(resource: ResourceDescriptor): boolean {
    if (
      resource.type !== 'vector_collection' ||
      !resource.target.embedding_model
    ) {
      return false;
    }

    // Don't attempt auto-rebuild for manual strategy
    const strategy = resource.target.embedding_model.fallback_strategy;
    return strategy !== 'manual';
  }
}

/**
 * Batch auto-rebuild for multiple vector resources
 *
 * @param resources - Array of resource descriptors
 * @param contentMap - Map of resource ID to content
 * @param availableModels - User's available models
 * @param userId - User ID
 * @param workspaceId - Workspace ID
 * @returns Map of resource ID to rebuild result
 */
export async function batchAutoRebuild(
  resources: ResourceDescriptor[],
  contentMap: Map<string, any[]>,
  availableModels: Model[],
  userId: string,
  workspaceId: string
): Promise<Map<string, RebuildResult>> {
  const results = new Map<string, RebuildResult>();

  for (const resource of resources) {
    if (VectorAutoRebuildService.shouldAttemptAutoRebuild(resource)) {
      const content = contentMap.get(resource.id);

      if (content) {
        const result = await VectorAutoRebuildService.attemptAutoRebuild({
          resourceDescriptor: resource,
          content,
          availableModels,
          userId,
          workspaceId,
          blockId: resource.block_id,
        });

        results.set(resource.id, result);
      }
    }
  }

  return results;
}
