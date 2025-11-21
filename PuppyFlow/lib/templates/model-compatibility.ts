/**
 * Model Compatibility Service
 *
 * Handles compatibility checking between template requirements and user's available models.
 * This service determines whether automatic vector index rebuilding is possible and suggests
 * the best model to use.
 *
 * Phase 1.9: Auto-Rebuild Vector Indexes
 */

import { Model } from '@/app/components/states/AppSettingsContext';
import { ResourceDescriptor } from './types';
import {
  NormalizedEmbeddingModel,
  normalizeModels,
  modelsMatch,
} from './model-bridge';

/**
 * Compatibility Result
 *
 * Describes the compatibility check outcome and suggests next actions.
 */
export interface CompatibilityResult {
  compatible: boolean;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
  suggestedModel?: NormalizedEmbeddingModel;
  action: 'auto_rebuild' | 'warn_and_rebuild' | 'manual_select' | 'skip';
}

/**
 * Model Compatibility Service
 *
 * Provides static methods to check compatibility between template requirements
 * and user's available models.
 */
export class ModelCompatibilityService {
  /**
   * Check compatibility between template model requirement and available models
   *
   * Matching priority:
   * 1. Exact match (model_id identical) -> high confidence, auto_rebuild
   * 2. Provider match (same provider, different version) -> medium confidence, warn_and_rebuild
   * 3. Fallback allowed (fallback_strategy = 'auto') -> low confidence, auto_rebuild
   * 4. No match -> incompatible, manual_select or skip
   *
   * @param templateModel - Model requirement from template
   * @param availableModels - User's available models from AppSettings
   * @returns Compatibility result with action recommendation
   */
  static checkCompatibility(
    templateModel: ResourceDescriptor['target']['embedding_model'],
    availableModels: Model[]
  ): CompatibilityResult {
    // Normalize models (filter embedding models and handle optional fields)
    const embeddingModels = normalizeModels(availableModels);

    // Case 1: No embedding models available
    if (embeddingModels.length === 0) {
      return {
        compatible: false,
        confidence: 'high',
        reason: 'No embedding models available in user workspace',
        action: 'skip',
      };
    }

    // Case 2: No template requirement (any embedding model works)
    if (!templateModel) {
      return {
        compatible: true,
        confidence: 'high',
        reason:
          'No specific model required, using first available embedding model',
        suggestedModel: embeddingModels[0],
        action: 'auto_rebuild',
      };
    }

    // Case 3: Exact match (best case)
    const exactMatch = embeddingModels.find(
      m => m.id === templateModel.model_id
    );

    if (exactMatch) {
      return {
        compatible: true,
        confidence: 'high',
        reason: `Exact match found: ${exactMatch.id}`,
        suggestedModel: exactMatch,
        action: 'auto_rebuild',
      };
    }

    // Case 4: Provider match (good case)
    const providerMatch = embeddingModels.find(
      m => m.provider === templateModel.provider
    );

    if (providerMatch) {
      return {
        compatible: true,
        confidence: 'medium',
        reason: `Same provider (${providerMatch.provider}) but different model: ${providerMatch.id} vs ${templateModel.model_id}`,
        suggestedModel: providerMatch,
        action: 'warn_and_rebuild',
      };
    }

    // Case 5: Fallback strategy allows auto (acceptable case)
    if (templateModel.fallback_strategy === 'auto') {
      return {
        compatible: true,
        confidence: 'low',
        reason: `Fallback to first available model: ${embeddingModels[0].id} (template wanted ${templateModel.model_id})`,
        suggestedModel: embeddingModels[0],
        action: 'auto_rebuild',
      };
    }

    // Case 6: Fallback strategy is skip
    if (templateModel.fallback_strategy === 'skip') {
      return {
        compatible: false,
        confidence: 'high',
        reason: `Template requires ${templateModel.model_id} but fallback_strategy is 'skip'`,
        action: 'skip',
      };
    }

    // Case 7: Fallback strategy is manual (or default)
    return {
      compatible: false,
      confidence: 'high',
      reason: `No compatible model found. Template requires ${templateModel.model_id} from ${templateModel.provider}`,
      action: 'manual_select',
    };
  }

  /**
   * Select the best embedding model from available models
   *
   * This is a simplified version of checkCompatibility that just returns
   * the suggested model (or null if not compatible).
   *
   * @param templateModel - Model requirement from template
   * @param availableModels - User's available models
   * @returns Selected model or null
   */
  static selectEmbeddingModel(
    templateModel: ResourceDescriptor['target']['embedding_model'],
    availableModels: Model[]
  ): NormalizedEmbeddingModel | null {
    const result = this.checkCompatibility(templateModel, availableModels);

    if (result.compatible && result.suggestedModel) {
      return result.suggestedModel;
    }

    return null;
  }

  /**
   * Check if a specific model meets the template requirement
   *
   * @param model - Model to check
   * @param templateModel - Template requirement
   * @returns True if model is compatible
   */
  static isModelCompatible(
    model: Model,
    templateModel: ResourceDescriptor['target']['embedding_model']
  ): boolean {
    // Normalize the single model
    const normalized = normalizeModels([model]);

    if (normalized.length === 0) {
      return false;
    }

    // Check match using bridge utility
    return modelsMatch(normalized[0], templateModel);
  }

  /**
   * Get compatibility explanation for UI display
   *
   * @param result - Compatibility result
   * @returns Human-readable explanation
   */
  static getExplanation(result: CompatibilityResult): string {
    const emoji = {
      auto_rebuild: '✅',
      warn_and_rebuild: '⚠️',
      manual_select: '❌',
      skip: '⏭️',
    }[result.action];

    return `${emoji} ${result.reason}`;
  }

  /**
   * Get action button text for UI
   *
   * @param action - Recommended action
   * @returns Button text
   */
  static getActionText(action: CompatibilityResult['action']): string {
    const texts = {
      auto_rebuild: 'Auto-build index',
      warn_and_rebuild: 'Build with fallback model',
      manual_select: 'Select model manually',
      skip: 'Skip index building',
    };

    return texts[action];
  }
}

/**
 * Batch check compatibility for multiple resources
 *
 * @param resources - Array of resource descriptors
 * @param availableModels - User's available models
 * @returns Map of resource ID to compatibility result
 */
export function checkBatchCompatibility(
  resources: ResourceDescriptor[],
  availableModels: Model[]
): Map<string, CompatibilityResult> {
  const results = new Map<string, CompatibilityResult>();

  for (const resource of resources) {
    if (
      resource.type === 'vector_collection' &&
      resource.target.embedding_model
    ) {
      const result = ModelCompatibilityService.checkCompatibility(
        resource.target.embedding_model,
        availableModels
      );
      results.set(resource.id, result);
    }
  }

  return results;
}

/**
 * Filter models by compatibility with template requirements
 *
 * @param availableModels - User's available models
 * @param templateRequirements - Template's embedding model requirements
 * @returns Filtered list of compatible models
 */
export function filterCompatibleModels(
  availableModels: Model[],
  templateRequirements: NonNullable<
    ResourceDescriptor['target']['embedding_model']
  >
): NormalizedEmbeddingModel[] {
  const normalized = normalizeModels(availableModels);

  // Filter based on requirements
  return normalized.filter(model => {
    // Exact match
    if (model.id === templateRequirements.model_id) {
      return true;
    }

    // Provider match
    if (model.provider === templateRequirements.provider) {
      return true;
    }

    // Fallback allowed
    if (templateRequirements.fallback_strategy === 'auto') {
      return true;
    }

    return false;
  });
}
