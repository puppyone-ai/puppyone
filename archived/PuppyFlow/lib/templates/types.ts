/**
 * Template Resource Contract - Type Definitions
 *
 * Defines the structure for template packages, resources, and workflows.
 * Part of the Template Resource Contract MVP (Phase 1).
 */

/**
 * Batch - Engineering standard for bulk data processing
 *
 * A Batch represents a collection of homogeneous data items with associated
 * processing configuration. Used for vector collections, graph data, and other
 * scenarios requiring batch processing.
 *
 * @template T - Type of items in the content array
 * @template C - Type of configuration object
 *
 * @example Vector Collection
 * ```typescript
 * const faqBatch: Batch<{question: string, answer: string}, VectorIndexingConfig> = {
 *   content: [
 *     {question: "What is X?", answer: "X is..."},
 *     {question: "How to Y?", answer: "Y can be..."}
 *   ],
 *   indexing_config: {
 *     key_path: [{id: "NK-LPz", type: "key", value: "question"}],
 *     value_path: []
 *   }
 * };
 * ```
 */
export interface Batch<T = any, C = any> {
  content: T[]; // Array of data items (REQUIRED, must be array)
  indexing_config: C; // Configuration for processing (REQUIRED, structure varies by use case)
}

/**
 * Type guard to check if an object is a valid Batch
 */
export function isBatch(obj: any): obj is Batch {
  return (
    obj !== null &&
    typeof obj === 'object' &&
    Array.isArray(obj.content) &&
    obj.indexing_config !== undefined &&
    typeof obj.indexing_config === 'object' &&
    obj.indexing_config !== null
  );
}

// Core template package structure
export interface TemplatePackage {
  metadata: TemplateMetadata;
  workflow: WorkflowDefinition;
  resources: ResourceManifest;
}

export interface TemplateMetadata {
  id: string;
  version: string;
  name: string;
  description: string;
  author: string;
  created_at: string;
  tags?: string[];

  // Phase 1.9: Template requirements and dependencies
  requirements?: {
    min_engine_version?: string;
    min_storage_version?: string;
    required_features?: string[];

    // Embedding model requirements for auto-rebuild
    embedding_models?: {
      preferred?: string[]; // Preferred models (by model_id)
      compatible?: string[]; // Compatible model patterns (e.g., "openai/*", "ollama/all-minilm")
      minimum_dimension?: number; // Minimum vector dimension required
    };
  };
}

export interface ResourceManifest {
  format: 'separate' | 'inline';
  resources: ResourceDescriptor[];
}

export interface ResourceDescriptor {
  id: string;

  // Business type (not storage form):
  // - 'external_storage': General data (text/structured), size determines inline/external
  // - 'file': File resource (binary/text), always external
  // - 'vector_collection': Vector indexing (structured only), size determines inline/external
  // Note: NO 'inline' type - inline is a storage_class determined at runtime!
  type: 'external_storage' | 'vector_collection' | 'file';

  block_id: string;

  // Resource mount point in workflow (renamed from reference_path for clarity)
  mounted_path: string; // e.g., "data.external_metadata.resource_key"

  // For complex resources with multiple mount points
  mounted_paths?: {
    content?: string;
    chunks?: string;
    indexing_config?: string;
  };

  source: {
    path: string;
    format: 'text' | 'structured' | 'binary';
    mime_type?: string;
  };

  target: {
    pattern: string;
    requires_user_scope: boolean;

    // Special handling for vector collections (preserve chunks for re-embedding)
    vector_handling?: 'preserve_chunks_only' | 'none';

    // Phase 1.9: Embedding model configuration for auto-rebuild
    embedding_model?: {
      model_id: string; // Model identifier (e.g., "text-embedding-ada-002")
      provider: string; // Model provider (e.g., "OpenAI", "Ollama")
      dimension?: number; // Vector dimension (e.g., 1536)
      fallback_strategy?: 'auto' | 'manual' | 'skip'; // What to do if model not available
    };
  };
}

export interface WorkflowDefinition {
  blocks: any[];
  edges: any[];
  viewport: any;
  version: string;
}
