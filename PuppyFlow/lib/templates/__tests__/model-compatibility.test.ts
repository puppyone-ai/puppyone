/**
 * Model Compatibility Service - Unit Tests
 *
 * Tests for ModelCompatibilityService and model-bridge utilities.
 *
 * Phase 1.9: Auto-Rebuild Vector Indexes
 */

import { Model } from '@/app/components/states/AppSettingsContext';
import { ResourceDescriptor } from '../types';
import { ModelCompatibilityService } from '../model-compatibility';
import {
  normalizeModel,
  normalizeModels,
  inferProviderFromId,
  modelsMatch,
} from '../model-bridge';

describe('ModelCompatibilityService', () => {
  // Test data
  const openAIModel: Model = {
    id: 'text-embedding-ada-002',
    name: 'Ada 002',
    provider: 'OpenAI',
    isLocal: false,
    active: true,
    type: 'embedding',
  };

  const ollamaModel: Model = {
    id: 'ollama/all-minilm',
    name: 'All-MiniLM',
    provider: 'Ollama',
    isLocal: true,
    active: true,
    type: 'embedding',
  };

  const llmModel: Model = {
    id: 'openai/gpt-5',
    name: 'GPT-5',
    provider: 'OpenAI',
    isLocal: false,
    active: true,
    type: 'llm',
  };

  const inactiveModel: Model = {
    id: 'text-embedding-3-small',
    name: 'Embedding 3 Small',
    provider: 'OpenAI',
    isLocal: false,
    active: false,
    type: 'embedding',
  };

  describe('checkCompatibility', () => {
    test('should return high confidence for exact match', () => {
      const templateModel: ResourceDescriptor['target']['embedding_model'] = {
        model_id: 'text-embedding-ada-002',
        provider: 'OpenAI',
        fallback_strategy: 'manual',
      };

      const result = ModelCompatibilityService.checkCompatibility(
        templateModel,
        [openAIModel, ollamaModel]
      );

      expect(result.compatible).toBe(true);
      expect(result.confidence).toBe('high');
      expect(result.action).toBe('auto_rebuild');
      expect(result.suggestedModel?.id).toBe('text-embedding-ada-002');
    });

    test('should return medium confidence for provider match', () => {
      const templateModel: ResourceDescriptor['target']['embedding_model'] = {
        model_id: 'text-embedding-3-large',
        provider: 'OpenAI',
        fallback_strategy: 'manual',
      };

      const result = ModelCompatibilityService.checkCompatibility(
        templateModel,
        [openAIModel, ollamaModel]
      );

      expect(result.compatible).toBe(true);
      expect(result.confidence).toBe('medium');
      expect(result.action).toBe('warn_and_rebuild');
      expect(result.suggestedModel?.provider).toBe('OpenAI');
    });

    test('should use fallback when strategy is auto', () => {
      const templateModel: ResourceDescriptor['target']['embedding_model'] = {
        model_id: 'text-embedding-ada-002',
        provider: 'OpenAI',
        fallback_strategy: 'auto',
      };

      const result = ModelCompatibilityService.checkCompatibility(
        templateModel,
        [ollamaModel] // No OpenAI model
      );

      expect(result.compatible).toBe(true);
      expect(result.confidence).toBe('low');
      expect(result.action).toBe('auto_rebuild');
      expect(result.suggestedModel?.id).toBe('ollama/all-minilm');
    });

    test('should skip when strategy is skip', () => {
      const templateModel: ResourceDescriptor['target']['embedding_model'] = {
        model_id: 'text-embedding-ada-002',
        provider: 'OpenAI',
        fallback_strategy: 'skip',
      };

      const result = ModelCompatibilityService.checkCompatibility(
        templateModel,
        [ollamaModel] // No OpenAI model
      );

      expect(result.compatible).toBe(false);
      expect(result.action).toBe('skip');
    });

    test('should require manual selection when no match and strategy is manual', () => {
      const templateModel: ResourceDescriptor['target']['embedding_model'] = {
        model_id: 'text-embedding-ada-002',
        provider: 'OpenAI',
        fallback_strategy: 'manual',
      };

      const result = ModelCompatibilityService.checkCompatibility(
        templateModel,
        [ollamaModel] // No OpenAI model
      );

      expect(result.compatible).toBe(false);
      expect(result.action).toBe('manual_select');
    });

    test('should handle no embedding models available', () => {
      const templateModel: ResourceDescriptor['target']['embedding_model'] = {
        model_id: 'text-embedding-ada-002',
        provider: 'OpenAI',
        fallback_strategy: 'auto',
      };

      const result = ModelCompatibilityService.checkCompatibility(
        templateModel,
        [] // No models
      );

      expect(result.compatible).toBe(false);
      expect(result.action).toBe('skip');
      expect(result.reason).toContain('No embedding models available');
    });

    test('should handle no template requirement', () => {
      const result = ModelCompatibilityService.checkCompatibility(undefined, [
        openAIModel,
      ]);

      expect(result.compatible).toBe(true);
      expect(result.confidence).toBe('high');
      expect(result.action).toBe('auto_rebuild');
      expect(result.suggestedModel).toBeDefined();
    });

    test('should filter out LLM models', () => {
      const templateModel: ResourceDescriptor['target']['embedding_model'] = {
        model_id: 'text-embedding-ada-002',
        provider: 'OpenAI',
        fallback_strategy: 'manual',
      };

      const result = ModelCompatibilityService.checkCompatibility(
        templateModel,
        [llmModel] // Only LLM model
      );

      expect(result.compatible).toBe(false);
      expect(result.action).toBe('skip');
    });

    test('should filter out inactive models', () => {
      const templateModel: ResourceDescriptor['target']['embedding_model'] = {
        model_id: 'text-embedding-3-small',
        provider: 'OpenAI',
        fallback_strategy: 'manual',
      };

      const result = ModelCompatibilityService.checkCompatibility(
        templateModel,
        [inactiveModel, ollamaModel]
      );

      // Should not match inactive model, should suggest Ollama
      expect(result.compatible).toBe(false);
      expect(result.action).toBe('manual_select');
    });
  });

  describe('selectEmbeddingModel', () => {
    test('should return suggested model when compatible', () => {
      const templateModel: ResourceDescriptor['target']['embedding_model'] = {
        model_id: 'text-embedding-ada-002',
        provider: 'OpenAI',
        fallback_strategy: 'manual',
      };

      const selected = ModelCompatibilityService.selectEmbeddingModel(
        templateModel,
        [openAIModel]
      );

      expect(selected).not.toBeNull();
      expect(selected?.id).toBe('text-embedding-ada-002');
    });

    test('should return null when incompatible', () => {
      const templateModel: ResourceDescriptor['target']['embedding_model'] = {
        model_id: 'text-embedding-ada-002',
        provider: 'OpenAI',
        fallback_strategy: 'manual',
      };

      const selected = ModelCompatibilityService.selectEmbeddingModel(
        templateModel,
        [ollamaModel] // Different provider
      );

      expect(selected).toBeNull();
    });
  });

  describe('isModelCompatible', () => {
    test('should return true for exact match', () => {
      const templateModel: ResourceDescriptor['target']['embedding_model'] = {
        model_id: 'text-embedding-ada-002',
        provider: 'OpenAI',
        fallback_strategy: 'manual',
      };

      const compatible = ModelCompatibilityService.isModelCompatible(
        openAIModel,
        templateModel
      );

      expect(compatible).toBe(true);
    });

    test('should return true for provider match', () => {
      const templateModel: ResourceDescriptor['target']['embedding_model'] = {
        model_id: 'text-embedding-3-large',
        provider: 'OpenAI',
        fallback_strategy: 'manual',
      };

      const compatible = ModelCompatibilityService.isModelCompatible(
        openAIModel,
        templateModel
      );

      expect(compatible).toBe(true);
    });

    test('should return false for LLM models', () => {
      const templateModel: ResourceDescriptor['target']['embedding_model'] = {
        model_id: 'openai/gpt-5',
        provider: 'OpenAI',
        fallback_strategy: 'manual',
      };

      const compatible = ModelCompatibilityService.isModelCompatible(
        llmModel,
        templateModel
      );

      expect(compatible).toBe(false);
    });
  });
});

