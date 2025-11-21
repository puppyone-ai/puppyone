/**
 * Vector Auto-Rebuild Service - Unit Tests
 *
 * Tests for VectorAutoRebuildService.
 *
 * Phase 1.9: Auto-Rebuild Vector Indexes
 */

import { Model } from '@/app/components/states/AppSettingsContext';
import { ResourceDescriptor } from '../types';
import {
  VectorAutoRebuildService,
  RebuildOptions,
} from '../vector-auto-rebuild';

describe('VectorAutoRebuildService', () => {
  // Test data
  const openAIModel: Model = {
    id: 'text-embedding-ada-002',
    name: 'Ada 002',
    provider: 'OpenAI',
    isLocal: false,
    active: true,
    type: 'embedding',
  };

  const vectorResource: ResourceDescriptor = {
    id: 'test-vector-kb',
    type: 'vector_collection',
    block_id: 'block123',
    mounted_path: 'data.content',
    mounted_paths: {
      content: 'data.content',
      entries: 'data.indexingList[0].entries',
      indexing_config: 'data.indexingList[0]',
    },
    source: {
      path: 'resources/test-kb.json',
      format: 'structured',
    },
    target: {
      pattern: '${userId}/${blockId}',
      requires_user_scope: true,
      vector_handling: 'preserve_entries_only',
      embedding_model: {
        model_id: 'text-embedding-ada-002',
        provider: 'OpenAI',
        fallback_strategy: 'auto',
      },
    },
  };

  const nonVectorResource: ResourceDescriptor = {
    id: 'test-text',
    type: 'external_storage',
    block_id: 'block456',
    mounted_path: 'data.content',
    source: {
      path: 'resources/test.txt',
      format: 'text',
    },
    target: {
      pattern: '${userId}/${blockId}',
      requires_user_scope: true,
    },
  };

  const testContent = [
    { question: 'What is AI?', answer: 'Artificial Intelligence...' },
    { question: 'What is ML?', answer: 'Machine Learning...' },
  ];

  describe('attemptAutoRebuild', () => {
    test('should skip non-vector resources', async () => {
      const options: RebuildOptions = {
        resourceDescriptor: nonVectorResource,
        content: testContent,
        availableModels: [openAIModel],
        userId: 'user123',
        workspaceId: 'ws456',
        blockId: 'block456',
      };

      const result = await VectorAutoRebuildService.attemptAutoRebuild(options);

      expect(result.success).toBe(false);
      expect(result.status).toBe('skipped');
      expect(result.warning).toContain('not a vector_collection');
    });

    test('should succeed with compatible model (auto strategy)', async () => {
      const options: RebuildOptions = {
        resourceDescriptor: vectorResource,
        content: testContent,
        availableModels: [openAIModel],
        userId: 'user123',
        workspaceId: 'ws456',
        blockId: 'block123',
      };

      const result = await VectorAutoRebuildService.attemptAutoRebuild(options);

      expect(result.success).toBe(true);
      expect(result.status).toBe('completed');
      expect(result.model).toBeDefined();
      expect(result.model?.id).toBe('text-embedding-ada-002');
      expect(result.collectionName).toContain('user_user123');
    });

    test('should remain pending when no compatible model (manual strategy)', async () => {
      const manualResource: ResourceDescriptor = {
        ...vectorResource,
        target: {
          ...vectorResource.target,
          embedding_model: {
            model_id: 'text-embedding-ada-002',
            provider: 'OpenAI',
            fallback_strategy: 'manual',
          },
        },
      };

      const ollamaModel: Model = {
        id: 'ollama/all-minilm',
        name: 'All-MiniLM',
        provider: 'Ollama',
        type: 'embedding',
      };

      const options: RebuildOptions = {
        resourceDescriptor: manualResource,
        content: testContent,
        availableModels: [ollamaModel], // Different provider
        userId: 'user123',
        workspaceId: 'ws456',
        blockId: 'block123',
      };

      const result = await VectorAutoRebuildService.attemptAutoRebuild(options);

      expect(result.success).toBe(false);
      expect(result.status).toBe('pending');
      expect(result.warning).toContain('manually select');
    });

    test('should skip when strategy is skip', async () => {
      const skipResource: ResourceDescriptor = {
        ...vectorResource,
        target: {
          ...vectorResource.target,
          embedding_model: {
            model_id: 'text-embedding-ada-002',
            provider: 'OpenAI',
            fallback_strategy: 'skip',
          },
        },
      };

      const options: RebuildOptions = {
        resourceDescriptor: skipResource,
        content: testContent,
        availableModels: [], // No models
        userId: 'user123',
        workspaceId: 'ws456',
        blockId: 'block123',
      };

      const result = await VectorAutoRebuildService.attemptAutoRebuild(options);

      expect(result.success).toBe(false);
      expect(result.status).toBe('skipped');
    });

    test('should handle empty content gracefully', async () => {
      const options: RebuildOptions = {
        resourceDescriptor: vectorResource,
        content: [], // Empty content
        availableModels: [openAIModel],
        userId: 'user123',
        workspaceId: 'ws456',
        blockId: 'block123',
      };

      const result = await VectorAutoRebuildService.attemptAutoRebuild(options);

      // Should still attempt but result in pending due to no entries
      expect(result.status).toBe('pending');
      expect(result.warning).toContain('No entries extracted');
    });

    test('should use fallback model when exact match not available', async () => {
      const ollamaModel: Model = {
        id: 'ollama/all-minilm',
        name: 'All-MiniLM',
        provider: 'Ollama',
        type: 'embedding',
        active: true,
      };

      const options: RebuildOptions = {
        resourceDescriptor: vectorResource, // Requires OpenAI
        content: testContent,
        availableModels: [ollamaModel], // Only Ollama available
        userId: 'user123',
        workspaceId: 'ws456',
        blockId: 'block123',
      };

      const result = await VectorAutoRebuildService.attemptAutoRebuild(options);

      // Should succeed with fallback (strategy is 'auto')
      expect(result.success).toBe(true);
      expect(result.status).toBe('completed');
      expect(result.model?.provider).toBe('Ollama');
      expect(result.warning).toBeDefined(); // Should have a warning about fallback
    });
  });

  describe('validateOptions', () => {
    test('should validate correct options', () => {
      const options: RebuildOptions = {
        resourceDescriptor: vectorResource,
        content: testContent,
        availableModels: [openAIModel],
        userId: 'user123',
        workspaceId: 'ws456',
        blockId: 'block123',
      };

      const result = VectorAutoRebuildService.validateOptions(options);

      expect(result).toBe(true);
    });

    test('should return error for missing userId', () => {
      const options: RebuildOptions = {
        resourceDescriptor: vectorResource,
        content: testContent,
        availableModels: [openAIModel],
        userId: '',
        workspaceId: 'ws456',
        blockId: 'block123',
      };

      const result = VectorAutoRebuildService.validateOptions(options);

      expect(result).toBe('Missing userId');
    });

    test('should return error for missing availableModels', () => {
      const options: RebuildOptions = {
        resourceDescriptor: vectorResource,
        content: testContent,
        availableModels: [],
        userId: 'user123',
        workspaceId: 'ws456',
        blockId: 'block123',
      };

      const result = VectorAutoRebuildService.validateOptions(options);

      expect(result).toBe('Missing availableModels');
    });
  });

  describe('getStatusSummary', () => {
    test('should format success message', () => {
      const result = {
        success: true,
        status: 'completed' as const,
        entries: [{}, {}] as any[],
        model: {
          id: 'text-embedding-ada-002',
          name: 'Ada 002',
          provider: 'OpenAI',
          type: 'embedding' as const,
        },
      };

      const summary = VectorAutoRebuildService.getStatusSummary(result);

      expect(summary).toContain('✅');
      expect(summary).toContain('Ada 002');
      expect(summary).toContain('2 entries');
    });

    test('should format pending message', () => {
      const result = {
        success: false,
        status: 'pending' as const,
        warning: 'No compatible model found',
      };

      const summary = VectorAutoRebuildService.getStatusSummary(result);

      expect(summary).toContain('⏳');
      expect(summary).toContain('pending');
      expect(summary).toContain('No compatible model');
    });

    test('should format skipped message', () => {
      const result = {
        success: false,
        status: 'skipped' as const,
        warning: 'Strategy is skip',
      };

      const summary = VectorAutoRebuildService.getStatusSummary(result);

      expect(summary).toContain('⏭️');
      expect(summary).toContain('skipped');
    });

    test('should format failed message', () => {
      const result = {
        success: false,
        status: 'failed' as const,
        error: 'Connection timeout',
      };

      const summary = VectorAutoRebuildService.getStatusSummary(result);

      expect(summary).toContain('❌');
      expect(summary).toContain('failed');
      expect(summary).toContain('Connection timeout');
    });
  });

  describe('shouldAttemptAutoRebuild', () => {
    test('should return true for vector resource with embedding_model and auto/skip strategy', () => {
      expect(
        VectorAutoRebuildService.shouldAttemptAutoRebuild(vectorResource)
      ).toBe(true);
    });

    test('should return false for non-vector resource', () => {
      expect(
        VectorAutoRebuildService.shouldAttemptAutoRebuild(nonVectorResource)
      ).toBe(false);
    });

    test('should return false for vector resource without embedding_model', () => {
      const noEmbeddingResource: ResourceDescriptor = {
        ...vectorResource,
        target: {
          pattern: '${userId}/${blockId}',
          requires_user_scope: true,
          vector_handling: 'preserve_entries_only',
          // No embedding_model
        },
      };

      expect(
        VectorAutoRebuildService.shouldAttemptAutoRebuild(noEmbeddingResource)
      ).toBe(false);
    });

    test('should return false for manual strategy', () => {
      const manualResource: ResourceDescriptor = {
        ...vectorResource,
        target: {
          ...vectorResource.target,
          embedding_model: {
            model_id: 'text-embedding-ada-002',
            provider: 'OpenAI',
            fallback_strategy: 'manual',
          },
        },
      };

      expect(
        VectorAutoRebuildService.shouldAttemptAutoRebuild(manualResource)
      ).toBe(false);
    });
  });
});
