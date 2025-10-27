/**
 * Instantiation Context
 *
 * Defines the context data passed during template instantiation.
 * This includes user information, workspace details, and available models.
 *
 * Phase 1.9: Auto-Rebuild Vector Indexes
 */

import { Model } from '@/app/components/states/AppSettingsContext';

/**
 * Instantiation Context
 *
 * Contains all necessary information to instantiate a template into a user workspace.
 */
export interface InstantiationContext {
  /**
   * Template ID to instantiate
   */
  templateId: string;

  /**
   * Workspace name (user-provided)
   */
  workspaceName: string;

  /**
   * User ID (from authentication)
   */
  userId: string;

  /**
   * Workspace ID (generated or provided)
   */
  workspaceId?: string;

  /**
   * User's available models (from AppSettingsContext)
   * Phase 1.9: Required for auto-rebuild
   */
  availableModels: Model[];

  /**
   * Optional: User preferences for template customization
   */
  preferences?: {
    /**
     * Auto-build vector indexes if compatible models are available
     * Default: true
     */
    autoRebuildIndexes?: boolean;

    /**
     * Preferred embedding model (if user has multiple)
     */
    preferredEmbeddingModel?: string;

    /**
     * Whether to show warnings for model compatibility issues
     * Default: true
     */
    showCompatibilityWarnings?: boolean;
  };

  /**
   * Optional: Metadata for tracking
   */
  metadata?: {
    /**
     * Source of the instantiation request
     */
    source?: 'ui' | 'api' | 'cli';

    /**
     * Timestamp of the request
     */
    timestamp?: string;

    /**
     * Session ID for debugging
     */
    sessionId?: string;
  };
}

/**
 * Instantiation Result
 *
 * Result returned after successful template instantiation.
 */
export interface InstantiationResult {
  /**
   * Whether instantiation was successful
   */
  success: boolean;

  /**
   * Workspace ID of the created workspace
   */
  workspaceId: string;

  /**
   * Workspace name
   */
  workspaceName: string;

  /**
   * Number of resources copied
   */
  resourcesCount: number;

  /**
   * Auto-rebuild results for vector indexes
   * Map of resource ID to status
   */
  autoRebuildResults?: Map<
    string,
    {
      status: 'completed' | 'pending' | 'failed' | 'skipped';
      reason?: string;
    }
  >;

  /**
   * Warnings encountered during instantiation
   */
  warnings?: string[];

  /**
   * Errors encountered (if any)
   */
  errors?: string[];

  /**
   * Timestamp of completion
   */
  completedAt?: string;
}

/**
 * Validate instantiation context
 *
 * @param context - Context to validate
 * @returns True if valid, error message if invalid
 */
export function validateInstantiationContext(
  context: InstantiationContext
): true | string {
  if (!context.templateId) {
    return 'Missing templateId';
  }

  if (!context.workspaceName) {
    return 'Missing workspaceName';
  }

  if (!context.userId) {
    return 'Missing userId';
  }

  if (!context.availableModels || context.availableModels.length === 0) {
    return 'Missing availableModels';
  }

  return true;
}

/**
 * Create default instantiation context
 *
 * @param templateId - Template ID
 * @param userId - User ID
 * @param workspaceName - Workspace name
 * @param availableModels - Available models
 * @returns Instantiation context with defaults
 */
export function createInstantiationContext(
  templateId: string,
  userId: string,
  workspaceName: string,
  availableModels: Model[]
): InstantiationContext {
  return {
    templateId,
    workspaceName,
    userId,
    availableModels,
    preferences: {
      autoRebuildIndexes: true,
      showCompatibilityWarnings: true,
    },
    metadata: {
      source: 'ui',
      timestamp: new Date().toISOString(),
    },
  };
}
