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
import { ResourceDescriptor, Batch } from './types';
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
  batch: Batch; // Batch data (content + indexing_config)
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
  status: 'completed' | 'prepared' | 'pending' | 'failed' | 'skipped';
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
      batch,
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

    // Step 4: Extract entries from Batch
    let entries: VectorEntry[];
    try {
      // Extract indexing config from Batch
      const indexingConfig = batch.indexing_config;

      if (!indexingConfig) {
        return {
          success: false,
          status: 'failed',
          error: 'Batch missing indexing_config',
        };
      }

      // Extract entries from Batch.content using Batch.indexing_config
      entries = VectorIndexing.extractEntries(batch.content, indexingConfig);

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

    // Step 6: Return entries for CloudTemplateLoader to handle embedding
    // Phase 3.8: CloudTemplateLoader now handles the actual embedding API call
    // This method just prepares the entries and returns them
    return {
      success: true,
      status: 'prepared', // Changed from 'completed' to 'prepared' (entries ready, not embedded yet)
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
  }

  /**
   * Extract indexing configuration from resource descriptor
   *
   * DEPRECATED: This method is no longer used as of Batch type introduction.
   * Indexing config is now extracted directly from Batch.indexing_config.
   *
   * @param resource - Resource descriptor
   * @returns Indexing config or null
   * @deprecated Use Batch.indexing_config instead
   */
  private static extractIndexingConfig(
    resource: ResourceDescriptor
  ): any | null {
    console.warn(
      '[VectorAutoRebuildService] extractIndexingConfig is deprecated. Use Batch.indexing_config instead.'
    );

    // Fallback for backward compatibility (though should not be called)
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
   * DEPRECATED in Phase 3.8: This method is no longer used.
   * Embedding is now handled by CloudTemplateLoader.callEmbeddingAPI() which:
   * 1. Runs server-side with proper authentication
   * 2. Uses absolute URLs (not relative paths)
   * 3. Properly transforms data format for PuppyStorage
   *
   * This method is kept for reference but should not be called.
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
    console.warn(
      '[VectorAutoRebuildService] DEPRECATED: triggerEmbedding() should not be called. ' +
        'Use CloudTemplateLoader.callEmbeddingAPI() instead.'
    );

    console.log('[VectorAutoRebuildService] Triggering embedding:', {
      entriesCount: entries.length,
      collectionName,
      modelId: model.id,
    });

    // DEPRECATED: This fetch call doesn't work server-side (relative path)
    // Kept for reference only
    throw new Error(
      'triggerEmbedding() is deprecated. Use CloudTemplateLoader.callEmbeddingAPI() instead.'
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

    if (!options.batch) {
      return 'Missing batch';
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
 * DEPRECATED: This function needs to be updated to use Batch type.
 * Use CloudTemplateLoader.processVectorCollection() directly instead.
 *
 * @param resources - Array of resource descriptors
 * @param batchMap - Map of resource ID to Batch data
 * @param availableModels - User's available models
 * @param userId - User ID
 * @param workspaceId - Workspace ID
 * @returns Map of resource ID to rebuild result
 * @deprecated Use CloudTemplateLoader instead
 */
export async function batchAutoRebuild(
  resources: ResourceDescriptor[],
  batchMap: Map<string, Batch>,
  availableModels: Model[],
  userId: string,
  workspaceId: string
): Promise<Map<string, RebuildResult>> {
  const results = new Map<string, RebuildResult>();

  for (const resource of resources) {
    if (VectorAutoRebuildService.shouldAttemptAutoRebuild(resource)) {
      const batch = batchMap.get(resource.id);

      if (batch) {
        const result = await VectorAutoRebuildService.attemptAutoRebuild({
          resourceDescriptor: resource,
          batch,
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
