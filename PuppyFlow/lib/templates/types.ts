/**
 * Template Resource Contract - Type Definitions
 *
 * Defines the structure for template packages, resources, and workflows.
 * Part of the Template Resource Contract MVP (Phase 1).
 */

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
}

export interface ResourceManifest {
  format: 'separate' | 'inline';
  resources: ResourceDescriptor[];
}

export interface ResourceDescriptor {
  id: string;
  type: 'external_storage' | 'external_storage_with_vector' | 'file' | 'inline';
  block_id: string;
  reference_path: string;
  reference_paths?: {
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
    strategy: 'copy_and_chunk' | 'copy_as_is' | 'skip';
    pattern: string;
    requires_user_scope: boolean;
    vector_handling?: 'preserve_chunks_only' | 'none';
  };
}

export interface WorkflowDefinition {
  blocks: any[];
  edges: any[];
  viewport: any;
  version: string;
}