describe('model-bridge utilities', () => {
  describe('normalizeModel', () => {
    test('should normalize embedding model', () => {
      const model: Model = {
        id: 'text-embedding-ada-002',
        name: 'Ada 002',
        provider: 'OpenAI',
        isLocal: false,
        active: true,
        type: 'embedding',
      };

      const normalized = normalizeModel(model);

      expect(normalized).not.toBeNull();
      expect(normalized?.id).toBe('text-embedding-ada-002');
      expect(normalized?.provider).toBe('OpenAI');
      expect(normalized?.type).toBe('embedding');
    });

    test('should infer provider when missing', () => {
      const model: Model = {
        id: 'text-embedding-ada-002',
        name: 'Ada 002',
        provider: undefined,
        type: 'embedding',
      };

      const normalized = normalizeModel(model);

      expect(normalized).not.toBeNull();
      expect(normalized?.provider).toBe('OpenAI');
    });

    test('should return null for LLM models', () => {
      const model: Model = {
        id: 'openai/gpt-5',
        name: 'GPT-5',
        provider: 'OpenAI',
        type: 'llm',
      };

      const normalized = normalizeModel(model);

      expect(normalized).toBeNull();
    });
  });

  describe('normalizeModels', () => {
    test('should filter and normalize embedding models', () => {
      const models: Model[] = [
        {
          id: 'text-embedding-ada-002',
          name: 'Ada 002',
          provider: 'OpenAI',
          type: 'embedding',
          active: true,
        },
        {
          id: 'openai/gpt-5',
          name: 'GPT-5',
          provider: 'OpenAI',
          type: 'llm',
          active: true,
        },
        {
          id: 'ollama/all-minilm',
          name: 'All-MiniLM',
          provider: 'Ollama',
          type: 'embedding',
          active: true,
        },
        {
          id: 'text-embedding-3-small',
          name: 'Embedding 3 Small',
          provider: 'OpenAI',
          type: 'embedding',
          active: false, // Inactive
        },
      ];

      const normalized = normalizeModels(models);

      expect(normalized).toHaveLength(2); // Only 2 active embedding models
      expect(normalized[0].type).toBe('embedding');
      expect(normalized[1].type).toBe('embedding');
    });
  });

  describe('inferProviderFromId', () => {
    test('should infer OpenAI from text-embedding pattern', () => {
      expect(inferProviderFromId('text-embedding-ada-002')).toBe('OpenAI');
      expect(inferProviderFromId('text-embedding-3-small')).toBe('OpenAI');
      expect(inferProviderFromId('openai/gpt-5')).toBe('OpenAI');
    });

    test('should infer Ollama from ollama/ prefix', () => {
      expect(inferProviderFromId('ollama/all-minilm')).toBe('Ollama');
      expect(inferProviderFromId('ollama/nomic-embed-text')).toBe('Ollama');
    });

    test('should infer Anthropic from patterns', () => {
      expect(inferProviderFromId('anthropic/claude-3')).toBe('Anthropic');
      expect(inferProviderFromId('claude-opus')).toBe('Anthropic');
    });

    test('should return Unknown for unrecognized patterns', () => {
      expect(inferProviderFromId('custom-model-xyz')).toBe('Unknown');
    });
  });

  describe('modelsMatch', () => {
    test('should match exact IDs', () => {
      const runtimeModel = {
        id: 'text-embedding-ada-002',
        name: 'Ada 002',
        provider: 'OpenAI',
        type: 'embedding' as const,
      };

      const templateModel = {
        model_id: 'text-embedding-ada-002',
        provider: 'OpenAI',
        fallback_strategy: 'manual' as const,
      };

      expect(modelsMatch(runtimeModel, templateModel)).toBe(true);
    });

    test('should match same provider', () => {
      const runtimeModel = {
        id: 'text-embedding-3-small',
        name: 'Embedding 3 Small',
        provider: 'OpenAI',
        type: 'embedding' as const,
      };

      const templateModel = {
        model_id: 'text-embedding-ada-002',
        provider: 'OpenAI',
        fallback_strategy: 'manual' as const,
      };

      expect(modelsMatch(runtimeModel, templateModel)).toBe(true);
    });

    test('should match with auto fallback strategy', () => {
      const runtimeModel = {
        id: 'ollama/all-minilm',
        name: 'All-MiniLM',
        provider: 'Ollama',
        type: 'embedding' as const,
      };

      const templateModel = {
        model_id: 'text-embedding-ada-002',
        provider: 'OpenAI',
        fallback_strategy: 'auto' as const,
      };

      expect(modelsMatch(runtimeModel, templateModel)).toBe(true);
    });

    test('should not match different providers without fallback', () => {
      const runtimeModel = {
        id: 'ollama/all-minilm',
        name: 'All-MiniLM',
        provider: 'Ollama',
        type: 'embedding' as const,
      };

      const templateModel = {
        model_id: 'text-embedding-ada-002',
        provider: 'OpenAI',
        fallback_strategy: 'manual' as const,
      };

      expect(modelsMatch(runtimeModel, templateModel)).toBe(false);
    });

    test('should match when no template requirement', () => {
      const runtimeModel = {
        id: 'text-embedding-ada-002',
        name: 'Ada 002',
        provider: 'OpenAI',
        type: 'embedding' as const,
      };

      expect(modelsMatch(runtimeModel, undefined)).toBe(true);
    });
  });
});
