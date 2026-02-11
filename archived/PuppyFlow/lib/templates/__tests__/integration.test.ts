/**
 * Integration Tests
 *
 * End-to-end integration tests for Phase 1.9 auto-rebuild functionality.
 * Tests the complete flow from compatibility checking to auto-rebuild.
 *
 * Phase 1.9: Auto-Rebuild Vector Indexes
 */

import { Model } from '@/app/components/states/AppSettingsContext';
import { ResourceDescriptor, TemplatePackage } from '../types';
import { ModelCompatibilityService } from '../model-compatibility';
import { VectorAutoRebuildService } from '../vector-auto-rebuild';
import { checkBatchCompatibility } from '../model-compatibility';
import { batchAutoRebuild } from '../vector-auto-rebuild';

describe('Integration Tests - Phase 1.9 Auto-Rebuild', () => {
  // Test data: Mock template package (like agentic-rag)
  const mockTemplatePackage: TemplatePackage = {
    metadata: {
      id: 'test-template',
      version: '1.0.0',
      name: 'Test Template',
      description: 'Test template with vector resources',
      author: 'Test Author',
      created_at: '2025-01-27T00:00:00Z',
      requirements: {
        embedding_models: {
          preferred: ['text-embedding-ada-002'],
          compatible: ['openai/*', 'ollama/all-minilm'],
          minimum_dimension: 384,
        },
      },
    },
    workflow: {
      blocks: [],
      edges: [],
      viewport: {},
      version: '0.1.0',
    },
    resources: {
      format: 'separate',
      resources: [
        {
          id: 'vector-kb',
          type: 'vector_collection',
          block_id: 'block123',
          mounted_path: 'data.content',
          mounted_paths: {
            content: 'data.content',
            entries: 'data.indexingList[0].entries',
            indexing_config: 'data.indexingList[0]',
          },
          source: {
            path: 'resources/kb.json',
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
        },
      ],
    },
  };

  describe('Scenario 1: Perfect Match (OpenAI ada-002 → OpenAI ada-002)', () => {
    const userModels: Model[] = [
      {
        id: 'text-embedding-ada-002',
        name: 'Ada 002',
        provider: 'OpenAI',
        isLocal: false,
        active: true,
        type: 'embedding',
      },
      {
        id: 'openai/gpt-5',
        name: 'GPT-5',
        provider: 'OpenAI',
        type: 'llm',
      },
    ];

    test('should detect perfect compatibility', () => {
      const resource = mockTemplatePackage.resources.resources[0];
      const compatibility = ModelCompatibilityService.checkCompatibility(
        resource.target.embedding_model,
        userModels
      );

      expect(compatibility.compatible).toBe(true);
      expect(compatibility.confidence).toBe('high');
      expect(compatibility.action).toBe('auto_rebuild');
      expect(compatibility.suggestedModel?.id).toBe('text-embedding-ada-002');
    });

    test('should auto-rebuild successfully', async () => {
      const resource = mockTemplatePackage.resources.resources[0];
      const testContent = [
        { question: 'Q1', answer: 'A1' },
        { question: 'Q2', answer: 'A2' },
      ];

      const result = await VectorAutoRebuildService.attemptAutoRebuild({
        resourceDescriptor: resource,
        content: testContent,
        availableModels: userModels,
        userId: 'user123',
        workspaceId: 'ws456',
        blockId: 'block123',
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe('completed');
      expect(result.model?.id).toBe('text-embedding-ada-002');
      expect(result.warning).toBeUndefined();
    });
  });

  describe('Scenario 2: Same Provider (OpenAI ada-002 → OpenAI 3-small)', () => {
    const userModels: Model[] = [
      {
        id: 'text-embedding-3-small',
        name: 'Embedding 3 Small',
        provider: 'OpenAI',
        isLocal: false,
        active: true,
        type: 'embedding',
      },
    ];

    test('should detect provider match', () => {
      const resource = mockTemplatePackage.resources.resources[0];
      const compatibility = ModelCompatibilityService.checkCompatibility(
        resource.target.embedding_model,
        userModels
      );

      expect(compatibility.compatible).toBe(true);
      expect(compatibility.confidence).toBe('medium');
      expect(compatibility.action).toBe('warn_and_rebuild');
      expect(compatibility.suggestedModel?.provider).toBe('OpenAI');
    });

    test('should auto-rebuild with warning', async () => {
      const resource = mockTemplatePackage.resources.resources[0];
      const testContent = [{ question: 'Q1', answer: 'A1' }];

      const result = await VectorAutoRebuildService.attemptAutoRebuild({
        resourceDescriptor: resource,
        content: testContent,
        availableModels: userModels,
        userId: 'user123',
        workspaceId: 'ws456',
        blockId: 'block123',
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe('completed');
      expect(result.model?.id).toBe('text-embedding-3-small');
      expect(result.warning).toBeDefined();
      expect(result.warning).toContain('Same provider');
    });
  });

  describe('Scenario 3: Different Provider (OpenAI → Ollama)', () => {
    const userModels: Model[] = [
      {
        id: 'ollama/all-minilm',
        name: 'All-MiniLM',
        provider: 'Ollama',
        isLocal: true,
        active: true,
        type: 'embedding',
      },
    ];

    test('should detect fallback compatibility (auto strategy)', () => {
      const resource = mockTemplatePackage.resources.resources[0];
      const compatibility = ModelCompatibilityService.checkCompatibility(
        resource.target.embedding_model,
        userModels
      );

      expect(compatibility.compatible).toBe(true);
      expect(compatibility.confidence).toBe('low');
      expect(compatibility.action).toBe('auto_rebuild');
      expect(compatibility.suggestedModel?.provider).toBe('Ollama');
    });

    test('should auto-rebuild with fallback model', async () => {
      const resource = mockTemplatePackage.resources.resources[0];
      const testContent = [{ question: 'Q1', answer: 'A1' }];

      const result = await VectorAutoRebuildService.attemptAutoRebuild({
        resourceDescriptor: resource,
        content: testContent,
        availableModels: userModels,
        userId: 'user123',
        workspaceId: 'ws456',
        blockId: 'block123',
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe('completed');
      expect(result.model?.provider).toBe('Ollama');
      expect(result.compatibilityResult?.confidence).toBe('low');
    });

    test('should require manual selection if strategy is manual', async () => {
      const manualResource: ResourceDescriptor = {
        ...mockTemplatePackage.resources.resources[0],
        target: {
          ...mockTemplatePackage.resources.resources[0].target,
          embedding_model: {
            model_id: 'text-embedding-ada-002',
            provider: 'OpenAI',
            fallback_strategy: 'manual',
          },
        },
      };

      const compatibility = ModelCompatibilityService.checkCompatibility(
        manualResource.target.embedding_model,
        userModels
      );

      expect(compatibility.compatible).toBe(false);
      expect(compatibility.action).toBe('manual_select');

      const result = await VectorAutoRebuildService.attemptAutoRebuild({
        resourceDescriptor: manualResource,
        content: [{ question: 'Q1', answer: 'A1' }],
        availableModels: userModels,
        userId: 'user123',
        workspaceId: 'ws456',
        blockId: 'block123',
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe('pending');
    });
  });

  describe('Scenario 4: No Embedding Models Available', () => {
    const userModels: Model[] = [
      {
        id: 'openai/gpt-5',
        name: 'GPT-5',
        provider: 'OpenAI',
        type: 'llm', // Only LLM, no embedding
      },
    ];

    test('should detect no compatible models', () => {
      const resource = mockTemplatePackage.resources.resources[0];
      const compatibility = ModelCompatibilityService.checkCompatibility(
        resource.target.embedding_model,
        userModels
      );

      expect(compatibility.compatible).toBe(false);
      expect(compatibility.action).toBe('skip');
      expect(compatibility.reason).toContain('No embedding models available');
    });

    test('should skip auto-rebuild', async () => {
      const resource = mockTemplatePackage.resources.resources[0];
      const testContent = [{ question: 'Q1', answer: 'A1' }];

      const result = await VectorAutoRebuildService.attemptAutoRebuild({
        resourceDescriptor: resource,
        content: testContent,
        availableModels: userModels,
        userId: 'user123',
        workspaceId: 'ws456',
        blockId: 'block123',
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe('skipped');
    });
  });

  describe('Batch Operations', () => {
    test('should check compatibility for multiple resources', () => {
      const resources: ResourceDescriptor[] = [
        {
          id: 'vector-kb-1',
          type: 'vector_collection',
          block_id: 'block1',
          mounted_path: 'data.content',
          source: { path: 'res1.json', format: 'structured' },
          target: {
            pattern: '${userId}/${blockId}',
            requires_user_scope: true,
            embedding_model: {
              model_id: 'text-embedding-ada-002',
              provider: 'OpenAI',
              fallback_strategy: 'auto',
            },
          },
        },
        {
          id: 'vector-kb-2',
          type: 'vector_collection',
          block_id: 'block2',
          mounted_path: 'data.content',
          source: { path: 'res2.json', format: 'structured' },
          target: {
            pattern: '${userId}/${blockId}',
            requires_user_scope: true,
            embedding_model: {
              model_id: 'text-embedding-3-small',
              provider: 'OpenAI',
              fallback_strategy: 'manual',
            },
          },
        },
      ];

      const userModels: Model[] = [
        {
          id: 'text-embedding-ada-002',
          name: 'Ada 002',
          provider: 'OpenAI',
          type: 'embedding',
          active: true,
        },
      ];

      const results = checkBatchCompatibility(resources, userModels);

      expect(results.size).toBe(2);
      expect(results.get('vector-kb-1')?.compatible).toBe(true);
      expect(results.get('vector-kb-1')?.action).toBe('auto_rebuild');
      expect(results.get('vector-kb-2')?.compatible).toBe(true); // Same provider (OpenAI)
      expect(results.get('vector-kb-2')?.action).toBe('warn_and_rebuild'); // But needs warning
    });

    test('should auto-rebuild multiple resources', async () => {
      const resources: ResourceDescriptor[] = [
        {
          id: 'vector-kb-1',
          type: 'vector_collection',
          block_id: 'block1',
          mounted_path: 'data.content',
          mounted_paths: {
            chunks: ['q', 'a'],
            content: ['q', 'a'],
          },
          source: { path: 'res1.json', format: 'structured' },
          target: {
            pattern: '${userId}/${blockId}',
            requires_user_scope: true,
            embedding_model: {
              model_id: 'text-embedding-ada-002',
              provider: 'OpenAI',
              fallback_strategy: 'auto',
            },
          },
        },
        {
          id: 'vector-kb-2',
          type: 'vector_collection',
          block_id: 'block2',
          mounted_path: 'data.content',
          mounted_paths: {
            chunks: ['q', 'a'],
            content: ['q', 'a'],
          },
          source: { path: 'res2.json', format: 'structured' },
          target: {
            pattern: '${userId}/${blockId}',
            requires_user_scope: true,
            embedding_model: {
              model_id: 'text-embedding-ada-002',
              provider: 'OpenAI',
              fallback_strategy: 'auto',
            },
          },
        },
      ];

      const contentMap = new Map([
        ['vector-kb-1', [{ q: 'Q1', a: 'A1' }]],
        ['vector-kb-2', [{ q: 'Q2', a: 'A2' }]],
      ]);

      const userModels: Model[] = [
        {
          id: 'text-embedding-ada-002',
          name: 'Ada 002',
          provider: 'OpenAI',
          type: 'embedding',
          active: true,
        },
      ];

      const results = await batchAutoRebuild(
        resources,
        contentMap,
        userModels,
        'user123',
        'ws456'
      );

      expect(results.size).toBe(2);
      expect(results.get('vector-kb-1')?.success).toBe(true);
      expect(results.get('vector-kb-2')?.success).toBe(true);
    });
  });

  describe('Error Handling', () => {
    test('should handle missing content gracefully', async () => {
      const resource = mockTemplatePackage.resources.resources[0];
      const userModels: Model[] = [
        {
          id: 'text-embedding-ada-002',
          name: 'Ada 002',
          provider: 'OpenAI',
          type: 'embedding',
          active: true,
        },
      ];

      const result = await VectorAutoRebuildService.attemptAutoRebuild({
        resourceDescriptor: resource,
        content: [], // Empty
        availableModels: userModels,
        userId: 'user123',
        workspaceId: 'ws456',
        blockId: 'block123',
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe('pending');
      expect(result.warning).toContain('No entries extracted');
    });

    test('should handle inactive models', () => {
      const userModels: Model[] = [
        {
          id: 'text-embedding-ada-002',
          name: 'Ada 002',
          provider: 'OpenAI',
          type: 'embedding',
          active: false, // Inactive
        },
      ];

      const resource = mockTemplatePackage.resources.resources[0];
      const compatibility = ModelCompatibilityService.checkCompatibility(
        resource.target.embedding_model,
        userModels
      );

      // Should not use inactive model
      expect(compatibility.compatible).toBe(false);
      expect(compatibility.action).toBe('skip');
    });
  });
});
