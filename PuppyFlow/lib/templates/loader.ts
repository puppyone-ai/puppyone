/**
 * Template Loader Interface
 *
 * Defines the contract for loading and instantiating templates.
 * This will be implemented in Phase 2 by CloudTemplateLoader.
 *
 * Phase 1.9: Auto-Rebuild Vector Indexes
 */

import { Model } from '@/app/components/states/AppSettingsContext';
import { TemplatePackage, WorkflowDefinition } from './types';

/**
 * Template Loader Interface
 *
 * Defines methods for:
 * - Loading template packages from Git
 * - Instantiating templates into user workspaces
 * - Handling resource copying and reference rewriting
 */
export interface TemplateLoader {
  /**
   * Load a template package from Git
   *
   * @param templateId - Template identifier (e.g., "agentic-rag")
   * @returns Template package with metadata, workflow, and resources
   */
  loadTemplate(templateId: string): Promise<TemplatePackage>;

  /**
   * Instantiate a template into a user workspace
   *
   * This method:
   * 1. Copies resources to user's storage
   * 2. Rewrites references in workflow JSON
   * 3. Attempts auto-rebuild for vector resources (Phase 1.9)
   * 4. Returns the instantiated workflow
   *
   * @param pkg - Template package
   * @param userId - User ID
   * @param workspaceId - Workspace ID
   * @param availableModels - User's available models (Phase 1.9 addition)
   * @returns Instantiated workflow definition
   */
  instantiateTemplate(
    pkg: TemplatePackage,
    userId: string,
    workspaceId: string,
    availableModels: Model[] // Phase 1.9: Added for auto-rebuild
  ): Promise<WorkflowDefinition>;
}

/**
 * Template Loader Configuration
 *
 * Configuration for the template loader implementation.
 */
export interface TemplateLoaderConfig {
  /**
   * Base URL for template repository
   * Default: GitHub raw content URL
   */
  templateRepoUrl: string;

  /**
   * Storage service URL for resource copying
   * Default: PuppyStorage endpoint
   */
  storageServiceUrl: string;

  /**
   * Whether to enable auto-rebuild for vector indexes
   * Default: true (Phase 1.9)
   */
  enableAutoRebuild?: boolean;

  /**
   * Timeout for template loading (ms)
   * Default: 30000 (30 seconds)
   */
  loadTimeout?: number;

  /**
   * Timeout for template instantiation (ms)
   * Default: 60000 (60 seconds)
   */
  instantiateTimeout?: number;
}

/**
 * Default configuration
 */
export const DEFAULT_LOADER_CONFIG: TemplateLoaderConfig = {
  templateRepoUrl:
    process.env.TEMPLATE_REPO_URL ||
    'https://raw.githubusercontent.com/PuppyAgent/PuppyAgent-Jack/main/PuppyFlow/templates',
  storageServiceUrl: process.env.PUPPYSTORAGE_URL || 'http://localhost:9002',
  enableAutoRebuild: true,
  loadTimeout: 30000,
  instantiateTimeout: 60000,
};

/**
 * Template Loader Factory
 *
 * Creates a template loader instance based on deployment type.
 */
export class TemplateLoaderFactory {
  /**
   * Create a template loader
   *
   * @param config - Loader configuration
   * @returns Template loader instance
   */
  static create(config?: Partial<TemplateLoaderConfig>): TemplateLoader {
    // Phase 2: CloudTemplateLoader implementation
    const { CloudTemplateLoader } = require('./cloud');
    const mergedConfig = { ...DEFAULT_LOADER_CONFIG, ...config };
    return new CloudTemplateLoader(mergedConfig);
  }
}
