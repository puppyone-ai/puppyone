/**
 * Model Bridge - Type compatibility layer between Template Contract and AppSettingsContext
 *
 * This module handles the type differences between:
 * - Template Contract (types.ts): embedding_model configuration
 * - AppSettingsContext: Model type with optional fields
 *
 * Phase 1.9: Auto-Rebuild Vector Indexes
 */

import { Model } from '@/app/components/states/AppSettingsContext';
import { ResourceDescriptor } from './types';

/**
 * Normalized Embedding Model
 *
 * Guarantees all required fields are present (no undefined values).
 * This is the standardized format used by ModelCompatibilityService.
 */
export interface NormalizedEmbeddingModel {
  id: string;
  name: string;
  provider: string; // Guaranteed non-null (inferred if missing from AppSettings)
  type: 'embedding'; // Guaranteed to be 'embedding' (filtered)
  isLocal?: boolean;
  active?: boolean;
}

/**
 * Normalize a Model from AppSettingsContext into a NormalizedEmbeddingModel
 *
 * Handles:
 * - Filtering: Only embedding models are accepted
 * - Provider inference: If provider is undefined, infer from model_id
 * - Type safety: Returns null if model is not suitable
 *
 * @param model - Model from AppSettingsContext
 * @returns Normalized model or null if not an embedding model
 */
export function normalizeModel(model: Model): NormalizedEmbeddingModel | null {
  // Filter: Must be embedding type
  if (model.type !== 'embedding') {
    return null;
  }

  // Infer provider if missing
  const provider = model.provider || inferProviderFromId(model.id);

  return {
    id: model.id,
    name: model.name,
    provider,
    type: 'embedding',
    isLocal: model.isLocal,
    active: model.active,
  };
}

/**
 * Normalize multiple models at once
 *
 * @param models - Array of models from AppSettingsContext
 * @returns Array of normalized embedding models (filtered and normalized)
 */
export function normalizeModels(models: Model[]): NormalizedEmbeddingModel[] {
  return models
    .filter(m => m.type === 'embedding' && m.active !== false) // Only active embedding models
    .map(normalizeModel)
    .filter((m): m is NormalizedEmbeddingModel => m !== null);
}

/**
 * Infer provider from model ID
 *
 * Uses common naming patterns to guess the provider when it's not explicitly set.
 * This handles cases where AppSettingsContext.Model.provider is undefined.
 *
 * @param modelId - Model identifier (e.g., "text-embedding-ada-002", "ollama/all-minilm")
 * @returns Inferred provider name
 */
export function inferProviderFromId(modelId: string): string {
  const lowerCaseId = modelId.toLowerCase();

  // OpenAI patterns
  if (
    lowerCaseId.includes('openai/') ||
    lowerCaseId.includes('text-embedding') ||
    lowerCaseId.includes('ada-') ||
    lowerCaseId.includes('gpt-')
  ) {
    return 'OpenAI';
  }

  // Ollama patterns
  if (lowerCaseId.includes('ollama/')) {
    return 'Ollama';
  }

  // Anthropic patterns
  if (lowerCaseId.includes('anthropic/') || lowerCaseId.includes('claude-')) {
    return 'Anthropic';
  }

  // Cohere patterns
  if (lowerCaseId.includes('cohere/')) {
    return 'Cohere';
  }

  // HuggingFace patterns
  if (lowerCaseId.includes('huggingface/') || lowerCaseId.includes('hf/')) {
    return 'HuggingFace';
  }

  // Default
  return 'Unknown';
}

/**
 * Check if a runtime model matches a template model requirement
 *
 * Matching levels (in order of preference):
 * 1. Exact match: model_id is identical
 * 2. Provider match: Same provider, different version
 * 3. Fallback: Any embedding model (if fallback_strategy allows)
 *
 * @param runtimeModel - Normalized model from user's available models
 * @param templateModel - Model requirement from template
 * @returns True if models are compatible
 */
export function modelsMatch(
  runtimeModel: NormalizedEmbeddingModel,
  templateModel: ResourceDescriptor['target']['embedding_model']
): boolean {
  if (!templateModel) {
    return true; // No requirement specified
  }

  // Exact match (best)
  if (runtimeModel.id === templateModel.model_id) {
    return true;
  }

  // Provider match (good)
  if (runtimeModel.provider === templateModel.provider) {
    return true;
  }

  // Fallback (acceptable if strategy allows)
  if (templateModel.fallback_strategy === 'auto') {
    return true;
  }

  return false;
}

/**
 * Field mapping utilities
 *
 * These functions handle the naming differences between Template Contract and Runtime:
 * - Template: embedding_model.model_id
 * - Runtime: Model.id
 */

/**
 * Map template model_id to runtime id
 */
export function mapTemplateToRuntimeId(templateModelId: string): string {
  return templateModelId; // Direct mapping
}

/**
 * Map runtime id to template model_id
 */
export function mapRuntimeToTemplateId(runtimeId: string): string {
  return runtimeId; // Direct mapping
}

/**
 * Type guard: Check if a model is an embedding model
 */
export function isEmbeddingModel(model: Model): boolean {
  return model.type === 'embedding' && model.active !== false;
}

/**
 * Type guard: Check if template requires embedding
 */
export function requiresEmbedding(
  resource: ResourceDescriptor
): resource is ResourceDescriptor & {
  target: {
    embedding_model: NonNullable<
      ResourceDescriptor['target']['embedding_model']
    >;
  };
} {
  return (
    resource.type === 'vector_collection' &&
    resource.target.embedding_model !== undefined
  );
}
